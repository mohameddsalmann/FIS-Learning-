import "server-only";
import { z } from "zod";
import { AiError, aiErrorFor } from "./errors";
import { chatJson, chatStream, parseProviderChat, readSseData, upstreamError, type AiModel, type CredentialStatus, type InferenceProvider } from "./provider";
import type { Capability } from "./registry";

const api = "https://api.x.ai/v1";
const catalog = z.object({ models: z.array(z.unknown()) });
const modelRow = z.looseObject({
  id: z.string(), input_modalities: z.array(z.string()), output_modalities: z.array(z.string()),
  context_length: z.number().int().positive().optional(), long_context_threshold: z.number().int().nonnegative().optional(),
  capabilities: z.object({ reasoning_effort: z.array(z.string()).optional() }).optional(),
});
type ModelRow = z.infer<typeof modelRow>;

function modelId() {
  const value = process.env.XAI_MODEL?.trim();
  return value && /^grok-[\da-z.-]{1,70}$/.test(value) && !value.endsWith("-latest") ? value : undefined;
}

function inferenceMode() {
  const value = process.env.XAI_INFERENCE_MODE;
  return value === "verified_zero_cost" || value === "paid_authorized" ? value : undefined;
}

function zeroPrice(row: ModelRow) {
  const required = ["prompt_text_token_price", "cached_prompt_text_token_price", "completion_text_token_price"];
  if (row.input_modalities.includes("image")) required.push("prompt_image_token_price");
  if (row.long_context_threshold && row.long_context_threshold > 0) {
    required.push("prompt_text_token_price_long_context", "cached_prompt_text_token_price_long_context", "completion_text_token_price_long_context");
  }
  return required.every((field) => row[field] === 0)
    && Object.entries(row).every(([field, price]) => !field.includes("_price") || price === 0);
}

function responseText(input: unknown) {
  const result = z.object({ status: z.literal("completed"), output: z.array(z.object({
    type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })) }).safeParse(input);
  if (!result.success) throw new AiError("invalid_response");
  const text = result.data.output.flatMap((entry) => entry.type === "message"
    ? (entry.content ?? []).flatMap((part) => part.type === "output_text" ? [part.text ?? ""] : []) : []).join("");
  return chatJson(text);
}

async function* xaiTokens(response: Response) {
  for await (const data of readSseData(response)) {
    if (data === "[DONE]") break;
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { throw new AiError("invalid_response"); }
    const event = z.object({ type: z.string(), delta: z.string().optional() }).safeParse(parsed);
    if (!event.success) throw new AiError("invalid_response");
    if (event.data.type === "response.output_text.delta" && event.data.delta) yield event.data.delta;
    if (event.data.type === "response.refusal.delta") throw new AiError("content_blocked");
    if (event.data.type === "response.completed") return;
    if (event.data.type === "response.failed" || event.data.type === "response.incomplete" || event.data.type === "error") {
      throw new AiError("invalid_response");
    }
  }
  throw new AiError("invalid_response");
}

export class XaiProvider implements InferenceProvider {
  readonly id = "xai";
  private metadata?: { key: string; expiresAt: number; result: Promise<ModelRow[]> };

  constructor(private readonly request: typeof fetch = fetch) {}

  configured() { return Boolean(process.env.XAI_API_KEY?.trim()); }
  enabled() { return this.configured() && Boolean(modelId() && inferenceMode()); }

  hasModel(kind: Capability, id: string) { return kind === "chat" && Boolean(modelId()) && id === `xai/${modelId()}`; }

  private async query(path: string, key: string, init: RequestInit) {
    const response = await this.request(api + path, {
      ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      cache: "no-store", redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw upstreamError(response.status);
    }
    return response;
  }

  private discover() {
    const key = process.env.XAI_API_KEY?.trim();
    if (!key) throw new AiError("not_configured");
    if (this.metadata?.key === key && this.metadata.expiresAt > Date.now()) return this.metadata.result;
    const entry = { key, expiresAt: Date.now() + 300_000, result: this.query("/language-models", key, { signal: AbortSignal.timeout(4_000) })
      .then(async (response) => {
        const result = catalog.safeParse(await response.json());
        if (!result.success) throw new AiError("invalid_response");
        return result.data.models.flatMap((entry) => {
          const parsed = modelRow.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        });
      }).catch((error: unknown) => {
        entry.expiresAt = Date.now() + 15_000;
        throw aiErrorFor(error);
      }) };
    this.metadata = entry;
    return entry.result;
  }

  async credentialStatus(): Promise<CredentialStatus> {
    if (!this.configured()) return "missing";
    try { await this.discover(); return "verified"; }
    catch (error) { return aiErrorFor(error).code === "invalid_credentials" ? "rejected" : "unverified"; }
  }

  private async eligible() {
    const id = modelId();
    const mode = inferenceMode();
    if (!id || !mode || !this.configured()) return null;
    const model = (await this.discover()).find((item) => item.id === id);
    if (!model?.input_modalities.includes("text") || !model.output_modalities.includes("text")) return null;
    if (mode === "verified_zero_cost" && !zeroPrice(model)) return null;
    return { model, cost: zeroPrice(model) ? "free" as const : "paid" as const };
  }

  async models(kind: Capability): Promise<AiModel[]> {
    if (kind !== "chat") return [];
    const active = await this.eligible();
    if (!active) return [];
    const { model, cost } = active;
    const media: AiModel["media"] = model.input_modalities.includes("image") ? ["image"] : [];
    return [{
      id: `xai/${model.id}`, provider: "xAI", kind, cost, name: model.id === "grok-4.7" ? "Grok 4.7" : model.id,
      availability: "available", inputs: ["text", ...media], outputs: ["text"], media,
      contextLength: model.context_length ?? (model.id === "grok-4.7" ? 500_000 : null), structured: false,
      detail: cost === "paid" ? "Manual only · Owner-authorized paid inference" : "Manual only · Verified zero-cost route",
    }];
  }

  async verify(model: AiModel) {
    return (await this.models(model.kind)).some(({ id, cost }) => id === model.id && cost === model.cost) ? "xAI" : null;
  }

  async send(model: AiModel, payload: Record<string, unknown>, _apiKey: string | undefined, signal: AbortSignal) {
    const key = process.env.XAI_API_KEY?.trim();
    const allowed = await this.eligible();
    if (!key || !allowed || model.id !== `xai/${allowed.model.id}` || model.cost !== allowed.cost) throw new AiError("billing_unavailable");
    const request = parseProviderChat(payload);
    const input = request.messages.map(({ role, content }) => {
      if (typeof content === "string") return { role, content };
      return { role, content: content.map((part) => {
        if (part.type === "text") return { type: "input_text", text: part.text };
        if (part.type === "image_url" && /^data:image\/(?:jpeg|png|webp);base64,[\w+/=]+$/.test(part.image_url.url)) {
          return { type: "input_image", image_url: part.image_url.url };
        }
        throw new AiError("unsupported_media");
      }) };
    });
    const lowEffort = allowed.model.capabilities?.reasoning_effort?.includes("low") || allowed.model.id === "grok-4.7";
    const response = await this.query("/responses", key, {
      method: "POST", signal, body: JSON.stringify({
        model: allowed.model.id, input, stream: request.stream, store: false, temperature: request.temperature,
        max_output_tokens: request.max_tokens, ...(lowEffort ? { reasoning: { effort: "low" } } : {}),
      }),
    });
    return request.stream ? chatStream(xaiTokens(response)) : responseText(await response.json());
  }
}
