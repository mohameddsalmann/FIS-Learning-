import "server-only";
import { z } from "zod";
import { AiError, aiErrorFor } from "./errors";
import { durationSeconds, nonnegativeInteger, parseProviderChat, retryAfterSeconds, upstreamError,
  type AiModel, type CredentialStatus, type InferenceProvider } from "./provider";
import type { Capability } from "./registry";

const origin = "https://api.groq.com/openai/v1";
const freeTextModels = [
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
] as const;
const catalog = z.object({ data: z.array(z.unknown()) });
const catalogEntry = z.object({ id: z.string(), active: z.literal(true), context_window: z.number().int().positive() });

function groqKey() {
  return process.env.GROQ_API_KEY?.trim() || process.env.Groq_API_KEY?.trim();
}

export class GroqProvider implements InferenceProvider {
  readonly id = "groq";
  private cache?: { key: string; expiresAt: number; result: Promise<AiModel[]> };

  constructor(private readonly request: typeof fetch = fetch) {}

  configured() { return Boolean(groqKey()); }
  enabled() { return this.configured() && process.env.GROQ_FREE_PLAN_CONFIRMED === "true"; }

  hasModel(kind: Capability, id: string) { return kind === "chat" && freeTextModels.some((model) => id === `groq/${model.id}`); }

  private async query(endpoint: "/models" | "/chat/completions", key: string, init: RequestInit, modelId?: string) {
    const response = await this.request(origin + endpoint, {
      ...init, cache: "no-store", redirect: "error", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    if (response.ok) return response;
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) {
      const remain = nonnegativeInteger(response.headers.get("X-RateLimit-Remaining-Requests"));
      const tokens = nonnegativeInteger(response.headers.get("X-RateLimit-Remaining-Tokens"));
      const modelScoped = Boolean(modelId) && (remain === 0 || tokens === 0);
      const wait = Math.max(retryAfterSeconds(response.headers.get("Retry-After")) ?? 0,
        remain === 0 ? durationSeconds(response.headers.get("X-RateLimit-Reset-Requests")) ?? 0 : 0,
        tokens === 0 ? durationSeconds(response.headers.get("X-RateLimit-Reset-Tokens")) ?? 0 : 0);
      const category = modelScoped ? (remain === 0 ? "groq_model_daily" : "groq_model") : "groq_organization";
      throw new AiError("rate_limited", wait || undefined, modelScoped ? `groq:model:${modelId}` : "groq", category, remain);
    }
    throw upstreamError(response.status);
  }

  private async fetchModels(key: string): Promise<AiModel[]> {
    const response = await this.query("/models", key, { signal: AbortSignal.timeout(4000) });
    const parsed = catalog.safeParse(await response.json());
    if (!parsed.success) throw new AiError("invalid_response");
    const available = new Map<string, z.infer<typeof catalogEntry>>();
    for (const row of parsed.data.data) {
      const entry = catalogEntry.safeParse(row);
      if (entry.success) available.set(entry.data.id, entry.data);
    }
    return freeTextModels.flatMap(({ id, name }) => {
      const active = available.get(id);
      return active ? [{ id: `groq/${id}`, name, provider: "Groq", kind: "chat", cost: "free", availability: "available",
        inputs: ["text"], outputs: ["text"], media: [], contextLength: active.context_window, structured: true,
        detail: "Groq Free plan · Tutor and practice" }] : [];
    });
  }

  private discover() {
    const key = groqKey();
    if (!key) throw new AiError("not_configured");
    if (this.cache?.key === key && this.cache.expiresAt > Date.now()) return this.cache.result;
    const cache = { key, expiresAt: Date.now() + 300_000, result: this.fetchModels(key).catch((error: unknown) => {
      cache.expiresAt = Date.now() + 15_000;
      throw aiErrorFor(error);
    }) };
    this.cache = cache;
    return cache.result;
  }

  async credentialStatus(): Promise<CredentialStatus> {
    if (!this.configured()) return "missing";
    try { await this.discover(); return "verified"; }
    catch (error) { return aiErrorFor(error).code === "invalid_credentials" ? "rejected" : "unverified"; }
  }

  async models(kind: Capability) { return kind === "chat" && this.enabled() ? this.discover() : []; }

  async verify(model: AiModel) {
    return model.cost === "free" && (await this.models(model.kind)).some(({ id }) => id === model.id) ? "Groq" : null;
  }

  async send(model: AiModel, payload: Record<string, unknown>, _apiKey: string | undefined, signal: AbortSignal) {
    const key = groqKey();
    if (!key || !this.enabled()) throw new AiError("billing_unavailable");
    if (!(await this.verify(model))) throw new AiError("no_free_route");
    const request = parseProviderChat(payload);
    if (request.messages.some(({ content }) => typeof content !== "string")) throw new AiError("unsupported_media");
    if (request.stream && request.response_format) throw new AiError("bad_request");
    return this.query("/chat/completions", key, {
      method: "POST", signal, body: JSON.stringify({
        model: model.id.slice("groq/".length), messages: request.messages, stream: request.stream,
        temperature: request.temperature, max_completion_tokens: request.max_tokens, reasoning_effort: "low",
        include_reasoning: false, service_tier: "on_demand",
        ...(request.response_format ? { response_format: request.response_format } : {}),
      }),
    }, model.id);
  }
}
