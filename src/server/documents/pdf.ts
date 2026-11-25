import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// Register the Node PDF.js handler explicitly so bundled routes do not look for a sibling worker file.
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { DocumentPage } from "../rag/chunks";
import { WorkspaceError } from "../workspace/errors";
import { validatePdfBytes } from "./storage";

const MAX_PAGES = 150;
const MAX_PAGE_CHARS = 36_000;

export async function extractPdfPages(bytes: Uint8Array, options: {
  maxPages?: number; truncate?: boolean; layout?: boolean; signal?: AbortSignal;
} = {}): Promise<DocumentPage[]> {
  options.signal?.throwIfAborted();
  validatePdfBytes(bytes);
  const task = getDocument({
    data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: true,
    disableAutoFetch: true, disableStream: true, stopAtErrors: true,
  });
  try {
    const document = await task.promise;
    options.signal?.throwIfAborted();
    const pageLimit = Math.min(options.maxPages ?? MAX_PAGES, MAX_PAGES);
    if (document.numPages > pageLimit && !options.truncate) {
      throw new WorkspaceError(422, `Split this PDF into files of ${pageLimit} pages or fewer.`);
    }
    const meta = options.layout !== false ? await document.getMetadata().catch(() => undefined) : undefined;
    const embeddedTitle = (meta?.info as { Title?: unknown } | undefined)?.Title;
    const title = typeof embeddedTitle === "string"
      ? embeddedTitle.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 180) : undefined;
    const result: DocumentPage[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, pageLimit); pageNumber++) {
      options.signal?.throwIfAborted();
      const page = await document.getPage(pageNumber);
      try {
        options.signal?.throwIfAborted();
        const content = await page.getTextContent();
        options.signal?.throwIfAborted();
        let text = "";
        let previous: { x: number; y: number; width: number; height: number; ended: boolean } | undefined;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          if (options.layout === false) {
            text += item.str + (item.hasEOL ? "\n" : " ");
          } else {
            if (!item.str.trim()) {
              if (item.hasEOL && previous && !previous.ended) {
                text += "\n";
                previous.ended = true;
              }
              continue;
            }
            const [, angle, , , x, y] = item.transform;
            const height = item.height || previous?.height || 10;
            let separator = previous?.ended ? "" : " ";
            if (previous && Math.abs(angle) < 0.01) {
              const verticalGap = Math.abs(previous.y - y);
              const lineHeight = Math.max(height, previous.height);
              if (verticalGap > lineHeight * 1.5) separator = previous.ended ? "\n" : "\n\n";
              else if (verticalGap > lineHeight * 0.45) separator = previous.ended ? "" : "\n";
              else if (!previous.ended && item.dir === "ltr" && x - previous.x - previous.width > lineHeight * 2.4) separator = " | ";
              else if (!previous.ended && item.dir === "rtl" && previous.x - x - item.width > lineHeight * 2.4) separator = " | ";
            }
            text += (previous ? separator : "") + item.str.trim() + (item.hasEOL ? "\n" : "");
            previous = { x, y, width: item.width, height, ended: item.hasEOL };
          }
          if (text.length > MAX_PAGE_CHARS) {
            if (!options.truncate) throw new WorkspaceError(422, "A page exceeds the supported text limit. Split the content and upload it again.");
            break;
          }
        }
        result.push({ page: pageNumber, text: text.slice(0, MAX_PAGE_CHARS), ...(pageNumber === 1 && title ? { title } : {}) });
      } finally {
        page.cleanup();
      }
    }
    return result;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(422, "The PDF text could not be read. Try an unlocked PDF with a selectable text layer.");
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
