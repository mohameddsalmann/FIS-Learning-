import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, publicAiError } from "../src/server/ai/errors";
import { FreeAiGateway, OpenRouterProvider, freeRouting, getOpenRouterKey, type ProviderCooldown } from "../src/server/ai/gateway";
import { OpenRouterRegistry, hasKnownModel, readFreeModels } from "../src/server/ai/registry";
import type { AiModel, InferenceProvider } from "../src/server/ai/provider";
import { readChatEvents, sourceContext, validatedCitations } from "../src/server/ai/services";

const primaryId = "google/gemma-4-26b-a4b-it:free";
const fallbackId = "google/gemma-4-31b-it:free";
const nvidiaId = "nvidia/nemotron-3.5-super-vl:free";
const liveModel = (id = primaryId) => ({
  id, name: "Gemma (free)", architecture: { input_modalities: ["text", "image", "video"], output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0" }, endpoints: ["/api/v1/chat/completions"],
  supported_parameters: ["response_format"], context_length: 8192, expiration_date: null,
});
const catalog = { data: [liveModel(primaryId), liveModel(fallbackId)] };
const models = readFreeModels(catalog, "chat");

afterEach(() => { vi.unstubAllEnvs(); });

describe("verified free model registry", () => {
  it("requires the exact variant, zero prices, matching live capability and current expiry", () => {
    const data = { data: [
      liveModel(primaryId), liveModel("google/gemma-4-26b-a4b-it"),
      { ...liveModel(fallbackId), pricing: { prompt: "0", completion: "0", image: "0.00001" } },
      { ...liveModel(fallbackId), expiration_date: "2026-11-18" },
      { ...liveModel(fallbackId), endpoints: ["/api/v1/audio/speech"] },
      { ...liveModel(fallbackId), architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
    ] };
    expect(readFreeModels(data, "chat", Date.parse("2026-11-19"))).toMatchObject([
      { id: primaryId, media: ["image", "video"], cost: "free", structured: true, contextLength: 8192 },
    ]);
  });

  it("will not verify a variant with mixed endpoint prices or an aliased endpoint", async () => {
    const endpoint = { model_id: primaryId, provider_name: "Test provider", pricing: { prompt: "0", completion: "0" }, status: 0 };
    const api = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: { id: primaryId, endpoints: [
      endpoint, { ...endpoint, pricing: { ...endpoint.pricing, request: "0.01" } },
    ] } })).mockResolvedValueOnce(Response.json({ data: { id: fallbackId, endpoints: [endpoint] } }));
    const registry = new OpenRouterRegistry(api);
    await expect(registry.provider(models[0])).resolves.toBeNull();
    await expect(registry.provider(models[1])).resolves.toBeNull();
  });
});

describe("inference gateway", () => {
  function create(send = vi.fn<(...args: [AiModel]) => Promise<Response>>().mockResolvedValue(Response.json({ ok: true }))) {
    const provider = { id: "openrouter" as const, enabled: () => true, configured: () => true, hasModel: hasKnownModel,
      models: vi.fn().mockResolvedValue(models), verify: vi.fn().mockResolvedValue("Verified provider"), send };
    const gateway = new FreeAiGateway(provider);
    const authorizeAttempt = vi.fn().mockResolvedValue(undefined);
    const options = { apiKey: "synthetic", authorizeAttempt };
    const run = (overrides: Partial<typeof options & { model: string; signal: AbortSignal; allowFallback: boolean }> = {}) =>
      gateway.run("chat", () => ({ messages: [] }), (response) => response.json(), { ...options, ...overrides });
    return { provider, authorizeAttempt, run };
  }

  it("charges each attempted free fallback and never sends to a route that cannot be verified", async () => {
    const send = vi.fn<(...args: [AiModel]) => Promise<Response>>()
      .mockRejectedValueOnce(new AiError("unavailable")).mockResolvedValueOnce(Response.json({ ok: true }));
    const active = create(send);
    await expect(active.run()).resolves.toMatchObject({ model: { id: fallbackId }, result: { ok: true } });
    expect(send.mock.calls.map(([model]) => model.id)).toEqual([primaryId, fallbackId]);
    expect(active.authorizeAttempt).toHaveBeenCalledTimes(2);
    const blocked = create();
    blocked.provider.verify.mockResolvedValue(null);
    await expect(blocked.run()).rejects.toMatchObject({ code: "no_free_route" });
    expect(blocked.provider.send).not.toHaveBeenCalled();
    expect(blocked.authorizeAttempt).not.toHaveBeenCalled();
  });

  it("rejects paid models, denied quotas and cancelled requests before inference", async () => {
    const active = create();
    await expect(active.run({ model: "openai/gpt-4o" })).rejects.toMatchObject({ code: "invalid_model" });
    active.authorizeAttempt.mockRejectedValueOnce(new AiError("rate_limited"));
    await expect(active.run()).rejects.toMatchObject({ code: "rate_limited" });
    const controller = new AbortController();
    controller.abort();
    await expect(active.run({ signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(active.provider.send).not.toHaveBeenCalled();
  });

  it("does not retry rejected credentials or exhausted provider quota", async () => {
    for (const code of ["invalid_credentials", "rate_limited"] as const) {
      const send = vi.fn<(...args: [AiModel]) => Promise<Response>>().mockRejectedValue(new AiError(code));
      const active = create(send);
      await expect(active.run()).rejects.toMatchObject({ code });
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("tries all three compatible gateways before repeating a gateway after a transient failure", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic");
    const attempts: string[] = [];
    function adapter(id: InferenceProvider["id"], modelList: AiModel[]): InferenceProvider {
      return {
        id, enabled: () => true, configured: () => true, hasModel: () => false, models: async () => modelList,
        verify: async () => id,
        send: async (model) => {
          attempts.push(model.id);
          if (id !== "openrouter") throw new AiError("unavailable");
          return Response.json({ ok: true });
        },
      };
    }
    const gateway = new FreeAiGateway(adapter("openrouter", [models[0]]), [
      adapter("gemini", [{ ...models[0], id: "gemini-first" }, { ...models[0], id: "gemini-repeat" }]),
      adapter("groq", [{ ...models[0], id: "groq-first" }]),
    ]);
    await expect(gateway.run("chat", () => ({}), (response) => response.json(), { authorizeAttempt: async () => {} }))
      .resolves.toMatchObject({ result: { ok: true } });
    expect(attempts).toEqual(["gemini-first", "groq-first", primaryId]);
  });

  it("shares an OpenRouter upstream-pool cooldown across gateway processes and still routes to Nvidia", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic");
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models")) return Response.json({ data: [...catalog.data, liveModel(nvidiaId)] });
      if (url.endsWith("/endpoints")) {
        const id = url.slice(url.indexOf("/models/") + 8, -10);
        return Response.json({ data: { id, endpoints: [{ model_id: id, provider_name: id === nvidiaId ? "Nvidia" : "Google AI Studio",
          status: 0, pricing: { prompt: "0", completion: "0" } }] } });
      }
      const { model } = JSON.parse(String(init?.body));
      calls.push(model);
      return model === nvidiaId ? Response.json({ ok: true }) : Response.json({ error: { metadata: {
        limit_source: "upstream_provider_shared_pool", provider_name: "Google AI Studio",
      } } }, { status: 429, headers: { "Retry-After": "60" } });
    };
    const cooldowns = new Map<string, ProviderCooldown>();
    const reportAttempt = vi.fn(async () => {});
    const run = () => new FreeAiGateway(new OpenRouterProvider(fetcher)).run("chat", () => ({}), (response) => response.json(), {
      authorizeAttempt: async () => "attempt-" + (calls.length + 1),
      reportAttempt,
      readCooldown: async (scope) => cooldowns.get(scope) ?? null,
      writeCooldown: async ({ scope, ...entry }) => { cooldowns.set(scope, entry); },
    });
    await expect(run()).resolves.toMatchObject({ model: { id: nvidiaId } });
    await expect(run()).resolves.toMatchObject({ model: { id: nvidiaId } });
    expect(calls).toEqual([primaryId, nvidiaId, nvidiaId]);
    expect([...cooldowns.entries()]).toMatchObject([["openrouter:pool:google ai studio", { status: "rate_limited", retryCategory: "openrouter_upstream_pool" }]]);
    expect(reportAttempt.mock.calls).toMatchObject([
      [{ attemptId: "attempt-1", modelId: primaryId, status: "rate_limited", endpoint: "/api/v1/chat/completions",
        rateLimitCategory: "openrouter_upstream_pool", rateScope: "openrouter:pool:google ai studio" }],
      [{ attemptId: "attempt-2", modelId: nvidiaId, status: "available" }],
      [{ attemptId: "attempt-3", modelId: nvidiaId, status: "available" }],
    ]);
  });

  it("uses the OpenRouter daily reset timestamp and keeps the scope at the account", async () => {
    const reset = Date.now() + 120_000;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { metadata: {
      limit_source: "openrouter_free_tier_daily", headers: { "X-RateLimit-Reset": reset.toString(), "X-RateLimit-Remaining": "0" },
    } } }, { status: 429, headers: { "Retry-After": "15" } }));
    const provider = new OpenRouterProvider(fetcher);
    await expect(provider.send(models[0], {}, "test-key", AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "rate_limited", scope: "openrouter", category: "openrouter_daily", retryAfter: 120, remainingRequests: 0,
    });
  });

  it("distinguishes an OpenRouter workspace budget response from rejected credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { metadata: {
      limit_source: "openrouter_workspace_budget", resets_at: new Date(Date.now() + 120_000).toISOString(),
    } } }, { status: 403 }));
    const provider = new OpenRouterProvider(fetcher);
    await expect(provider.send(models[0], {}, "test-key", AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "billing_unavailable", scope: "openrouter", category: "billing", retryAfter: 120,
    });
  });

  it("records complete streaming tokens and a typed rate limit before any content without recording a success", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic");
    const encoder = new TextEncoder();
    const make = (events: object[]) => new Response(encoder.encode(events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("") + "data: [DONE]\n\n"),
      { headers: { "Content-Type": "text/event-stream", "X-RateLimit-Remaining-Requests": "3" } });
    const adapter: InferenceProvider = {
      id: "openrouter", enabled: () => true, configured: () => true, hasModel: hasKnownModel, models: async () => models,
      verify: async (model) => model.id === primaryId ? "Google AI Studio" : "Nvidia",
      send: async (model) => model.id === primaryId ? make([{ provider: "Google AI Studio", error: { code: 429,
        metadata: { error_type: "rate_limit_exceeded" } } }]) : make([
        { choices: [{ delta: { content: "Hello" } }] }, { usage: { prompt_tokens: 27, completion_tokens: 11 } },
      ]),
    };
    const report = vi.fn(async () => {});
    const gateway = new FreeAiGateway(adapter);
    await expect(gateway.run("chat", () => ({ stream: true }), async (response) => {
      let answer = "";
      for await (const value of readChatEvents(response)) answer += value;
      return answer;
    }, { authorizeAttempt: vi.fn().mockResolvedValueOnce("primary").mockResolvedValueOnce("fallback"), reportAttempt: report }))
      .resolves.toMatchObject({ result: "Hello", model: { id: fallbackId } });
    expect(report.mock.calls).toMatchObject([
      [{ attemptId: "primary", status: "rate_limited", remainingRequests: 3, rateLimitCategory: "openrouter_upstream_pool" }],
      [{ attemptId: "fallback", status: "available", inputTokens: 27, outputTokens: 11, remainingRequests: 3 }],
    ]);
  });

  it("does not switch an explicitly pinned embedding space", async () => {
    const send = vi.fn<(...args: [AiModel]) => Promise<Response>>().mockRejectedValue(new AiError("unavailable"));
    const active = create(send);
    await expect(active.run({ model: primaryId, allowFallback: false })).rejects.toMatchObject({ code: "unavailable" });
    expect(send.mock.calls.map(([model]) => model.id)).toEqual([primaryId]);
  });

  it("sends only server-owned model IDs and price caps to the correct endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    const provider = new OpenRouterProvider(fetcher);
    await provider.send(models[0], { model: "openai/gpt-4o", provider: { max_price: { request: 100 } }, stream: true }, "synthetic", AbortSignal.timeout(1000));
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(String(options?.body))).toEqual({ model: primaryId, provider: freeRouting, stream: true });
    expect(options?.headers).toMatchObject({ Authorization: "Bearer synthetic" });
  });

  it("uses supplied personal key in memory without silently using shared credentials", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "shared-test");
    const url = "https://fis.example";
    const personal = "sk-or-v1-" + "b".repeat(64);
    expect(getOpenRouterKey(new Request(url, { headers: { "x-fis-openrouter-key": personal } }))).toBe(personal);
    expect(getOpenRouterKey(new Request(url))).toBe("shared-test");
    expect(() => getOpenRouterKey(new Request(url, { headers: { "x-fis-openrouter-key": "incorrect" } }))).toThrow("invalid_credentials");
    expect(publicAiError(new Error(personal), "ar").error).not.toContain(personal);
  });
});

describe("chat streaming and citation semantics", () => {
  it("decodes split UTF-8 and multi-frame SSE without reasoning content", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(': keepalive\r\n\r\ndata: {"choices":[{"delta":{"reasoning":"private","content":"مرحبًا"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let start = 0; start < bytes.length; start += 3) controller.enqueue(bytes.slice(start, start + 3));
        controller.close();
      },
    });
    const received: string[] = [];
    for await (const token of readChatEvents(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))) received.push(token);
    expect(received).toEqual(["مرحبًا"]);
  });

  it("fails on truncation or a provider error after the first token", async () => {
    const response = new Response('data: {"choices":[{"delta":{"content":"Partial reply"}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    const iterator = readChatEvents(response);
    await expect(iterator.next()).resolves.toMatchObject({ value: "Partial reply", done: false });
    await expect(iterator.next()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("exposes only known, used citation identifiers", () => {
    const source = { id: "chunk-1", documentId: "document-1", page: 2, title: "Guide", text: "Retrieved fact." };
    const contexts = sourceContext([source]);
    expect(validatedCitations("This cites [S1], [S3] and repeats [S1].", contexts.sourceByLabel)).toEqual([source]);
    expect(validatedCitations("There are no cited excerpts.", contexts.sourceByLabel)).toEqual([]);
  });
});
