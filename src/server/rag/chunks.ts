import { createHash } from "node:crypto";

export const LEGACY_PROCESSING_VERSION = 1;
export const LEGACY_CHUNK_STRATEGY = "page-window-v1";
export const PROCESSING_VERSION = 2;
export const CHUNK_STRATEGY = "page-structure-v2";
const CHUNK_SIZE = 950;
const OVERLAP = 120;
export const MAX_CHUNKS = 600;

export interface DocumentPage { page: number; text: string; title?: string }

function preservePageStructure(text: string) {
  return text.normalize("NFKC")
    .replaceAll("\u0000", "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function normalizePage(text: string) {
  return text.normalize("NFKC")
    .replaceAll("\u0000", "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function splitPageText(pages: DocumentPage[], processingVersion = PROCESSING_VERSION) {
  const preserveStructure = processingVersion !== LEGACY_PROCESSING_VERSION;
  const seen = new Set<string>();
  const chunks: { page: number; ordinal: number; text: string; contentHash: string }[] = [];
  for (const page of pages) {
    const points = Array.from(preserveStructure ? preservePageStructure(page.text) : normalizePage(page.text));
    let start = 0;
    while (start < points.length) {
      let end = Math.min(start + CHUNK_SIZE, points.length);
      if (end < points.length) {
        let boundary = points.lastIndexOf(" ", end);
        if (preserveStructure) {
          const paragraph = points.lastIndexOf("\n", end - 1);
          if (paragraph > start + CHUNK_SIZE * 0.7) boundary = paragraph;
        }
        if (boundary > start + CHUNK_SIZE * 0.7) end = boundary;
      }
      const text = points.slice(start, end).join("").trim();
      const contentHash = createHash("sha256").update(normalizePage(text)).digest("hex");
      if (text && !seen.has(contentHash)) {
        chunks.push({ page: page.page, ordinal: chunks.length, text, contentHash });
        seen.add(contentHash);
      }
      if (chunks.length > MAX_CHUNKS || end === points.length) break;
      start = end - OVERLAP;
      if (preserveStructure) {
        for (let cursor = start; cursor < end - OVERLAP / 2; cursor++) {
          if (/\s/u.test(points[cursor])) {
            start = cursor + 1;
            break;
          }
        }
      }
    }
    if (chunks.length > MAX_CHUNKS) break;
  }
  return chunks;
}

export function serializeVector(input: number[]) {
  if (!input.length || input.length > 4096 || input.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error("Invalid embedding vector.");
  }
  return JSON.stringify(input);
}
