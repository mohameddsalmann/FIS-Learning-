import { z } from "zod";
import { AiError } from "./errors";

export const inferencePaths = {
  chat: "/api/v1/chat/completions",
  image: "/api/v1/images",
  speech: "/api/v1/audio/speech",
  decision: "/api/alpha/decisions",
  embedding: "/api/v1/embeddings",
  rerank: "/api/v1/rerank",
} as const;
export type Capability = keyof typeof inferencePaths;
export type AiAvailability = "available" | "degraded" | "unavailable";
type Media = "image" | "video";

export interface FreeModel {
  id: string;
  name: string;
  kind: Capability;
  cost: "free";
  provider: string;
  inputs: readonly string[];
  outputs: readonly string[];
  media: Media[];
  availability: AiAvailability;
  contextLength: number | null;
  expires?: string;
  detail: string;
  structured: boolean;
}

const knownIds: Record<Capability, readonly string[]> = {
  // Preserve tutor-friendly priorities. Privacy-sensitive uploads use the Gemma routes.
  chat: [
    "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.2-flash:free", "baidu/ernie-5.5-flash-preview:free",
    "thinkingmachines/inkling-2-small:free", "particle-ai/particle-1:free",
    "recursive/flint-v1.0:free", "nvidia/nemotron-3.5-super-vl:free",
    "dots-studio/dots-3-note-preview:free", "nvidia/nemotron-3.5-lightning:free",
    "cohere/north-mini-code:free", "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "liquid/lfm-3-1.7b:free",
  ],
  image: ["recraft/recraft-v4.1-flash-v2:free"],
  speech: ["fish-audio/s2.1-pro-free:free", "heygen/heygen-voice-1-turbo:free"],
  decision: [
    "perplexity/pplx-decider-flash-v1.3:free", "perplexity/pplx-decider-v1.3:free",
    "respan/span-01-lite:free",
  ],
  embedding: [
    "nvidia/nemotron-3.5-embed-1b:free", "nvidia/nemotron-3.5-embed-8b:free",
    "nvidia/nemotron-3-embed-1b:free",
  ],
  rerank: ["nvidia/nemotron-3.5-rerank-8b:free"],
};

const outputByKind: Record<Capability, string> = {
  chat: "text", image: "image", speech: "speech", decision: "decisions",
  embedding: "embeddings", rerank: "rerank",
};

const catalogSchema = z.object({ data: z.array(z.unknown()) });
const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  architecture: z.object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) }),
  pricing: z.record(z.string(), z.unknown()),
  endpoints: z.array(z.string()),
  supported_parameters: z.array(z.string()).nullish(),
  context_length: z.number().nonnegative().nullish(),
  expiration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
const endpointsSchema = z.object({
  data: z.object({
    id: z.string(),
    endpoints: z.array(z.object({
      model_id: z.string(),
      provider_name: z.string(),
      pricing: z.record(z.string(), z.unknown()),
      status: z.number(),
    })),
  }),
});

const details: Record<Capability, string> = {
  chat: "Tutor chat", image: "Study illustrations", speech: "Read tutor replies aloud",
  decision: "Review answer coverage", embedding: "Semantic search", rerank: "Search result ranking",
};
const metadataTtl = 5 * 60_000;
const failureTtl = 15_000;
const origin = "https://openrouter.ai";

export function isZeroPriced(pricing: Record<string, unknown>) {
  const zero = (value: unknown) => value === 0 || (typeof value === "string" && /^0(?:\.0+)?$/.test(value));
  return zero(pricing.prompt) && zero(pricing.completion)
    && Object.entries(pricing).every(([key, value]) => key === "discount" || zero(value));
}

export function readFreeModels(data: unknown, kind: Capability, now = Date.now()): FreeModel[] {
  const rows = catalogSchema.safeParse(data);
  if (!rows.success) throw new AiError("unavailable");
  const cutoff = new Date(now).toISOString().slice(0, 10);
  const verified = new Map<string, FreeModel>();
  for (const entry of rows.data.data) {
    const result = modelSchema.safeParse(entry);
    if (!result.success) continue;
    const model = result.data;
    const inputs = model.architecture.input_modalities;
    const outputs = model.architecture.output_modalities;
    if (!knownIds[kind].includes(model.id) || !isZeroPriced(model.pricing)
      || !model.endpoints.includes(inferencePaths[kind]) || !inputs.includes("text") || !outputs.includes(outputByKind[kind])
      || (model.expiration_date && model.expiration_date <= cutoff)) continue;

    // Only permit personal image/video inputs on the reviewed Gemma adapter variants.
    const media = kind === "chat" && model.id.startsWith("google/gemma-4-")
      ? (["image", "video"] as const).filter((type) => inputs.includes(type)) : [];
    const detail = model.id === "liquid/lfm-3-1.7b:free"
      ? "Tutor chat. The provider may use prompts for training." : details[kind];
    verified.set(model.id, {
      id: model.id, name: model.name.replace(/ \(free\)$/i, ""), kind, cost: "free", provider: model.id.split("/")[0],
      inputs, outputs, media, detail, availability: "available", contextLength: model.context_length || null,
      expires: model.expiration_date ?? undefined, structured: model.supported_parameters?.includes("response_format") ?? false,
    });
  }
  return knownIds[kind].flatMap((id) => verified.get(id) ?? []);
}

export function hasKnownModel(kind: Capability, id: string) {
  return knownIds[kind].includes(id);
}

interface Cached<Value> {
  expiresAt: number;
  result: Promise<Value>;
}

export class OpenRouterRegistry {
  private readonly catalog = new Map<Capability, Cached<FreeModel[]>>();
  private readonly endpoints = new Map<string, Cached<string | null>>();

  constructor(private readonly request: typeof fetch = fetch, private readonly now = Date.now) {}

  private async read(path: string): Promise<unknown> {
    const response = await this.request(origin + path, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiError("unavailable");
    }
    return response.json();
  }

  models(kind: Capability): Promise<FreeModel[]> {
    const current = this.catalog.get(kind);
    if (current && current.expiresAt > this.now()) return current.result;
    const path = kind === "chat" ? "/api/v1/models" : "/api/v1/models?output_modalities=" + outputByKind[kind];
    const entry: Cached<FreeModel[]> = {
      expiresAt: this.now() + metadataTtl,
      result: this.read(path).then((data) => readFreeModels(data, kind, this.now())).catch(() => {
        entry.expiresAt = this.now() + failureTtl;
        throw new AiError("unavailable");
      }),
    };
    this.catalog.set(kind, entry);
    return entry.result;
  }

  /** Catalog prices alone cannot prove all routes compatible with a model are free. */
  provider(model: FreeModel): Promise<string | null> {
    const current = this.endpoints.get(model.id);
    if (current && current.expiresAt > this.now()) return current.result;
    const entry: Cached<string | null> = {
      expiresAt: this.now() + metadataTtl,
      result: this.read("/api/v1/models/" + model.id + "/endpoints").then((data) => {
        const result = endpointsSchema.safeParse(data);
        if (!result.success || result.data.data.id !== model.id) return null;
        const endpoints = result.data.data.endpoints;
        // Some specialist APIs ignore routing options. Reject mixed pricing rather than relying on those options.
        if (!endpoints.length || endpoints.some((endpoint) => endpoint.model_id !== model.id || !isZeroPriced(endpoint.pricing))) return null;
        return endpoints.find((endpoint) => endpoint.status === 0)?.provider_name ?? null;
      }).catch(() => null).then((provider) => {
        if (!provider) entry.expiresAt = this.now() + failureTtl;
        return provider;
      }),
    };
    this.endpoints.set(model.id, entry);
    return entry.result;
  }
}
