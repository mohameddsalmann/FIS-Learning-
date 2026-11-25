import type { DocumentLearningOutline } from "@/server/rag/outline";
import { responseError, type StudyLanguage } from "./client";

const maxPdfBytes = 20 * 1024 * 1024;
const proxyUploadBytes = 4 * 1024 * 1024;

export type DocumentStatus = "UPLOADING" | "PENDING" | "EXTRACTING" | "CHUNKING" | "EMBEDDING" | "INDEXING"
  | "PREPARING_SUGGESTIONS" | "READY" | "FAILED" | "OCR_REQUIRED" | "DELETING";

export interface DocumentJob {
  state?: DocumentStatus;
  processedChunks: number;
  totalChunks: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CourseDocument {
  id: string;
  title: string;
  status: DocumentStatus;
  pageCount?: number | null;
  sizeBytes?: number | null;
  error?: string | null;
  updatedAt?: string;
  learningOutline?: DocumentLearningOutline | null;
  job?: DocumentJob | null;
}

interface DocumentPayload { document: CourseDocument; job?: DocumentJob | null }
export interface UploadIntent { document: CourseDocument; pathname: string }
export interface TransferProgress { loaded: number; total: number }

export class DocumentRequestError extends Error {
  readonly retryAfter: number;

  constructor(readonly status: number, message: string, retryAfter: string | null) {
    super(message);
    const seconds = Number(retryAfter);
    this.retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }
}

async function documentResponse<T>(response: Response, language: StudyLanguage): Promise<T> {
  if (response.ok) return await response.json() as T;
  const fallback = language === "ar" ? "تعذّر إكمال الطلب. حاول مجدداً." : "The request failed. Try again.";
  throw new DocumentRequestError(response.status, await responseError(response, fallback), response.headers.get("Retry-After"));
}

export async function documentRequest<T>(url: string, language: StudyLanguage, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Accept-Language", language);
  const response = await fetch(url, { ...init, headers });
  return documentResponse<T>(response, language);
}

export function fromPayload({ document, job }: DocumentPayload) {
  return { ...document, job: document.job ?? job };
}

export async function validStudyPdf(file: File) {
  return (!file.type || file.type === "application/pdf") && file.name.length <= 160 && /\.pdf$/i.test(file.name)
    && file.size >= 5 && file.size <= maxPdfBytes && await file.slice(0, 5).text() === "%PDF-";
}

export async function finalizeCoursePdf(id: string, language: StudyLanguage, signal: AbortSignal) {
  return fromPayload(await documentRequest<DocumentPayload>(`/api/documents/${encodeURIComponent(id)}/finalize`, language, { method: "POST", signal }));
}

export function getCoursePdf(id: string, language: StudyLanguage, signal: AbortSignal) {
  return documentRequest<DocumentPayload>(`/api/documents/${encodeURIComponent(id)}`, language, { signal }).then(fromPayload);
}

export function processCoursePdf(id: string, language: StudyLanguage, init: RequestInit) {
  return documentRequest<DocumentPayload>(`/api/documents/${encodeURIComponent(id)}/process`, language, { ...init, method: "POST" }).then(fromPayload);
}

function uploadForm(form: FormData, language: StudyLanguage, signal: AbortSignal, onProgress: (event: TransferProgress) => void) {
  return new Promise<DocumentPayload>((resolve, reject) => {
    signal.throwIfAborted();
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.upload.addEventListener("progress", ({ loaded, total, lengthComputable }) => {
      if (lengthComputable && total > 0) onProgress({ loaded, total });
    });
    request.addEventListener("load", () => {
      const response = new Response(request.responseText, { status: request.status, headers: {
        "Content-Type": "application/json", "Retry-After": request.getResponseHeader("Retry-After") ?? "",
      } });
      void documentResponse<DocumentPayload>(response, language).then(resolve, reject);
    });
    request.addEventListener("error", () => reject(new TypeError("Upload connection interrupted")));
    request.addEventListener("abort", () => reject(signal.reason));
    request.addEventListener("loadend", () => signal.removeEventListener("abort", abort));
    request.open("POST", "/api/documents");
    request.setRequestHeader("Accept-Language", language);
    signal.addEventListener("abort", abort, { once: true });
    request.send(form);
  });
}

export async function uploadCoursePdf(file: File, courseId: string, language: StudyLanguage, signal: AbortSignal, {
  onReserve, onProgress, previous, requestKey,
}: { onReserve: (intent: UploadIntent) => void; onProgress: (event: TransferProgress) => void; previous?: UploadIntent; requestKey: string }) {
  let intent = previous;
  if (intent) {
    try { return await finalizeCoursePdf(intent.document.id, language, signal); }
    catch (error) { if (!(error instanceof DocumentRequestError) || error.status !== 409) throw error; }
  } else {
    intent = await documentRequest<UploadIntent>("/api/documents/uploads", language, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
      body: JSON.stringify({ courseId, name: file.name, sizeBytes: file.size }), signal,
    });
    onReserve(intent);
    if (intent.document.status !== "UPLOADING") return intent.document;
  }

  if (file.size <= proxyUploadBytes) {
    const form = new FormData();
    form.set("courseId", courseId);
    form.set("uploadId", intent.document.id);
    form.set("file", file.type ? file : new File([file], file.name, { type: "application/pdf" }));
    return fromPayload(await uploadForm(form, language, signal, onProgress));
  }

  const { upload } = await import("@vercel/blob/client");
  await upload(intent.pathname, file, {
    access: "private", contentType: "application/pdf", handleUploadUrl: "/api/documents/uploads/token",
    clientPayload: intent.document.id, abortSignal: signal, onUploadProgress: onProgress,
  });
  return finalizeCoursePdf(intent.document.id, language, signal);
}
