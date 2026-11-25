import { z } from "zod";
import { AiError } from "./errors";
import type { Capability, FreeModel } from "./registry";

export type ProviderId = "openrouter" | "gemini" | "groq" | "xai";
export type ProviderStatus = "available" | "degraded" | "unavailable" | "not_configured" | "disabled";
export type CredentialStatus = "verified" | "rejected" | "missing" | "unverified";
export type AiModel = Omit<FreeModel, "cost"> & { cost: "free" | "paid" };

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  remainingRequests?: number;
}

export interface InferenceProvider {
  id: ProviderId;
  configured(): boolean;
  enabled(): boolean;
  hasModel(kind: Capability, id: string): boolean;
  credentialStatus?(): Promise<CredentialStatus>;
  models(kind: Capability): Promise<AiModel[]>;
  verify(model: AiModel): Promise<string | null>;
  send(model: AiModel, payload: Record<string, unknown>, apiKey: string | undefined, signal: AbortSignal, reserveRetry: (failure?: AiError) => Promise<void>): Promise<Response>;
}

export function upstreamError(status: number) {
  if (status === 401 || status === 403) return new AiError("invalid_credentials", undefined, undefined, "credentials");
  if (status === 402) return new AiError("billing_unavailable", undefined, undefined, "billing");
  if (status === 404) return new AiError("no_free_route", undefined, undefined, "unsupported");
  if (status === 408 || status === 504) return new AiError("timeout", undefined, undefined, "timeout");
  if (status === 429) return new AiError("rate_limited");
  if (status >= 500) return new AiError("unavailable", undefined, undefined, "unavailable");
  return new AiError("invalid_response");
}

export function objectFields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function nonnegativeInteger(value: unknown) {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

export function providerUsage(value: unknown): ProviderUsage {
  const response = objectFields(value);
  const usage = objectFields(response.usage ?? objectFields(response.x_groq).usage);
  const google = objectFields(response.usageMetadata);
  return {
    inputTokens: nonnegativeInteger(usage.prompt_tokens ?? usage.input_tokens ?? google.promptTokenCount),
    outputTokens: nonnegativeInteger(usage.completion_tokens ?? usage.output_tokens ?? google.candidatesTokenCount),
  };
}

export function durationSeconds(value: unknown) {
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d+)?(?:h|m(?!s)|ms|s))+$/.test(value)) return undefined;
  const units: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };
  return Math.ceil(Array.from(value.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s)/g))
    .reduce((sum, [, number, unit]) => sum + Number(number) * units[unit], 0));
}

export function retryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value?.trim()) return undefined;
  const wait = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(wait) && wait >= 0 ? Math.max(1, Math.ceil(wait)) : undefined;
}

export function secondsUntilMidnight(timeZone: string, now = Date.now()) {
  const calendar = new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" });
  const today = calendar.format(now);
  let low = now;
  let high = now + 26 * 3_600_000;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2);
    if (calendar.format(middle) === today) low = middle;
    else high = middle;
  }
  return Math.ceil((high - now) / 1000);
}

const media = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }) }),
  z.object({ type: z.literal("video_url"), video_url: z.object({ url: z.string() }) }),
]);
const chat = z.object({
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.union([z.string(), z.array(media)]) })),
  stream: z.boolean(), temperature: z.number().optional(), max_tokens: z.number().int().positive(),
  response_format: z.object({ type: z.literal("json_object") }).optional(),
});

export function parseProviderChat(payload: Record<string, unknown>) {
  const result = chat.safeParse(payload);
  if (!result.success) throw new AiError("bad_request");
  return result.data;
}

export function chatJson(content: string | undefined, usage?: ProviderUsage) {
  if (!content?.trim()) throw new AiError("invalid_response");
  return Response.json({ choices: [{ message: { content } }],
    ...(usage ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens } } : {}) });
}

/** Direct adapters expose token streams through the same decoder as OpenRouter. */
export function chatStream(tokens: AsyncGenerator<string>, usage?: () => ProviderUsage) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      const event = await tokens.next();
      if (event.done) {
        if (usage) {
          const { inputTokens, outputTokens } = usage();
          if (inputTokens !== undefined || outputTokens !== undefined) controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } })}\n\n`,
          ));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } else {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: event.value } }] })}\n\n`));
      }
    },
    async cancel() { await tokens.return(undefined); },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

const observedStreams = new WeakMap<Response, (event: string | undefined) => Promise<void>>();

export function observeProviderStream(response: Response, observe: (event: string | undefined) => Promise<void>) {
  observedStreams.set(response, observe);
}

export async function* readSseData(response: Response) {
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiError("invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 256_000) throw new AiError("invalid_response");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) {
          length += line.length;
          if (length > 256_000) throw new AiError("invalid_response");
          data.push(line.slice(5).trimStart());
        }
        if (line === "" && data.length) {
          const event = data.join("\n");
          await observedStreams.get(response)?.(event);
          yield event;
          data = [];
          length = 0;
        }
      }
    }
    await observedStreams.get(response)?.(undefined);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
