import { createHash, randomUUID } from "node:crypto";
import { database } from "../db/client";
import type { Prisma } from "../db/generated/client";
import { lockOwner } from "../db/ownership";
import type { Actor } from "../auth/session";
import { WorkspaceError } from "../workspace/errors";
import { AiError, type AiErrorCode } from "./errors";
import type { ProviderId } from "./provider";

export const studyActionPolicy = {
  chat: { guest: 24, account: 48 },
  quiz: { guest: 8, account: 16 },
  speech: { guest: 12, account: 24 },
  upload: { guest: 5, account: 30 },
} as const;
type ActionKind = keyof typeof studyActionPolicy;
export type StudyAction = { id: string; lease: string };
type Endpoint = { provider: ProviderId; modelId: string; endpoint: string; rateScope?: string };
type AttemptResult = Endpoint & {
  attemptId?: string; status: string; latencyMs: number; rateLimitCategory?: string; retryAt?: Date;
  remainingRequests?: number; inputTokens?: number; outputTokens?: number;
};
type Cooldown = { scope: string; status: AiErrorCode; until: Date; retryCategory?: string };
const dayMs = 86_400_000;
const minuteMs = 60_000;
const fromWindow = (now: Date, interval: number) => new Date(Math.floor(now.getTime() / interval) * interval);

export function actionIdentity(request: Request | undefined, data: unknown) {
  const requestKey = request?.headers.get("Idempotency-Key") ?? randomUUID();
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestKey)) {
    throw new WorkspaceError(400, "Use a valid idempotency key.");
  }
  return { requestKey, fingerprint: createHash("sha256").update(JSON.stringify(data)).digest("hex") };
}

export const digestBytes = (data: ArrayBuffer) => createHash("sha256").update(new Uint8Array(data)).digest("hex");

export async function beginStudyAction(tx: Prisma.TransactionClient, actor: Actor, kind: ActionKind,
  identity: { requestKey: string; fingerprint: string }, now = new Date()) {
  const old = await tx.aiAction.findUnique({ where: { ownerId_kind_requestKey: { ownerId: actor.id, kind, requestKey: identity.requestKey } } });
  if (old && old.fingerprint !== identity.fingerprint) throw new WorkspaceError(409, "That retry key was used for a different request.");
  if (old?.status === "completed" || (kind === "upload" && old?.resultRef)) return { record: old, replay: true } as const;
  if (old?.status === "running" && old.leaseUntil && old.leaseUntil > now) {
    throw new WorkspaceError(409, "This request is still running. Retry shortly using the same request.");
  }
  const start = fromWindow(now, dayMs);
  const used = await tx.aiAction.count({ where: {
    ownerId: actor.id, kind, OR: [
      { status: "completed", completedAt: { gte: start } },
      { status: "running", leaseUntil: { gt: now } },
    ],
  } });
  if (used >= studyActionPolicy[kind][actor.isAnonymous ? "guest" : "account"]) {
    throw new WorkspaceError(429, "The daily limit for this study action has been reached.", Math.ceil((start.getTime() + dayMs - now.getTime()) / 1000), "workspace_daily");
  }
  const active = { status: "running", lease: randomUUID(), leaseUntil: new Date(now.getTime() + (kind === "upload" ? 3_600_000 : 75_000)) };
  const record = old ? await tx.aiAction.update({ where: { id: old.id }, data: active })
    : await tx.aiAction.create({ data: { ownerId: actor.id, kind, ...identity, ...active } });
  return { record, replay: false, action: { id: record.id, lease: active.lease } } as const;
}

export async function finishStudyAction(tx: Prisma.TransactionClient, action: StudyAction, resultRef: string | null,
  replay?: { bytes: Uint8Array<ArrayBuffer>; type: string }) {
  const { count } = await tx.aiAction.updateMany({ where: { id: action.id, lease: action.lease, status: "running" }, data: {
    status: "completed", resultRef, completedAt: new Date(), lease: null, leaseUntil: null,
    ...(replay ? { replayBytes: replay.bytes, replayType: replay.type, replayUntil: new Date(Date.now() + 10 * minuteMs) } : {}),
  } });
  if (!count) throw new WorkspaceError(409, "This study request was replaced by a retry.");
}

function configuredBudget(name: string, fallback: number) {
  const number = Number(process.env[name]);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function providerBudgetPolicy() {
  return { workspace: configuredBudget("FIS_AI_DAILY_BUDGET", 120),
    openrouter: configuredBudget("FIS_OPENROUTER_DAILY_BUDGET", 50), openrouterMinute: 20 };
}

export function actorProviderBudget(actor: Actor) {
  return actor.isAnonymous ? { daily: 90, minute: 24 } : { daily: 160, minute: 40 };
}

export function studyUsage(actor: Actor, request?: Request, documentId?: string) {
  const db = () => database();
  let action: StudyAction | undefined;
  const personal = request?.headers.has("x-fis-openrouter-key") ?? false;
  const scopedId = async () => action?.id ?? (documentId ? (await db().aiAction.findFirst({
    where: { ownerId: actor.id, kind: "upload", resultRef: documentId }, select: { id: true },
  }))?.id : undefined);
  return {
    async begin(kind: ActionKind, input: unknown) {
      const identity = actionIdentity(request, input);
      const state = await db().$transaction(async (tx) => {
        await lockOwner(tx, actor.id);
        if (kind === "speech") await tx.aiAction.updateMany({
          where: { ownerId: actor.id, replayUntil: { lte: new Date() } },
          data: { replayBytes: null, replayType: null, replayUntil: null },
        });
        return beginStudyAction(tx, actor, kind, identity);
      });
      if (!state.replay) action = state.action;
      return state;
    },
    async local(operation: "retrieval" | "source_reuse") {
      if (action) await db().aiAction.updateMany({ where: { id: action.id, lease: action.lease }, data: { localOperations: { push: operation } } });
    },
    async fail() {
      if (action) await db().aiAction.updateMany({ where: { id: action.id, lease: action.lease, status: "running" }, data: { status: "failed", lease: null, leaseUntil: null } });
    },
    async authorizeAttempt(operation: string, endpoint?: Endpoint) {
      if (!endpoint) return;
      const actionId = await scopedId();
      const now = new Date();
      const day = fromWindow(now, dayMs);
      const minute = fromWindow(now, minuteMs);
      const daily = new Date(day.getTime() + dayMs);
      const burst = new Date(minute.getTime() + minuteMs);
      const budget = providerBudgetPolicy();
      const actorBudget = actorProviderBudget(actor);
      const buckets = [
        { key: `ai-v2:actor:${actor.id}:day:${day.getTime()}`, limit: actorBudget.daily, expires: daily },
        { key: `ai-v2:actor:${actor.id}:minute:${minute.getTime()}`, limit: actorBudget.minute, expires: burst },
        { key: `ai-v2:workspace:day:${day.getTime()}`, limit: budget.workspace, expires: daily },
      ];
      if (!personal && endpoint.provider === "openrouter") buckets.push(
        { key: `ai-v2:openrouter:day:${day.getTime()}`, limit: budget.openrouter, expires: daily },
        { key: `ai-v2:openrouter:minute:${minute.getTime()}`, limit: budget.openrouterMinute, expires: burst },
      );
      return db().$transaction(async (tx) => {
        await lockOwner(tx, actor.id);
        for (const bucket of buckets) {
          const count = await tx.$executeRaw`
            INSERT INTO "UsageBucket" ("key", "count", "expiresAt") VALUES (${bucket.key}, 1, ${bucket.expires})
            ON CONFLICT ("key") DO UPDATE SET "count" = "UsageBucket"."count" + 1 WHERE "UsageBucket"."count" < ${bucket.limit}
          `;
          if (!count) {
            const retryAfter = Math.max(1, Math.ceil((bucket.expires.getTime() - now.getTime()) / 1000));
            if (bucket.key.startsWith("ai-v2:openrouter:")) throw new AiError("provider_budget", retryAfter);
            throw new WorkspaceError(429, "The FIS provider-work budget has been reached.", retryAfter, bucket.expires === burst ? "workspace_minute" : "workspace_daily");
          }
        }
        const { provider, modelId, endpoint: path, rateScope } = endpoint;
        const row = await tx.aiProviderAttempt.create({ data: { ownerId: actor.id, actionId, operation, provider, modelId, endpoint: path, rateScope, status: "started" }, select: { id: true } });
        return row.id;
      });
    },
    async reportAttempt({ attemptId, status, latencyMs, rateScope, rateLimitCategory, retryAt, remainingRequests, inputTokens, outputTokens }: AttemptResult) {
      if (!attemptId) return;
      await db().aiProviderAttempt.updateMany({ where: { id: attemptId, ownerId: actor.id }, data: {
        status, latencyMs, rateScope, rateLimitCategory, retryAt, remainingRequests, inputTokens, outputTokens,
      } });
    },
    async readCooldown(scope: string) {
      if (personal) return null;
      const row = await db().aiProviderCooldown.findUnique({ where: { scope } });
      return row && row.until > new Date() ? { ...row, status: row.status as AiErrorCode, retryCategory: row.retryCategory ?? undefined } : null;
    },
    async writeCooldown({ scope, status, until, retryCategory }: Cooldown) {
      if (personal) return;
      await db().$executeRaw`
        INSERT INTO "AiProviderCooldown" ("scope", "status", "until", "retryCategory") VALUES (${scope}, ${status}, ${until}, ${retryCategory ?? null})
        ON CONFLICT ("scope") DO UPDATE SET "status" = EXCLUDED."status", "until" = EXCLUDED."until", "retryCategory" = EXCLUDED."retryCategory"
        WHERE "AiProviderCooldown"."until" < EXCLUDED."until"
      `;
    },
  };
}
