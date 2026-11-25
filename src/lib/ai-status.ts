import { RequestError } from "./http";

export type AiAvailabilityState = "available" | "busy" | "daily_exhausted" | "unavailable";
export type AiFeature = "chat" | "quiz" | "speech";

export interface AiFeatureStatus {
  state: AiAvailabilityState;
  retryAfter?: number;
}

export interface AiDiagnostics {
  limits: { kind: string; remaining: number; maximum: number }[];
  actions: { kind: string; attempts: number; status: string; at: string }[];
  providers: { provider: string; model: string; status: string; category: string | null; scope: "pool" | "model" | "provider" | null;
    retryAt: string | null; remainingRequests: number | null; at: string }[];
  lastRoute: { provider: string; model: string } | null;
}

export interface AiStatusResponse {
  features: Record<AiFeature, AiFeatureStatus>;
  diagnostics?: AiDiagnostics | null;
  catalog?: AiCatalog;
}

export type AiGateway = "gemini" | "groq" | "openrouter" | "xai";
export interface AiCatalog {
  status: string;
  models: { id: string; name: string; kind: string; cost: string; detail: string; provider?: string; gateway?: AiGateway }[];
  providers?: Record<AiGateway, { status: string }>;
}

export function isDailyCapacity(category?: string | null) {
  return category?.split("_").includes("daily") ?? false;
}

export function routeAvailability(routes: Array<{ availability: string; category?: string; retryAfter?: number }>): AiFeatureStatus {
  if (routes.some((route) => route.availability === "available")) return { state: "available" };
  const busy = routes.filter((route) => (route.availability === "degraded" || route.category)
    && !["credentials", "billing", "unsupported"].includes(route.category ?? ""));
  if (!busy.length) return { state: "unavailable" };
  const times = busy.flatMap((route) => route.retryAfter && route.retryAfter > 0 ? [route.retryAfter] : []);
  return {
    state: busy.every((route) => isDailyCapacity(route.category)) ? "daily_exhausted" : "busy",
    retryAfter: times.length === busy.length ? Math.min(...times) : undefined,
  };
}

export function statusFromError(error: unknown): AiFeatureStatus | undefined {
  if (!(error instanceof RequestError)) return undefined;
  const { code, category, retryAfter } = error;
  if (code === "workspace_quota" || code === "rate_limited" || code === "provider_budget" || error.status === 429) {
    const daily = isDailyCapacity(category);
    return { state: daily ? "daily_exhausted" : "busy", retryAfter };
  }
  if (["no_free_route", "not_configured", "invalid_credentials", "billing_unavailable", "unsupported_media", "invalid_model"].includes(code ?? "")) {
    return { state: "unavailable" };
  }
  if (["provider_busy", "timeout", "unavailable", "invalid_response"].includes(code ?? "") || error.status === 503 || error.status === 504) {
    return { state: "busy", retryAfter };
  }
  return undefined;
}
