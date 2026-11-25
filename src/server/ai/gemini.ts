import "server-only";
import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentResponse, type Model, type Part } from "@google/genai";
import { z } from "zod";
import { AiError, aiErrorFor } from "./errors";
import { chatJson, chatStream, durationSeconds, objectFields, parseProviderChat, providerUsage, secondsUntilMidnight, upstreamError,
  type AiModel, type CredentialStatus, type InferenceProvider, type ProviderUsage } from "./provider";
import type { Capability } from "./registry";

const flash = "gemini-3.8-flash";
const flash36 = "gemini-3.6-flash";
const flashLite = "gemini-3.5-flash-lite";
const embedding = "gemini-embedding-2";
const googleModelIds = {
  chat: [flashLite, flash, flash36],
  embedding: [embedding],
} satisfies Partial<Record<Capability, readonly string[]>>;
const catalogCacheMs = 300_000;
const failureCacheMs = 15_000;
const embeddingDimensions = 2048;

interface GeminiKey {
  value: string;
  confirmed: boolean;
}

function configuredKeys(): GeminiKey[] {
  const primary = process.env.GEMINI_API_KEY_PRIMARY?.trim() || process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  const secondary = process.env.GEMINI_API_KEY_SECONDARY?.trim();
  return [
    ...(primary ? [{ value: primary, confirmed: process.env.GEMINI_PRIMARY_FREE_TIER_CONFIRMED === "true" }] : []),
    ...(secondary && secondary !== primary ? [{ value: secondary, confirmed: process.env.GEMINI_SECONDARY_FREE_TIER_CONFIRMED === "true" }] : []),
  ];
}

function geminiError(error: unknown, id?: string) {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    if (error.status === 429 || /\b(?:RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|QUOTA_EXCEEDED|QuotaFailure)\b/.test(message)) {
      // The SDK preserves the Google error envelope in ApiError.message.
      let body: unknown;
      try { body = JSON.parse(message.slice(message.indexOf("{"))); } catch { /* No structured quota details. */ }
      const fields = objectFields(objectFields(body).error);
      const details = Array.isArray(fields.details) ? fields.details.map(objectFields) : [];
      const violations = details.filter((entry) => String(entry["@type"]).endsWith("/google.rpc.QuotaFailure"))
        .flatMap((entry) => Array.isArray(entry.violations) ? entry.violations.map(objectFields) : []);
      const daily = violations.some((quota) => /per.?day|daily/i.test(String(quota.quotaId ?? quota.quotaMetric)));
      const modelScoped = Boolean(id) && violations.length > 0 && violations.every((quota) =>
        typeof objectFields(quota.quotaDimensions).model === "string" || /per.?model/i.test(String(quota.quotaId)),
      );
      const retry = details.find((entry) => String(entry["@type"]).endsWith("/google.rpc.RetryInfo"));
      const providerWait = durationSeconds(retry?.retryDelay);
      const wait = daily ? Math.max(providerWait ?? 0, secondsUntilMidnight("America/Los_Angeles")) : providerWait;
      const category = modelScoped ? (daily ? "gemini_model_daily" : "gemini_model") : (daily ? "gemini_project_daily" : "gemini_project");
      return new AiError("rate_limited", wait, modelScoped ? `gemini:model:google/${id}` : "gemini", category);
    }
    if (error.status === 400 && /\bAPI_KEY_(?:INVALID|EXPIRED|SERVICE_BLOCKED|HTTP_REFERRER_BLOCKED|IP_ADDRESS_BLOCKED)\b/.test(message)) {
      return new AiError("invalid_credentials", undefined, undefined, "credentials");
    }
    if (error.status === 400 && /\bFAILED_PRECONDITION\b/.test(message)) return new AiError("billing_unavailable", undefined, undefined, "billing");
    if (error.status === 400) return new AiError("unsupported_media", undefined, undefined, "unsupported");
    return upstreamError(error.status);
  }
  return aiErrorFor(error);
}

function contentParts(value: ReturnType<typeof parseProviderChat>["messages"][number]["content"]): Part[] {
  if (typeof value === "string") return [{ text: value }];
  return value.map((part) => {
    if (part.type === "text") return { text: part.text };
    const url = part.type === "image_url" ? part.image_url.url : part.video_url.url;
    const inline = /^data:(image\/(?:jpeg|png|webp)|video\/mp4);base64,([\w+/=]+)$/.exec(url);
    if (!inline) throw new AiError("unsupported_media");
    return { inlineData: { mimeType: inline[1], data: inline[2] } };
  });
}

const validGeminiFinish = new Set(["STOP", "MAX_TOKENS"]);
const safetyFinish = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);

function checkGeminiResponse(value: GenerateContentResponse) {
  const finishReason = value.candidates?.[0]?.finishReason;
  if ((value.promptFeedback?.blockReason && value.promptFeedback.blockReason !== "BLOCKED_REASON_UNSPECIFIED")
    || (finishReason && safetyFinish.has(finishReason))) throw new AiError("content_blocked");
  if (finishReason && finishReason !== "FINISH_REASON_UNSPECIFIED" && !validGeminiFinish.has(finishReason)) {
    throw new AiError("invalid_response");
  }
  return finishReason;
}

async function* geminiTokens(events: AsyncIterable<GenerateContentResponse>, id: string, usage: ProviderUsage) {
  let complete = false;
  try {
    for await (const event of events) {
      const observed = providerUsage(event);
      if (observed.inputTokens !== undefined) usage.inputTokens = observed.inputTokens;
      if (observed.outputTokens !== undefined) usage.outputTokens = observed.outputTokens;
      const finish = checkGeminiResponse(event);
      if (finish && validGeminiFinish.has(finish)) complete = true;
      if (event.text) yield event.text;
    }
    if (!complete) throw new AiError("invalid_response");
  } catch (error) {
    throw geminiError(error, id);
  }
}

const embeddingInput = z.object({ input: z.array(z.string()).min(1).max(65) });

export class GeminiProvider implements InferenceProvider {
  readonly id = "gemini";
  private readonly clients = new Map<string, GoogleGenAI>();
  private readonly metadata = new Map<string, { key: string; expiresAt: number; result: Promise<Model> }[]>();
  private readonly authDeniedUntil = new Map<string, number>();

  constructor(private readonly createClient = (value: string) => new GoogleGenAI({
    apiKey: value, vertexai: false,
    httpOptions: { baseUrl: "https://generativelanguage.googleapis.com", apiVersion: "v1beta", retryOptions: { attempts: 1 } },
  })) {}

  configured() { return configuredKeys().length > 0; }
  enabled() { return configuredKeys().some((key) => key.confirmed); }

  private nativeIds(kind: Capability): readonly string[] {
    return kind === "chat" || kind === "embedding" ? googleModelIds[kind] : [];
  }

  hasModel(kind: Capability, id: string) {
    return id.startsWith("google/") && this.nativeIds(kind).includes(id.slice("google/".length));
  }

  private client(key: GeminiKey) {
    let client = this.clients.get(key.value);
    if (!client) {
      client = this.createClient(key.value);
      this.clients.set(key.value, client);
    }
    return client;
  }

  private metadataFor(key: GeminiKey, id: string) {
    if ((this.authDeniedUntil.get(key.value) ?? 0) > Date.now()) return Promise.reject(new AiError("invalid_credentials"));
    const entries = this.metadata.get(id) ?? [];
    const cached = entries.find((entry) => entry.key === key.value && entry.expiresAt > Date.now());
    if (cached) return cached.result;
    const entry = {
      key: key.value, expiresAt: Date.now() + catalogCacheMs,
      result: this.client(key).models.get({ model: id, config: { abortSignal: AbortSignal.timeout(4_000) } }).catch((error: unknown) => {
        entry.expiresAt = Date.now() + failureCacheMs;
        throw geminiError(error, id);
      }),
    };
    this.metadata.set(id, [...entries.filter((existing) => existing.key !== key.value), entry]);
    return entry.result;
  }

  private async discover(id: string, confirmedOnly: boolean) {
    const keys = configuredKeys().filter((key) => !confirmedOnly || key.confirmed);
    let authError: AiError | undefined;
    for (const key of keys) {
      try { return { model: await this.metadataFor(key, id), key }; }
      catch (error) {
        const cause = geminiError(error);
        if (cause.code !== "invalid_credentials") throw cause;
        authError = cause;
      }
    }
    throw authError ?? new AiError("not_configured");
  }

  async credentialStatus(): Promise<CredentialStatus> {
    if (!this.configured()) return "missing";
    try {
      await this.discover(flash, this.enabled());
      return "verified";
    } catch (error) {
      return geminiError(error).code === "invalid_credentials" ? "rejected" : "unverified";
    }
  }

  private descriptor(kind: Capability, id: string, model: Model): AiModel | null {
    const method = kind === "embedding" ? "embedContent" : "generateContent";
    if (model.name !== `models/${id}` || !model.supportedActions?.includes(method)) return null;
    const contextLength = model.inputTokenLimit;
    if (!contextLength || !Number.isSafeInteger(contextLength) || contextLength < 1) return null;
    const media: AiModel["media"] = kind === "chat" ? ["image", "video"] : [];
    return {
      id: `google/${id}`, kind, cost: "free", provider: "Google Gemini", availability: "available",
      name: id === flashLite ? "Gemini 3.5 Flash-Lite" : id === flash ? "Gemini 3.8 Flash" : id === flash36 ? "Gemini 3.6 Flash" : "Gemini Embedding 2",
      inputs: ["text", ...media], outputs: [kind === "chat" ? "text" : "embeddings"], media, contextLength,
      detail: kind === "chat" ? "Google Gemini Free Tier · Tutor and practice" : "Google Gemini Free Tier · Search materials",
      structured: kind === "chat",
    };
  }

  async models(kind: Capability): Promise<AiModel[]> {
    if (!this.enabled()) return [];
    const ids = this.nativeIds(kind);
    const discovered = await Promise.allSettled(ids.map(async (id) => this.descriptor(kind, id, (await this.discover(id, true)).model)));
    const present = discovered.flatMap((item) => item.status === "fulfilled" && item.value ? [item.value] : []);
    const first = discovered[0];
    if (first?.status === "rejected" && discovered.every((item) => item.status === "rejected")) throw first.reason;
    return present;
  }

  async verify(model: AiModel) {
    if (!this.enabled() || !this.hasModel(model.kind, model.id)) return null;
    const id = model.id.slice("google/".length);
    return this.descriptor(model.kind, id, (await this.discover(id, true)).model)?.provider ?? null;
  }

  async send(model: AiModel, payload: Record<string, unknown>, _apiKey: string | undefined, signal: AbortSignal, reserveRetry: (failure?: AiError) => Promise<void>) {
    if (model.cost !== "free" || !this.hasModel(model.kind, model.id)) throw new AiError("no_free_route");
    const id = model.id.slice("google/".length);
    const primary = await this.discover(id, true);
    if (!this.descriptor(model.kind, id, primary.model)) throw new AiError("no_free_route");
    try { return await this.generate(this.client(primary.key), model.kind, id, payload, signal); }
    catch (error) {
      const cause = geminiError(error, id);
      if (cause.code !== "invalid_credentials") throw cause;
      this.authDeniedUntil.set(primary.key.value, Date.now() + failureCacheMs);
      const credentials = configuredKeys();
      const next = credentials[1];
      // A configured, attested secondary can take over only from the first configured key's auth failure.
      if (!next?.confirmed || credentials[0]?.value !== primary.key.value) throw cause;
      const metadata = await this.metadataFor(next, id);
      if (!this.descriptor(model.kind, id, metadata)) throw cause;
      await reserveRetry(cause);
      return await this.generate(this.client(next), model.kind, id, payload, signal).catch((secondary) => { throw geminiError(secondary, id); });
    }
  }

  private async generate(client: GoogleGenAI, kind: Capability, id: string, payload: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    if (kind === "embedding") {
      const { input } = embeddingInput.parse(payload);
      const response = await client.models.embedContent({
        model: id,
        // One Content per source prevents several passages from becoming a single embedding.
        contents: input.map((text) => ({ role: "user", parts: [{ text }] })),
        config: { outputDimensionality: embeddingDimensions, abortSignal: signal },
      });
      if (response.embeddings?.some(({ values }) => values?.length !== embeddingDimensions)) throw new AiError("invalid_response");
      return Response.json({ data: response.embeddings?.map((item, index) => ({ index, embedding: item.values })) });
    }
    const request = parseProviderChat(payload);
    const instructions = request.messages.filter(({ role }) => role === "system").flatMap(({ content }) => contentParts(content));
    const contents: Content[] = request.messages.filter(({ role }) => role !== "system").map(({ role, content }) => ({
      role: role === "assistant" ? "model" : "user", parts: contentParts(content),
    }));
    const generation = {
      model: id, contents,
      config: {
        abortSignal: signal, systemInstruction: { parts: instructions }, temperature: request.temperature,
        maxOutputTokens: request.max_tokens, thinkingConfig: { thinkingLevel: id === flash ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL },
        ...(request.response_format ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (request.stream) {
      const usage: ProviderUsage = {};
      return chatStream(geminiTokens(await client.models.generateContentStream(generation), id, usage), () => usage);
    }
    const response = await client.models.generateContent(generation);
    checkGeminiResponse(response);
    return chatJson(response.text, providerUsage(response));
  }
}
