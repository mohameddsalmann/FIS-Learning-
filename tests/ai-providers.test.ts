import { GoogleGenAI } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../src/server/ai/errors";
import { FreeAiGateway } from "../src/server/ai/gateway";
import { GeminiProvider } from "../src/server/ai/gemini";
import { GroqProvider } from "../src/server/ai/groq";
import type { AiModel, InferenceProvider } from "../src/server/ai/provider";
import { readChatEvents } from "../src/server/ai/services";
import { XaiProvider } from "../src/server/ai/xai";

const geminiId = "google/gemini-3.8-flash";
const openRouterId = "google/gemma-4-26b-a4b-it:free";
const xaiId = "xai/grok-4.7";
const groqId = "groq/openai/gpt-oss-20b";
const options = () => ({ authorizeAttempt: vi.fn().mockResolvedValue(undefined) });
const assembly = {
  messages: [{ role: "system", content: "Be concise." }, { role: "user", content: "What is photosynthesis?" }],
  temperature: 0.4, stream: true, max_tokens: 400,
};
const eventStream = (...events: unknown[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
  headers: { "Content-Type": "text/event-stream" },
});
const output = (text: string, finishReason?: string) => ({ candidates: [{ finishReason, content: { role: "model", parts: [{ text }] } }] });

function verifiedGeminiKeys(primary = true, secondary = false) {
  vi.stubEnv("GEMINI_API_KEY_PRIMARY", "fixture-primary");
  vi.stubEnv("GEMINI_PRIMARY_FREE_TIER_CONFIRMED", primary ? "true" : "");
  vi.stubEnv("GEMINI_API_KEY_SECONDARY", secondary ? "fixture-secondary" : "");
  vi.stubEnv("GEMINI_SECONDARY_FREE_TIER_CONFIRMED", secondary ? "true" : "");
}

function geminiFixture(generate: (key: string, modelId: string) => Response = () => eventStream(output("Light provides energy.", "STOP"))) {
  const sends: { key: string; action: string; body: Record<string, unknown> }[] = [];
  const metadata: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
    const { pathname } = new URL(String(input));
    const [id, action] = pathname.split("/models/")[1].split(":");
    if (!action) {
      metadata.push(key);
      return Response.json({ name: `models/${id}`, inputTokenLimit: 1_048_576, outputTokenLimit: 65536,
        supportedGenerationMethods: id.includes("embedding") ? ["embedContent", "batchEmbedContents"] : ["generateContent"] });
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sends.push({ key, action, body });
    if (action === "batchEmbedContents") {
      const count = Array.isArray(body.requests) ? body.requests.length : 0;
      return Response.json({ embeddings: Array.from({ length: count }, () => ({ values: Array(2048).fill(0.5) })) });
    }
    if (action === "generateContent") return Response.json(output('{"questions":[]}', "STOP"));
    return generate(key, id);
  };
  const adapter = new GeminiProvider((key) => new GoogleGenAI({
    apiKey: key,
    vertexai: false,
    httpOptions: { baseUrl: "https://generativelanguage.googleapis.com", apiVersion: "v1beta", retryOptions: { attempts: 1 }, fetch: fetcher },
  }));
  return { adapter, sends, metadata };
}

const gemma: AiModel = {
  id: openRouterId, name: "Gemma", kind: "chat", cost: "free", provider: "OpenRouter", inputs: ["text", "image", "video"],
  outputs: ["text"], media: ["image", "video"], availability: "available", contextLength: 100_000, detail: "", structured: true,
};

function routerFixture() {
  const send = vi.fn(async () => eventStream({ choices: [{ delta: { content: "Verified free fallback." } }] }));
  const adapter: InferenceProvider = {
    id: "openrouter", configured: () => Boolean(process.env.OPENROUTER_API_KEY), enabled: () => Boolean(process.env.OPENROUTER_API_KEY),
    hasModel: (_, id) => id === openRouterId, models: async (kind) => kind === "chat" ? [gemma] : [], verify: async () => "OpenRouter", send,
  };
  return { adapter, send };
}

async function firstToken(response: Response) {
  const tokens = readChatEvents(response);
  const item = await tokens.next();
  if (item.done) throw new AiError("invalid_response");
  return { first: item.value, tokens };
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("Groq_API_KEY", "");
  vi.stubEnv("GROQ_FREE_PLAN_CONFIRMED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Google Gen AI SDK adapter", () => {
  it("reads GOOGLE_API_KEY as an attested primary alias and prefers the explicit primary", async () => {
    verifiedGeminiKeys();
    vi.stubEnv("GOOGLE_API_KEY", "fixture-google-alias");
    vi.stubEnv("GEMINI_API_KEY", "fixture-legacy");
    const explicit = geminiFixture();
    const chatModels = ["google/gemini-3.5-flash-lite", geminiId, "google/gemini-3.6-flash"];
    expect((await explicit.adapter.models("chat")).map(({ id }) => id)).toEqual(chatModels);
    expect(explicit.metadata).toEqual(Array(chatModels.length).fill("fixture-primary"));
    vi.stubEnv("GEMINI_API_KEY_PRIMARY", "");
    const alias = geminiFixture();
    expect((await alias.adapter.models("chat")).map(({ id }) => id)).toEqual(chatModels);
    expect(alias.metadata).toEqual(Array(chatModels.length).fill("fixture-google-alias"));
  });

  it("can validate a legacy key with metadata, without enabling inference before an attestation", async () => {
    verifiedGeminiKeys(false);
    vi.stubEnv("GEMINI_API_KEY_PRIMARY", "");
    vi.stubEnv("GEMINI_API_KEY", "fixture-legacy");
    const google = geminiFixture();
    await expect(google.adapter.models("chat")).resolves.toEqual([]);
    expect(google.metadata).toEqual([]);
    await expect(google.adapter.credentialStatus()).resolves.toBe("verified");
    expect(google.metadata).toEqual(["fixture-legacy"]);
    expect(google.sends).toEqual([]);
  });

  it("streams Gemini text, maps inline media, and validates terminal status", async () => {
    verifiedGeminiKeys();
    const google = geminiFixture();
    const gateway = new FreeAiGateway(routerFixture().adapter, [google.adapter]);
    const request = {
      ...assembly,
      messages: [...assembly.messages.slice(0, 1), { role: "user", content: [
        { type: "text", text: "Describe the files." }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } },
        { type: "video_url", video_url: { url: "data:video/mp4;base64,BBB=" } },
      ] }],
    };
    const result = await gateway.run("chat", () => request, firstToken, { ...options(), model: geminiId, requirements: { media: ["image", "video"] } });
    expect(result.result.first).toBe("Light provides energy.");
    expect(await result.result.tokens.next()).toMatchObject({ done: true });
    expect(google.sends).toMatchObject([{
      key: "fixture-primary", action: "streamGenerateContent", body: { contents: [{ role: "user", parts: [
        { text: "Describe the files." }, { inlineData: { mimeType: "image/png", data: "AAA=" } }, { inlineData: { mimeType: "video/mp4", data: "BBB=" } },
      ] }], systemInstruction: { parts: [{ text: "Be concise." }] } },
    }]);
  });

  it("charges the secondary key only after a primary authentication failure", async () => {
    verifiedGeminiKeys(true, true);
    const google = geminiFixture((key) => key === "fixture-primary"
      ? Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, { status: 400 })
      : eventStream(output("Attested backup key.", "STOP")));
    const gateway = new FreeAiGateway(routerFixture().adapter, [google.adapter]);
    const limits = options();
    const reportAttempt = vi.fn(async () => {});
    limits.authorizeAttempt.mockResolvedValueOnce("first-attempt").mockResolvedValueOnce("backup-attempt");
    const { result } = await gateway.run("chat", () => assembly, firstToken, { ...limits, model: geminiId, reportAttempt });
    expect(result.first).toBe("Attested backup key.");
    expect(await result.tokens.next()).toMatchObject({ done: true });
    expect(google.sends.map(({ key }) => key)).toEqual(["fixture-primary", "fixture-secondary"]);
    expect(limits.authorizeAttempt).toHaveBeenCalledTimes(2);
    expect(reportAttempt.mock.calls).toMatchObject([
      [{ attemptId: "first-attempt", status: "invalid_credentials", rateLimitCategory: "credentials" }],
      [{ attemptId: "backup-attempt", status: "available", endpoint: "/v1beta/models/gemini-3.8-flash:streamGenerateContent" }],
    ]);
  });

  it("honors Google RetryInfo and leaves other eligible project models available for model-specific quotas", async () => {
    verifiedGeminiKeys(true, true);
    const google = geminiFixture((_key, id) => id === "gemini-3.8-flash" ? Response.json({ error: {
      code: 429, status: "RESOURCE_EXHAUSTED", details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "43.1s" },
      ],
    } }, { status: 429 }) : eventStream(output("Other model is available.", "STOP")));
    const gateway = new FreeAiGateway(routerFixture().adapter, [google.adapter]);
    const writeCooldown = vi.fn(async () => {});
    const result = await gateway.run("chat", () => assembly, firstToken, { ...options(), model: geminiId, writeCooldown });
    expect(result.model.id).toBe("google/gemini-3.5-flash-lite");
    expect(await result.result.tokens.next()).toMatchObject({ done: true });
    expect(google.sends.map(({ key }) => key)).toEqual(["fixture-primary", "fixture-primary"]);
    expect(writeCooldown.mock.calls).toMatchObject([[{ scope: `gemini:model:${geminiId}`, status: "rate_limited", retryCategory: "gemini_model" }]]);
    await expect(gateway.run("chat", () => assembly, firstToken, { ...options(), model: geminiId, allowFallback: false }))
      .rejects.toMatchObject({ retryAfter: 44 });
    expect(google.sends).toHaveLength(2);
  });

  it("falls back across providers on a quota response without trying another Gemini key", async () => {
    verifiedGeminiKeys(true, true);
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-openrouter");
    const or = routerFixture();
    const google = geminiFixture(() => Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, { status: 429 }));
    const limits = options();
    const gateway = new FreeAiGateway(or.adapter, [google.adapter]);
    const { model, result } = await gateway.run("chat", () => assembly, firstToken, limits);
    expect(model.id).toBe(openRouterId);
    expect(result.first).toBe("Verified free fallback.");
    await result.tokens.return(undefined);
    expect(google.sends.map(({ key }) => key)).toEqual(["fixture-primary"]);
    expect(google.metadata).not.toContain("fixture-secondary");
    expect(or.send).toHaveBeenCalledTimes(1);
    expect(limits.authorizeAttempt).toHaveBeenCalledTimes(2);
  });

  it("fails an interrupted Gemini stream without restarting a reply that already emitted text", async () => {
    verifiedGeminiKeys();
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-openrouter");
    const or = routerFixture();
    const google = geminiFixture(() => eventStream(output("First fragment")));
    const gateway = new FreeAiGateway(or.adapter, [google.adapter]);
    const { result } = await gateway.run("chat", () => assembly, firstToken, options());
    expect(result.first).toBe("First fragment");
    await expect(result.tokens.next()).rejects.toMatchObject({ code: "invalid_response" });
    expect(or.send).not.toHaveBeenCalled();
  });

  it("requests JSON output and 2048-dimensional per-passage embeddings", async () => {
    verifiedGeminiKeys();
    const google = geminiFixture();
    const gateway = new FreeAiGateway(routerFixture().adapter, [google.adapter]);
    const json = await gateway.run("chat", () => ({ ...assembly, stream: false, response_format: { type: "json_object" } }),
      (response) => response.json(), { ...options(), requirements: { structured: true } });
    expect(json.result).toMatchObject({ choices: [{ message: { content: '{"questions":[]}' } }] });
    expect(google.sends[0].body).toMatchObject({ generationConfig: { responseMimeType: "application/json" } });
    const embedded = await gateway.run("embedding", () => ({ input: ["light", "physics"] }),
      (response) => response.json(), { ...options(), model: "google/gemini-embedding-2", allowFallback: false });
    expect(embedded.result.data).toHaveLength(2);
    expect(embedded.result.data[0].embedding).toHaveLength(2048);
    expect(google.sends[1]).toMatchObject({ action: "batchEmbedContents", body: { requests: [
      { content: { parts: [{ text: "light" }] }, outputDimensionality: 2048 },
      { content: { parts: [{ text: "physics" }] }, outputDimensionality: 2048 },
    ] } });
  });
});

describe("Groq Free plan adapter", () => {
  function groqFixture(reply = () => new Response('data: {"choices":[{"delta":{"content":"Groq response"}}]}\n\ndata: [DONE]\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  })) {
    vi.stubEnv("Groq_API_KEY", "fixture-groq");
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith("/models")) return Response.json({ data: [
        { id: "openai/gpt-oss-20b", active: true, context_window: 131_072 },
        { id: "openai/gpt-oss-120b", active: false, context_window: 131_072 },
        { id: "qwen/qwen3.8-27b", active: true, context_window: 131_072 },
      ] });
      const payload = JSON.parse(String(init?.body)) as { stream?: boolean };
      return payload.stream === false ? Response.json({ choices: [{ message: { content: '{"questions":[]}' } }] }) : reply();
    });
    return { request, adapter: new GroqProvider(request) };
  }

  it("uses the mixed-case key for metadata and requires a Free plan confirmation before selection", async () => {
    const groq = groqFixture();
    const gateway = new FreeAiGateway(routerFixture().adapter, [groq.adapter]);
    await expect(gateway.catalog()).resolves.toMatchObject({ providers: { groq: { status: "disabled", credential: "verified" } } });
    await expect(gateway.run("chat", () => assembly, firstToken, options())).rejects.toMatchObject({ code: "not_configured" });
    expect(groq.request).toHaveBeenCalledTimes(1);
    expect(groq.request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer fixture-groq" });
  });

  it("discovers only exact active production models and supports text and JSON output", async () => {
    const groq = groqFixture();
    vi.stubEnv("GROQ_API_KEY", "canonical-groq");
    vi.stubEnv("GROQ_FREE_PLAN_CONFIRMED", "true");
    const gateway = new FreeAiGateway(routerFixture().adapter, [groq.adapter]);
    const catalog = await gateway.catalog();
    expect(catalog.models.filter(({ gateway }) => gateway === "groq")).toMatchObject([{ id: groqId, cost: "free", media: [], structured: true }]);
    expect(groq.request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer canonical-groq" });
    const { result } = await gateway.run("chat", () => assembly, firstToken, { ...options(), model: groqId });
    expect(result.first).toBe("Groq response");
    expect(await result.tokens.next()).toMatchObject({ done: true });
    const json = await gateway.run("chat", () => ({ ...assembly, stream: false, response_format: { type: "json_object" } }),
      (response) => response.json(), { ...options(), model: groqId, requirements: { structured: true } });
    expect(json.result.choices[0].message.content).toBe('{"questions":[]}');
    expect(groq.request.mock.calls[2][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(String(groq.request.mock.calls[2][1]?.body))).toMatchObject({
      model: "openai/gpt-oss-20b", stream: false, include_reasoning: false, max_completion_tokens: 400,
      service_tier: "on_demand", response_format: { type: "json_object" },
    });
  });

  it("does not route image requests to Groq and honors organization Retry-After without retrying it", async () => {
    const groq = groqFixture(() => new Response(null, { status: 429, headers: { "Retry-After": "90" } }));
    vi.stubEnv("GROQ_FREE_PLAN_CONFIRMED", "true");
    const or = routerFixture();
    const gateway = new FreeAiGateway(or.adapter, [groq.adapter]);
    await expect(gateway.run("chat", () => assembly, firstToken, { ...options(), requirements: { media: ["image"] } }))
      .rejects.toMatchObject({ code: "no_free_route" });
    expect(groq.request).toHaveBeenCalledTimes(1);
    const quota = options();
    await expect(gateway.run("chat", () => assembly, firstToken, quota)).rejects.toMatchObject({ code: "rate_limited", retryAfter: 90 });
    await expect(gateway.run("chat", () => assembly, firstToken, quota)).rejects.toMatchObject({ code: "rate_limited", retryAfter: 90 });
    expect(groq.request).toHaveBeenCalledTimes(2);
    expect(quota.authorizeAttempt).toHaveBeenCalledTimes(1);
  });

  it("reads the Groq daily request reset when the response reports zero requests for the model", async () => {
    const groq = groqFixture(() => new Response(null, { status: 429, headers: {
      "X-RateLimit-Remaining-Requests": "0", "X-RateLimit-Reset-Requests": "2m59.56s", "Retry-After": "5",
    } }));
    vi.stubEnv("GROQ_FREE_PLAN_CONFIRMED", "true");
    const gateway = new FreeAiGateway(routerFixture().adapter, [groq.adapter]);
    await expect(gateway.run("chat", () => assembly, firstToken, options())).rejects.toMatchObject({
      code: "rate_limited", retryAfter: 180, scope: `groq:model:${groqId}`, category: "groq_model_daily", remainingRequests: 0,
    });
  });
});

describe("xAI billing and explicit selection", () => {
  function xaiFixture(price: number) {
    vi.stubEnv("XAI_API_KEY", "fixture-xai");
    vi.stubEnv("XAI_MODEL", "grok-4.7");
    const request = vi.fn<typeof fetch>(async (input) => String(input).endsWith("/language-models") ? Response.json({ models: [{
      id: "grok-4.7", input_modalities: ["text", "image"], output_modalities: ["text"],
      prompt_text_token_price: price, cached_prompt_text_token_price: 0, prompt_image_token_price: price, completion_text_token_price: price,
    }] }) : eventStream({ type: "response.output_text.delta", delta: "Optional Grok response" }, { type: "response.completed" }));
    return { request, adapter: new XaiProvider(request) };
  }

  it("validates credentials using metadata and keeps billed models disabled without express paid authorization", async () => {
    const xai = xaiFixture(500);
    vi.stubEnv("XAI_INFERENCE_MODE", "");
    await expect(xai.adapter.credentialStatus()).resolves.toBe("verified");
    await expect(xai.adapter.models("chat")).resolves.toEqual([]);
    vi.stubEnv("XAI_INFERENCE_MODE", "verified_zero_cost");
    await expect(xai.adapter.models("chat")).resolves.toEqual([]);
    expect(xai.request).toHaveBeenCalledTimes(1);
    expect(xai.request.mock.calls[0][0]).toBe("https://api.x.ai/v1/language-models");
  });

  it("never uses paid xAI automatically and supports explicit authorized streaming", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-openrouter");
    vi.stubEnv("XAI_INFERENCE_MODE", "paid_authorized");
    const xai = xaiFixture(500);
    const or = routerFixture();
    const gateway = new FreeAiGateway(or.adapter, [xai.adapter]);
    const automatic = await gateway.run("chat", () => assembly, firstToken, options());
    expect(automatic.model.id).toBe(openRouterId);
    await automatic.result.tokens.return(undefined);
    expect(xai.request).not.toHaveBeenCalled();
    const paid = await gateway.run("chat", () => assembly, firstToken, { ...options(), model: xaiId });
    expect(paid.model.cost).toBe("paid");
    expect(paid.result.first).toBe("Optional Grok response");
    expect(await paid.result.tokens.next()).toMatchObject({ done: true });
    expect(xai.request.mock.calls[1][0]).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(String(xai.request.mock.calls[1][1]?.body))).toMatchObject({ model: "grok-4.7", stream: true, store: false, max_output_tokens: 400 });
  });
});

it("holds the provider concurrency slot for an active stream and releases it on cancellation", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-openrouter");
  const or = routerFixture();
  const open = () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"First"}}]}\n\n'));
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
  or.send.mockImplementation(async () => open());
  const gateway = new FreeAiGateway(or.adapter, [], 1);
  const quota = options();
  const running = await gateway.run("chat", () => assembly, firstToken, quota);
  await expect(gateway.run("chat", () => assembly, firstToken, quota)).rejects.toMatchObject({ code: "provider_busy" });
  expect(quota.authorizeAttempt).toHaveBeenCalledTimes(1);
  await running.result.tokens.return(undefined);
  const next = await gateway.run("chat", () => assembly, firstToken, { ...quota, signal: AbortSignal.timeout(2000) });
  await next.result.tokens.return(undefined);
  expect(quota.authorizeAttempt).toHaveBeenCalledTimes(2);
});
