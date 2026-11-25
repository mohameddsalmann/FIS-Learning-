import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  actor: vi.fn(), catalog: vi.fn(), group: vi.fn(), bucket: vi.fn(), actions: vi.fn(), attempts: vi.fn(), lastRoute: vi.fn(),
}));
vi.mock("../src/server/auth/session", () => ({ getActor: fixture.actor }));
vi.mock("../src/server/ai/gateway", () => ({ gateway: { catalog: fixture.catalog } }));
vi.mock("../src/server/db/client", () => ({ database: () => ({
  aiAction: { groupBy: fixture.group, findMany: fixture.actions }, usageBucket: { findMany: fixture.bucket },
  aiProviderAttempt: { findMany: fixture.attempts, findFirst: fixture.lastRoute },
}) }));

import { GET } from "../src/app/api/learning/status/route";

const request = () => new Request("https://fis.example/api/learning/status?diagnostics=1");
const at = new Date("2026-01-01T12:00:00Z");
const providers = { gemini: { status: "available" }, openrouter: { status: "available" } };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.actor.mockResolvedValue(null);
  fixture.catalog.mockResolvedValue({ status: "available", providers, models: [
    { gateway: "gemini", cost: "free", kind: "chat", availability: "available", structured: true },
    { gateway: "openrouter", cost: "free", kind: "speech", availability: "degraded", category: "openrouter_daily", retryAfter: 10 },
    { gateway: "openrouter", cost: "paid", kind: "speech", availability: "available" },
  ] });
  fixture.bucket.mockResolvedValue([]);
  fixture.group.mockResolvedValue([]);
  fixture.actions.mockResolvedValue([]);
  fixture.attempts.mockResolvedValue([]);
  fixture.lastRoute.mockResolvedValue(null);
});

describe("AI status privacy and feature availability", () => {
  it("reports capability-specific availability without proposing paid routes or showing private calls", async () => {
    const response = await GET(request());
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const result = await response.json();
    expect(result.features).toEqual({ chat: { state: "available" }, quiz: { state: "available" }, speech: { state: "daily_exhausted", retryAfter: 10 } });
    expect(result).not.toHaveProperty("diagnostics");
    expect(fixture.attempts).not.toHaveBeenCalled();
  });

  it("reports the owner's attempt counts and a coarse error scope without raw ledger identifiers", async () => {
    fixture.actor.mockResolvedValue({ id: "owner-only", isAnonymous: true });
    fixture.group.mockResolvedValue([{ kind: "quiz", _count: { _all: 8 } }]);
    fixture.actions.mockResolvedValue([{ kind: "chat", status: "completed", createdAt: at, _count: { attempts: 2 } }]);
    fixture.attempts.mockResolvedValue([{ provider: "openrouter", modelId: "test-model", status: "rate_limited", rateScope: "openrouter:pool:hidden-provider-scope",
      rateLimitCategory: "openrouter_upstream_pool", retryAt: at, remainingRequests: 0, createdAt: at }]);
    fixture.lastRoute.mockResolvedValue({ provider: "gemini", modelId: "test-answer" });
    const response = await GET(request());
    const body = await response.text();
    expect(body).not.toContain("hidden-provider-scope");
    expect(body).not.toContain("owner-only");
    expect(JSON.parse(body)).toMatchObject({ features: { quiz: { state: "daily_exhausted" } }, diagnostics: {
      lastRoute: { provider: "gemini", model: "test-answer" }, actions: [{ kind: "chat", attempts: 2 }], providers: [{ scope: "pool", remainingRequests: 0 }],
    } });
    expect(fixture.actions).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "owner-only" } }));
    expect(fixture.attempts).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "owner-only" } }));
  });
});
