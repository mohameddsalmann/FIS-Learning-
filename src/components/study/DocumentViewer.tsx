"use client";

import { BookOpen, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { StudyLanguage } from "./client";
import { useStudyLanguage } from "./language";
import { normalizePdfText, pdfMatches } from "./pdf-text";
import styles from "./study.module.css";

type Rectangle = { left: number; top: number; width: number; height: number };
type CitationDetail = { chunk: { text: string; page: number }; document: { title: string } };

function textItems(items: { str?: unknown }[]): TextItem[] {
  return items.filter((item) => typeof item.str === "string") as TextItem[];
}

export function DocumentViewer({ documentId, initialPage = 1, citationId, language: preferred, heading: Heading = "h1" }: { documentId: string; initialPage?: number; citationId?: string; language?: StudyLanguage; heading?: "h1" | "h3" }) {
  const language = useStudyLanguage(preferred);
  const ar = language === "ar";
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [title, setTitle] = useState("");
  const [citation, setCitation] = useState<CitationDetail["chunk"] | null>(null);
  const [citationError, setCitationError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [painting, setPainting] = useState(true);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [resultPages, setResultPages] = useState<number[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [marks, setMarks] = useState<Rectangle[]>([]);
  const [pageText, setPageText] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const searchTicket = useRef(0);
  const documentUrl = "/api/documents/" + encodeURIComponent(documentId);
  const fileUrl = documentUrl + "/file";

  useEffect(() => {
    let loading: PDFDocumentLoadingTask | undefined;
    let stopped = false;
    async function open() {
      try {
        const browserPdf = await import("pdfjs-dist");
        if (stopped) return;
        browserPdf.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        loading = browserPdf.getDocument({ url: fileUrl, disableRange: true, isEvalSupported: false });
        const doc = await loading.promise;
        if (stopped) return;
        setPdf(doc);
        setPage((value) => Math.min(Math.max(value, 1), doc.numPages));
        void doc.getMetadata().then(({ info }) => {
          if (!stopped && info && typeof info === "object" && "Title" in info && typeof info.Title === "string") {
            setTitle((existing) => existing || String(info.Title).slice(0, 150));
          }
        }).catch(() => {});
      } catch {
        if (!stopped) setLoadError(true);
      }
    }
    void open();
    return () => { stopped = true; searchTicket.current = searchTicket.current + 1; void loading?.destroy(); };
  }, [fileUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const path = citationId ? documentUrl + "/chunks/" + encodeURIComponent(citationId) : documentUrl;
    fetch(path, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("source unavailable");
      const detail = await response.json() as { document: CitationDetail["document"]; chunk?: CitationDetail["chunk"] };
      if (controller.signal.aborted) return;
      setTitle(detail.document.title);
      if (detail.chunk) { setCitation(detail.chunk); setPage(detail.chunk.page); }
    }).catch(() => { if (citationId && !controller.signal.aborted) setCitationError(true); });
    return () => controller.abort();
  }, [citationId, documentUrl]);

  useEffect(() => {
    if (!pdf) return;
    let stopped = false;
    let task: RenderTask | undefined;
    async function present() {
      try {
        setPainting(true);
        setPageError(false);
        setMarks([]);
        setPageText("");
        const [pdfPage, { Util }] = await Promise.all([pdf!.getPage(page), import("pdfjs-dist")]);
        const target = canvas.current;
        if (stopped || !target) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(2, 1500 / base.width, 2050 / base.height) });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        const context = target.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas unavailable");
        task = pdfPage.render({ canvasContext: context, viewport });
        const content = pdfPage.getTextContent().catch(() => ({ items: [] }));
        const [, text] = await Promise.all([task.promise, content]);
        if (stopped) return;
        const runs = textItems(text.items as { str?: unknown }[]);
        setPageText(runs.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim());
        const excerpt = citation?.page === page ? normalizePdfText(citation.text).split(" ").slice(0, 8).join(" ") : "";
        const matching = pdfMatches(runs, searchTerm || excerpt);
        setMarks(matching.map((index) => {
          const run = runs[index];
          const transform = Util.transform(viewport.transform, run.transform);
          const height = Math.hypot(transform[2], transform[3]);
          return {
            left: (transform[4] / viewport.width) * 100,
            top: ((transform[5] - height) / viewport.height) * 100,
            width: (run.width * viewport.scale / viewport.width) * 100,
            height: (height / viewport.height) * 100,
          };
        }));
      } catch {
        if (!stopped) setPageError(true);
      } finally {
        if (!stopped) setPainting(false);
      }
    }
    void present();
    return () => { stopped = true; task?.cancel(); };
  }, [pdf, page, citation, searchTerm]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!pdf) return;
    const term = query.trim().slice(0, 120);
    const ticket = ++searchTicket.current;
    setResultPages(null);
    setSearchError(false);
    setSearchTerm(term);
    if (!term) { setSearching(false); return; }
    setSearching(true);
    try {
      const matches: number[] = [];
      for (let start = 1; start <= pdf.numPages; start += 4) {
        const indexes = Array.from({ length: Math.min(4, pdf.numPages - start + 1) }, (_, index) => start + index);
        const found = await Promise.all(indexes.map(async (index) => {
          const target = await pdf.getPage(index);
          return pdfMatches(textItems((await target.getTextContent()).items as { str?: unknown }[]), term).length ? index : 0;
        }));
        if (searchTicket.current !== ticket) return;
        matches.push(...found.filter(Boolean));
      }
      setResultPages(matches);
      if (matches[0]) setPage(matches[0]);
    } catch {
      if (searchTicket.current === ticket) setSearchError(true);
    } finally {
      if (searchTicket.current === ticket) setSearching(false);
    }
  }

  return <section className={styles.viewer} dir={ar ? "rtl" : "ltr"} aria-label={ar ? "عارض المصادر" : "Source viewer"}>
    <header className={styles.chatHeader}><BookOpen size={22} aria-hidden /><div><Heading dir="auto">{title || (ar ? "عرض المستند" : "View the source")}</Heading><p>{ar ? "انتقل بين الصفحات وابحث في النص القابل للاستخراج." : "Browse the pages and search their extractable text."}</p></div></header>
    {loadError ? <div role="alert" className={styles.error}>{ar ? "تعذّر فتح المستند. تأكّد من صلاحياتك وافتحه من الدورة." : "This document could not be opened. Check your access and reopen it from your course."}</div> : <>
      <div className={styles.viewerControls}>
        <button type="button" className={styles.secondaryButton} disabled={!pdf || page <= 1} onClick={() => setPage(page - 1)}>{ar ? <ChevronRight size={16} aria-hidden /> : <ChevronLeft size={16} aria-hidden />}{ar ? "السابق" : "Previous"}</button>
        <span aria-live="polite">{ar ? "الصفحة" : "Page"} {page} {ar ? "من" : "of"} {pdf?.numPages ?? "…"}</span>
        <button type="button" className={styles.secondaryButton} disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(page + 1)}>{ar ? "التالي" : "Next"}{ar ? <ChevronLeft size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</button>
        {pdf && <a className={styles.textButton} href={fileUrl} download><Download size={16} aria-hidden />{ar ? "تنزيل ملف PDF" : "Download PDF"}</a>}
      </div>
      <form className={styles.viewerSearch} onSubmit={search}>
        <label className={styles.srOnly} htmlFor="study-pdf-search">{ar ? "ابحث في المستند" : "Search document"}</label>
        <input id="study-pdf-search" type="search" className={styles.field} dir="auto" placeholder={ar ? "ابحث ضمن المستند…" : "Search this document…"} value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} disabled={!pdf} />
        <button type="submit" className={styles.secondaryButton} disabled={!pdf || searching}><Search size={16} aria-hidden />{searching ? ar ? "جارٍ البحث…" : "Searching…" : ar ? "بحث" : "Search"}</button>
      </form>
      {resultPages && <div className={styles.actions} aria-label={ar ? "نتائج البحث" : "Search results"}>{resultPages.length ? resultPages.map((found) => <button key={found} className={styles.textButton} type="button" onClick={() => setPage(found)}>{ar ? "صفحة" : "Page"} {found}</button>) : <p role="status" className={styles.hint}>{ar ? "لم يُعثر على نتائج في النص." : "No matches were found in the document text."}</p>}</div>}
      {searchError && <p role="alert" className={styles.error}>{ar ? "تعذّر البحث في المستند." : "The document could not be searched."}</p>}
      {citationError && <p role="status" className={styles.hint}>{ar ? "المقتطف المشار إليه غير متاح. يمكنك مراجعة الصفحة." : "The cited excerpt is unavailable. You can still review the page."}</p>}
      {citation && <blockquote dir="auto" className={styles.transcript}>{citation.text}</blockquote>}
      <div className={styles.pageFrame} aria-busy={painting}>
        {painting && <p role="status" className={styles.hint}>{ar ? "جارٍ تحميل الصفحة…" : "Loading the page…"}</p>}
        {pageError && <p role="alert" className={styles.error}>{ar ? "تعذّر عرض الصفحة." : "This page could not be rendered."}</p>}
        <div className={styles.pageSheet} hidden={painting || pageError}>
          <canvas ref={canvas} role="img" aria-label={(ar ? "صفحة المستند " : "Document page ") + page} />
          {marks.map((mark, index) => <mark key={index} aria-hidden style={{ left: mark.left + "%", top: mark.top + "%", width: mark.width + "%", height: mark.height + "%" }} />)}
        </div>
      </div>
      {pageText && <details className={styles.transcript}><summary>{ar ? "النص المستخرج من الصفحة" : "Extracted page text"}</summary><p dir="auto">{pageText}</p></details>}
    </>}
  </section>;
}
