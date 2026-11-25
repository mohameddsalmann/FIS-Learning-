import { z } from "zod";
import { chatModes } from "@/lib/teaching-modes";
import { requireActor, recordModelHealth } from "@/server/auth/session";
import { WorkspaceError } from "@/server/workspace/errors";
import { AiError, publicAiError, type Language } from "./errors";
import { optionalOpenRouterKey, type InferenceOptions } from "./gateway";
import type { ContentPart } from "./services";
import { studyUsage } from "./usage";

const maxBody = 4 * 1024 * 1024;
const maxFiles = 5;
const maxMedia = Math.floor(3.5 * 1024 * 1024);
const maxJson = 256 * 1024;
const maxPdfText = 12_000;

const mediaSignatures: Record<string, (bytes: Buffer) => boolean> = {
  "image/jpeg": (bytes) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
  "image/png": (bytes) => bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "image/webp": (bytes) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
  "video/mp4": (bytes) => bytes.toString("ascii", 4, 8) === "ftyp",
  "application/pdf": (bytes) => bytes.toString("ascii", 0, 5) === "%PDF-",
};

export const languageSchema = z.enum(["en", "ar"]);
export const modelSchema = z.string().trim().min(1).max(120).optional();
export const identifier = z.string().trim().min(1).max(100);
const message = z.object({
  role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(16_000),
}).strict();
export const chatSchema = z.object({
  messages: z.array(message).min(1).max(24),
  courseId: identifier.optional(), conversationId: identifier.optional(),
  mode: z.enum(chatModes).default("auto"),
  model: modelSchema, temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(256).max(4096).optional(), language: languageSchema.optional(),
}).strict().refine(({ messages }) => messages.at(-1)?.role === "user"
  && messages.reduce((total, entry) => total + entry.content.length, 0) <= 75_000);

export function validate<T>(schema: z.ZodType<T>, data: unknown) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AiError("bad_request");
  return parsed.data;
}

type Actor = Awaited<ReturnType<typeof requireActor>>;
type Handler = (request: Request, actor: Actor, options: InferenceOptions, setLanguage: (language?: Language) => void,
  usage: ReturnType<typeof studyUsage>) => Promise<Response>;

export function requestLanguage(request: Request): Language {
  return /^ar(?:\b|-)/i.test(request.headers.get("accept-language") ?? "") ? "ar" : "en";
}

export function apiError(error: unknown, language: Language) {
  const result = aiErrorDetails(error, language);
  return Response.json({ error: result.error, code: result.code, retryAfter: result.retryAfter, category: result.category }, {
    status: result.status, headers: {
      "Cache-Control": "no-store",
      ...(result.retryAfter ? { "Retry-After": String(Math.ceil(result.retryAfter)) } : {}),
    },
  });
}

export function aiErrorDetails(error: unknown, language: Language) {
  const result = publicAiError(error instanceof WorkspaceError && error.status === 429 ? new AiError("workspace_quota") : error, language);
  const known = error instanceof AiError || error instanceof WorkspaceError;
  const retry = known ? error.retryAfter : undefined;
  return { ...result, retryAfter: typeof retry === "number" && Number.isFinite(retry) && retry > 0 ? retry : undefined,
    category: known ? error.category : undefined };
}

export function authorizedAi(handler: Handler) {
  return async (request: Request) => {
    let language = requestLanguage(request);
    const requestId = crypto.randomUUID();
    const setLanguage = (explicit?: Language) => { if (explicit) language = explicit; };
    let usage: ReturnType<typeof studyUsage> | undefined;
    try {
      const actor = await requireActor(request);
      usage = studyUsage(actor, request);
      const options: InferenceOptions = {
        ...usage,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]),
        get apiKey() { return optionalOpenRouterKey(request); },
        openRouterOnly: request.headers.has("x-fis-openrouter-key"),
        reportHealth: (entry) => recordModelHealth(entry),
      };
      const response = await handler(request, actor, options, setLanguage, usage);
      response.headers.set("X-Request-Id", requestId);
      return response;
    } catch (error) {
      await usage?.fail().catch(() => undefined);
      const response = apiError(error, language);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
  };
}

async function bodyBuffer(request: Request, limit: number) {
  const announced = request.headers.get("content-length");
  if (announced && Number(announced) > limit) throw new AiError("too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new AiError("bad_request");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) throw new AiError("too_large");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, length);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { throw new AiError("bad_request"); }
}

export async function jsonBody(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new AiError("bad_request");
  return parseJson((await bodyBuffer(request, maxJson)).toString("utf8"));
}

export async function chatBody(request: Request): Promise<{ data: unknown; files: File[] }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return { data: await jsonBody(request), files: [] };
  const bytes = await bodyBuffer(request, maxBody);
  const envelope = new Response(Uint8Array.from(bytes), { headers: { "Content-Type": contentType } });
  const form = await envelope.formData().catch(() => { throw new AiError("bad_request"); });
  const entries = form.getAll("chat");
  const files = form.getAll("attachment");
  if ([...form.keys()].some((key) => key !== "chat" && key !== "attachment")
    || entries.length !== 1 || typeof entries[0] !== "string" || files.length > maxFiles || files.some((file) => typeof file === "string")) {
    throw new AiError("bad_request");
  }
  const attached = files.filter((value): value is File => typeof value !== "string");
  if (attached.reduce((sum, file) => sum + file.size, 0) > maxMedia) throw new AiError("too_large");
  return { data: parseJson(entries[0]), files: attached };
}

interface Mp4Box { type: string; start: number; end: number }

function boxes(bytes: Buffer, start: number, end: number): Mp4Box[] {
  const result: Mp4Box[] = [];
  while (start + 8 <= end && result.length < 1500) {
    const size32 = bytes.readUInt32BE(start);
    const type = bytes.toString("ascii", start + 4, start + 8);
    const header = size32 === 1 ? 16 : 8;
    if (start + header > end) break;
    const length = size32 === 1 ? Number(bytes.readBigUInt64BE(start + 8)) : size32 || end - start;
    if (!Number.isSafeInteger(length) || length < header || start + length > end) break;
    result.push({ type, start: start + header, end: start + length });
    start += length;
  }
  return result;
}

export function mp4Duration(bytes: Buffer): number | null {
  const movie = boxes(bytes, 0, bytes.length).find((box) => box.type === "moov");
  if (!movie) return null;
  const header = boxes(bytes, movie.start, movie.end).find((box) => box.type === "mvhd");
  if (!header) return null;
  const version = bytes[header.start];
  const required = version === 0 ? 20 : version === 1 ? 32 : null;
  if (!required || header.end - header.start < required) return null;
  const scale = bytes.readUInt32BE(header.start + (version === 0 ? 12 : 20));
  const duration = version === 0 ? bytes.readUInt32BE(header.start + 16) : Number(bytes.readBigUInt64BE(header.start + 24));
  return scale > 0 && Number.isSafeInteger(duration) && duration > 0 ? duration / scale : null;
}

export async function attachmentParts(files: File[]): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  let remainingPdfText = maxPdfText;
  for (const file of files) {
    const type = file.type.toLowerCase();
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!Object.hasOwn(mediaSignatures, type) || !mediaSignatures[type](bytes)) throw new AiError("unsupported_media");
    if (type === "application/pdf") {
      const { extractPdfPages } = await import("@/server/documents/pdf");
      const pages = await extractPdfPages(Uint8Array.from(bytes), { maxPages: 15, truncate: true }).catch(() => []);
      const readable = pages.filter((page) => page.text.trim());
      if (!readable.length) throw new AiError("unreadable_pdf");
      const text = readable.map((page) => "Page " + page.page + ":\n" + page.text.trim()).join("\n\n").slice(0, remainingPdfText);
      remainingPdfText -= text.length;
      if (text) parts.push({ type: "text", text: "Untrusted PDF excerpt:\n" + text });
      continue;
    }
    const url = "data:" + type + ";base64," + bytes.toString("base64");
    if (type === "video/mp4") {
      const duration = mp4Duration(bytes);
      if (duration == null || duration > 60) throw new AiError("unsupported_media");
      parts.push({ type: "video_url", video_url: { url } });
    } else {
      parts.push({ type: "image_url", image_url: { url } });
    }
  }
  return parts;
}
