import { plainTeachingAnswer } from "@/lib/teaching-content";
import { RequestError } from "@/lib/http";

export type StudyLanguage = "en" | "ar";

export interface SourceCitation {
  id: string;
  documentId: string;
  page: number;
  text: string;
  title: string;
  label?: string;
}

export interface StudyMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: SourceCitation[];
  files?: string[];
}

interface ChatStreamEvent {
  content?: string;
  answer?: string;
  citations?: SourceCitation[];
  conversationId?: string;
  error?: string | { message?: string };
  code?: string;
  category?: string;
  retryAfter?: number;
}

export const CHAT_FILE_LIMIT = 5;
export const CHAT_BYTE_LIMIT = 3_500_000;
export const CHAT_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "video/mp4"];

export function chatHistory(messages: StudyMessage[]) {
  const history: Pick<StudyMessage, "role" | "content">[] = [];
  const encoder = new TextEncoder();
  let characters = 0;
  let bytes = 0;
  for (const { role, content } of messages.slice(-24).reverse()) {
    const clipped = (role === "assistant" ? plainTeachingAnswer(content) : content).slice(0, 16_000).trim();
    if (!clipped) continue;
    const entry = { role, content: clipped };
    const entryBytes = encoder.encode(JSON.stringify(entry)).byteLength;
    if (characters + clipped.length > 70_000 || bytes + entryBytes > 220_000) break;
    characters += clipped.length;
    bytes += entryBytes;
    history.push(entry);
  }
  return history.reverse();
}

export function sourceHref(source: Pick<SourceCitation, "id" | "documentId" | "page">) {
  const query = new URLSearchParams({ page: String(source.page), citation: source.id });
  return `/documents/${encodeURIComponent(source.documentId)}?${query}`;
}

export async function responseError(response: Response, fallback: string): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  if (typeof data !== "object" || !data) return fallback;
  const details = data as { error?: unknown; message?: unknown };
  if (typeof details.error === "string") return details.error;
  if (typeof details.message === "string") return details.message;
  if (details.error && typeof details.error === "object" && "message" in details.error && typeof details.error.message === "string") {
    return details.error.message;
  }
  return fallback;
}

export function validateFiles(files: Pick<File, "size" | "type">[]): "count" | "size" | "type" | null {
  if (files.length > CHAT_FILE_LIMIT) return "count";
  if (files.some(({ type }) => !CHAT_FILE_TYPES.includes(type))) return "type";
  if (files.some(({ size }) => !size) || files.reduce((total, file) => total + file.size, 0) > CHAT_BYTE_LIMIT) return "size";
  return null;
}

export async function readChatStream(body: ReadableStream<Uint8Array>, onEvent: (event: ChatStreamEvent) => void, language: StudyLanguage = "en") {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const incomplete = language === "ar" ? "انقطع اتصال المعلّم قبل اكتمال الإجابة." : "The tutor connection closed before the reply finished.";
  const streamError = language === "ar" ? "تعذّر على المعلّم إكمال الإجابة." : "The tutor could not complete this reply.";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE records are separated by an empty line. Transport chunks do not necessarily align with records.
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop() ?? "";
      for (const record of records) {
        const data = record.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        let event: ChatStreamEvent;
        try { event = JSON.parse(data) as ChatStreamEvent; } catch { throw new Error(streamError); }
        if (!event || typeof event !== "object") throw new Error(streamError);
        if (event.error) throw new RequestError(502, typeof event.error === "string" ? event.error : event.error.message || streamError,
          event.code, event.retryAfter, event.category);
        onEvent(event);
      }
    }
    throw new Error(incomplete);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function readVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const player = document.createElement("video");
    const timer = setTimeout(fail, 6000);
    function cleanup() {
      clearTimeout(timer);
      player.onloadedmetadata = null;
      player.onerror = null;
      URL.revokeObjectURL(url);
    }
    function fail() {
      cleanup();
      reject(new Error("invalid video"));
    }
    player.preload = "metadata";
    player.onerror = fail;
    player.onloadedmetadata = () => {
      const duration = player.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error("invalid video"));
    };
    player.src = url;
  });
}
