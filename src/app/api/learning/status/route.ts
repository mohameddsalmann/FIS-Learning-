import { routeAvailability, type AiDiagnostics, type AiFeature, type AiFeatureStatus, type AiStatusResponse } from "@/lib/ai-status";
import { gateway } from "@/server/ai/gateway";
import type { AiErrorCode } from "@/server/ai/errors";
import { actorProviderBudget, providerBudgetPolicy, studyActionPolicy } from "@/server/ai/usage";
import { getActor, type Actor } from "@/server/auth/session";
import { database } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dayMs = 86_400_000;
const minuteMs = 60_000;
const featureKinds = ["chat", "quiz", "speech"] as const;
type Limits = AiDiagnostics["limits"];

async function learnerLimits(actor: Actor | null, now: Date, day: Date, minute: Date) {
  const db = database();
  const bucketKeys = {
    workspace: `ai-v2:workspace:day:${day.getTime()}`,
    openrouter: `ai-v2:openrouter:day:${day.getTime()}`,
    openrouterMinute: `ai-v2:openrouter:minute:${minute.getTime()}`,
    actorDaily: actor && `ai-v2:actor:${actor.id}:day:${day.getTime()}`,
    actorMinute: actor && `ai-v2:actor:${actor.id}:minute:${minute.getTime()}`,
  };
  const [counts, buckets] = await Promise.all([
    actor ? db.aiAction.groupBy({ by: ["kind"], _count: { _all: true }, where: { ownerId: actor.id, OR: [
      { status: "completed", completedAt: { gte: day } }, { status: "running", leaseUntil: { gt: now } },
    ] } }) : [],
    db.usageBucket.findMany({ where: { key: { in: Object.values(bucketKeys).filter((key) => key !== null) } }, select: { key: true, count: true } }),
  ]);
  const limits: Limits = actor ? Object.entries(studyActionPolicy).map(([kind, policy]) => {
    const maximum = actor.isAnonymous ? policy.guest : policy.account;
    return { kind, maximum, remaining: Math.max(0, maximum - (counts.find((entry) => entry.kind === kind)?._count._all ?? 0)) };
  }) : [];
  function addLimit(kind: keyof typeof bucketKeys, maximum: number) {
    limits.push({ kind, maximum, remaining: Math.max(0, maximum - (buckets.find((bucket) => bucket.key === bucketKeys[kind])?.count ?? 0)) });
  }
  const maximums = providerBudgetPolicy();
  for (const kind of ["workspace", "openrouter", "openrouterMinute"] as const) addLimit(kind, maximums[kind]);
  if (actor) {
    const budget = actorProviderBudget(actor);
    addLimit("actorDaily", budget.daily);
    addLimit("actorMinute", budget.minute);
  }
  return limits;
}

async function diagnosticsFor(ownerId: string, limits: Limits): Promise<AiDiagnostics> {
  const db = database();
  const [actions, attempts, lastRoute] = await Promise.all([
    db.aiAction.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 5,
      select: { kind: true, status: true, createdAt: true, _count: { select: { attempts: true } } } }),
    db.aiProviderAttempt.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 8,
      select: { provider: true, modelId: true, status: true, rateScope: true, rateLimitCategory: true, retryAt: true, remainingRequests: true, createdAt: true } }),
    db.aiProviderAttempt.findFirst({ where: { ownerId, status: "available" }, orderBy: { createdAt: "desc" },
      select: { provider: true, modelId: true } }),
  ]);
  return {
    limits,
    actions: actions.map(({ kind, status, createdAt, _count }) => ({ kind, status, at: createdAt.toISOString(), attempts: _count.attempts })),
    providers: attempts.map((row) => {
      const scope = row.rateScope?.split(":", 2)[1];
      return { provider: row.provider, model: row.modelId, status: row.status, category: row.rateLimitCategory,
        scope: row.rateLimitCategory && row.rateScope ? scope === "pool" || scope === "model" ? scope : "provider" : null,
        retryAt: row.retryAt?.toISOString() ?? null, remainingRequests: row.remainingRequests, at: row.createdAt.toISOString() };
    }),
    lastRoute: lastRoute && { provider: lastRoute.provider, model: lastRoute.modelId },
  };
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const personal = query.get("personal") === "1";
  const now = new Date();
  const day = new Date(Math.floor(now.getTime() / dayMs) * dayMs);
  const minute = new Date(Math.floor(now.getTime() / minuteMs) * minuteMs);
  const dayWait = Math.ceil((day.getTime() + dayMs - now.getTime()) / 1000);
  const minuteWait = Math.ceil((minute.getTime() + minuteMs - now.getTime()) / 1000);
  const actor = await getActor(request.headers).catch(() => null);
  const [catalog, limits] = await Promise.all([
    gateway.catalog(personal ? undefined : async (scope) => {
      const row = await database().aiProviderCooldown.findUnique({ where: { scope } });
      return row && row.until > now ? { ...row, status: row.status as AiErrorCode, retryCategory: row.retryCategory ?? undefined } : null;
    }).catch(() => null),
    learnerLimits(actor, now, day, minute).catch(() => []),
  ]);
  const empty = (kind: string) => limits.some((limit) => limit.kind === kind && limit.remaining === 0);
  function feature(kind: AiFeature): AiFeatureStatus {
    if (empty(kind) || empty("workspace") || empty("actorDaily")) return { state: "daily_exhausted", retryAfter: dayWait };
    if (empty("actorMinute")) return { state: "busy", retryAfter: minuteWait };
    if (!catalog) return { state: "busy" };
    const routes = catalog.models.filter((model) => model.cost === "free"
      && (personal ? model.gateway === "openrouter" : !["disabled", "not_configured"].includes(catalog.providers[model.gateway].status))
      && (kind === "quiz" ? model.kind === "chat" && model.structured : model.kind === kind));
    return routeAvailability(routes.map((route) => {
      if (!personal && route.gateway === "openrouter") {
        if (empty("openrouter")) return { availability: "degraded", category: "openrouter_daily", retryAfter: dayWait };
        if (empty("openrouterMinute")) return { availability: "degraded", category: "openrouter_minute", retryAfter: minuteWait };
      }
      return route;
    }));
  }
  const detailed = query.get("diagnostics") === "1";
  const diagnostics = detailed && actor ? await diagnosticsFor(actor.id, limits).catch(() => null) : undefined;
  const result: AiStatusResponse = { features: Object.fromEntries(featureKinds.map((kind) => [kind, feature(kind)])) as AiStatusResponse["features"],
    diagnostics, catalog: detailed ? catalog ?? undefined : undefined };
  return Response.json(result, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
