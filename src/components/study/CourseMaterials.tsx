"use client";

import { BookOpen, Check, FileText, MessageCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { tr } from "@/lib/locale";
import { useStudySession } from "@/lib/session";
import type { StudyLanguage } from "./client";
import { useStudyLanguage } from "./language";
import { PdfUploadSelection, usePdfUpload } from "./PdfUpload";
import { documentRequest, DocumentRequestError, finalizeCoursePdf, getCoursePdf, processCoursePdf, type CourseDocument, type DocumentStatus } from "./upload";
import uploadStyles from "./pdf-upload.module.css";
import styles from "./study.module.css";

const statusText: Record<DocumentStatus, [string, string]> = {
  UPLOADING: ["Upload incomplete", "الرفع غير مكتمل"], PENDING: ["Uploaded", "تم الرفع"],
  EXTRACTING: ["Extracting text", "استخراج النص"], CHUNKING: ["Preparing passages", "إعداد المقاطع"],
  EMBEDDING: ["Creating semantic embeddings", "إنشاء التضمينات الدلالية"], INDEXING: ["Verifying the search index", "التحقق من فهرس البحث"],
  PREPARING_SUGGESTIONS: ["Preparing study prompts", "إعداد أسئلة المذاكرة"], READY: ["Ready for study", "جاهز للدراسة"],
  FAILED: ["Needs attention", "يحتاج إلى مراجعة"], OCR_REQUIRED: ["Needs text recognition", "يتطلب التعرّف على النص"],
  DELETING: ["Removing file", "جارٍ إزالة الملف"],
};

const stages: DocumentStatus[] = ["PENDING", "EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING", "PREPARING_SUGGESTIONS", "READY"];
const isPending = (status: DocumentStatus) => stages.includes(status) && status !== "READY";

function waitForRetry(seconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, seconds * 1000);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function ProcessingDetails({ entry, language, active, paused }: {
  entry: CourseDocument; language: StudyLanguage; active: boolean; paused: boolean;
}) {
  const t = (en: string, ar: string) => tr(language, en, ar);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [active]);

  const checkpoint = entry.status === "FAILED" ? entry.job?.state : entry.status;
  const step = checkpoint ? stages.indexOf(checkpoint) : -1;
  const job = entry.job;
  const indexed = step > stages.indexOf("INDEXING");
  const denseSkipped = indexed && !!job?.totalChunks && job.processedChunks < job.totalChunks;
  const start = job?.createdAt ? Date.parse(job.createdAt) : NaN;
  const recordedEnd = entry.updatedAt ?? job?.updatedAt;
  const seconds = Math.max(0, Math.floor(((active ? now : recordedEnd ? Date.parse(recordedEnd) : NaN) - start) / 1000));
  const elapsed = Number.isFinite(seconds) ? new Intl.NumberFormat(language, {
    style: "unit", unit: seconds < 60 ? "second" : "minute", maximumFractionDigits: seconds < 60 ? 0 : 1,
  }).format(seconds < 60 ? seconds : seconds / 60) : undefined;
  const number = new Intl.NumberFormat(language);

  if (!job && step < 0) return null;
  return <div className={uploadStyles.checkpoint}>
    <div className={uploadStyles.counters}>
      {!!entry.pageCount && <span>{t(`${number.format(entry.pageCount)} pages extracted`, `صفحات مستخرجة ${number.format(entry.pageCount)}`)}</span>}
      {!!job?.totalChunks && (indexed
        ? <span>{t(`${number.format(job.totalChunks)} passages indexed`, `مقاطع مفهرسة ${number.format(job.totalChunks)}`)}</span>
        : <span>{t(`${number.format(job.processedChunks)} of ${number.format(job.totalChunks)} passages embedded`, `تم تضمين ${number.format(job.processedChunks)} من ${number.format(job.totalChunks)} مقاطع`)}</span>)}
      {elapsed && <span>{t(`Elapsed ${elapsed}`, `الوقت المنقضي ${elapsed}`)}</span>}
    </div>
    {active && !paused && <progress aria-label={t("Processing progress", "تقدّم المعالجة")}
      max={entry.status === "EMBEDDING" ? job?.totalChunks || undefined : undefined}
      value={entry.status === "EMBEDDING" && job?.totalChunks ? job.processedChunks : undefined} />}
    {step > 0 && <details open={active || undefined}>
      <summary>{t("Processing stages", "مراحل المعالجة")}</summary>
      <div className={uploadStyles.stages} role="list">
        {stages.slice(0, -1).map((stage, index) => {
          const done = index < step;
          return <span key={stage} role="listitem" data-state={done ? "done" : index === step ? "current" : "waiting"}
            aria-current={index === step ? "step" : undefined}>
            {done && <Check size={13} aria-hidden="true" />}
            {stage === "EMBEDDING" && denseSkipped ? t("Text search enabled", "تم تفعيل البحث النصّي") : statusText[stage][language === "ar" ? 1 : 0]}
          </span>;
        })}
      </div>
    </details>}
    {denseSkipped && <p className={styles.hint}>{t("This document uses text search. Semantic embeddings were unavailable.", "يستخدم هذا المستند البحث النصّي لأن التضمينات الدلالية لم تكن متاحة.")}</p>}
  </div>;
}

export function CourseMaterials({ courseId, initialDocuments, activeDocumentId, onStudy, onReady, onDocumentsChange, language: preferred }: {
  courseId: string; initialDocuments?: CourseDocument[]; activeDocumentId?: string; onStudy?: () => void;
  onReady?: (document: CourseDocument) => void; onDocumentsChange?: (documents: CourseDocument[]) => void; language?: StudyLanguage;
}) {
  const language = useStudyLanguage(preferred);
  const t = (en: string, ar: string) => tr(language, en, ar);
  const { requestInit } = useStudySession();
  const upload = usePdfUpload(language);
  const [documents, setDocuments] = useState(initialDocuments ?? []);
  const [loading, setLoading] = useState(!initialDocuments);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<string>();
  const [retry, setRetry] = useState<string>();
  const [discarding, setDiscarding] = useState<string>();
  const [paused, setPaused] = useState<Record<string, { message: string; disconnected?: boolean }>>({});
  const processing = useRef<AbortController | null>(null);
  const seen = useRef(new Map<string, DocumentStatus>());
  const opened = useRef(new Set<string>());
  const selection = useRef<HTMLFormElement>(null);

  function updateDocument(record: CourseDocument) {
    setDocuments((current) => current.some(({ id }) => id === record.id)
      ? current.map((entry) => entry.id === record.id && (!entry.updatedAt || !record.updatedAt || entry.updatedAt <= record.updatedAt) ? record : entry)
      : [record, ...current]);
  }

  function clearPause(id: string) {
    setPaused((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function resumeProcessing(id: string) {
    clearPause(id);
    setRetry(id);
  }

  useEffect(() => () => processing.current?.abort(), []);
  useEffect(() => {
    function reconnect() {
      setPaused((current) => Object.fromEntries(Object.entries(current).filter(([, state]) => !state.disconnected)));
    }
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, []);

  const announce = useEffectEvent(() => {
    onDocumentsChange?.(documents);
    for (const entry of documents) {
      const previous = seen.current.get(entry.id);
      seen.current.set(entry.id, entry.status);
      if (entry.status !== "READY" || opened.current.has(entry.id)
          || entry.id !== activeDocumentId && (!previous || previous === "READY")) continue;
      opened.current.add(entry.id);
      onReady?.(entry);
    }
  });
  useEffect(() => announce(), [documents, activeDocumentId]);

  const reload = useEffectEvent((signal: AbortSignal) => {
    documentRequest<{ documents: CourseDocument[] }>(`/api/workspace/courses/${encodeURIComponent(courseId)}`, language, { signal })
      .then((payload) => {
        if (!signal.aborted) setDocuments(payload.documents);
      }).catch(() => {
        if (!signal.aborted) setError(t("These course materials could not be loaded. Refresh to try again.", "تعذّر تحميل مواد الدورة. حدّث الحالة للمحاولة مجدداً."));
      }).finally(() => { if (!signal.aborted) setLoading(false); });
  });
  const hasInitial = initialDocuments !== undefined;
  useEffect(() => {
    if (hasInitial && !refresh) return;
    const load = new AbortController();
    reload(load.signal);
    return () => load.abort();
  }, [courseId, hasInitial, refresh]);

  const advance = useEffectEvent(async (entry: CourseDocument) => {
    if (processing.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    processing.current = controller;
    setWorking(entry.id);
    setRetry(undefined);
    let current = entry;
    let sequence = 0;
    let polling = false;
    let transientRetries = 0;
    let leaseDeadline: number | undefined;
    // Compare against the process response so a slower status request cannot restore an older checkpoint.
    const poll = setInterval(() => {
      if (polling || current.status === "UPLOADING") return;
      const stamp = sequence;
      polling = true;
      void getCoursePdf(entry.id, language, signal).then((result) => {
        if (!signal.aborted && stamp === sequence) updateDocument(result);
      }).catch(() => undefined).finally(() => { polling = false; });
    }, 1200);
    try {
      if (current.status === "UPLOADING") {
        current = await finalizeCoursePdf(entry.id, language, signal);
        updateDocument(current);
      }
      // A batch handles 16 passages and a document is capped at 600 passages.
      for (let steps = 0; isPending(current.status) || current.status === "FAILED" && steps === 0; ) {
        try {
          current = await processCoursePdf(entry.id, language, requestInit({ signal }));
          sequence++;
          updateDocument(current);
          transientRetries = 0;
          leaseDeadline = undefined;
          if (++steps > 64) throw new Error(t("Processing paused. Retry to continue from the last checkpoint.", "توقفت المعالجة. أعد المحاولة من آخر نقطة حفظ."));
        } catch (failure) {
          if (signal.aborted) throw failure;
          if (failure instanceof DocumentRequestError && failure.status === 409 && failure.retryAfter > 0) {
            leaseDeadline ??= Date.now() + 130_000;
            if (Date.now() >= leaseDeadline) throw failure;
            current = await getCoursePdf(entry.id, language, signal);
            sequence++;
            updateDocument(current);
            if (!isPending(current.status)) break;
            await waitForRetry(failure.retryAfter, signal);
          } else if ((failure instanceof TypeError || failure instanceof DocumentRequestError && failure.status >= 500) && transientRetries < 3) {
            await waitForRetry(2 ** transientRetries++, signal);
          } else throw failure;
        }
      }
    } catch (problem) {
      if (!signal.aborted) setPaused((states) => ({ ...states, [entry.id]: {
        disconnected: problem instanceof TypeError,
        message: entry.status === "UPLOADING" && problem instanceof DocumentRequestError && problem.status === 409
          ? t("Choose the original PDF to finish this upload.", "اختر ملف PDF الأصلي لإكمال الرفع.")
          : problem instanceof Error && !(problem instanceof TypeError) ? problem.message
            : t("Connection interrupted. Your processing checkpoint is saved.", "انقطع الاتصال. حُفظت آخر نقطة في المعالجة."),
      } }));
    } finally {
      clearInterval(poll);
      controller.abort();
      if (processing.current === controller) processing.current = null;
      setWorking(undefined);
    }
  });

  useEffect(() => {
    if (loading || working || processing.current) return;
    const next = documents.find((item) => item.id === retry) ?? documents.find((item) => item.id !== upload.reservedId
      && item.id !== discarding && !paused[item.id] && (isPending(item.status) || item.status === "UPLOADING"));
    if (next) void advance(next);
  }, [discarding, documents, loading, paused, retry, upload.reservedId, working]);

  async function discard(id: string) {
    setDiscarding(id);
    setError("");
    try {
      await documentRequest(`/api/documents/uploads/${encodeURIComponent(id)}`, language, { method: "DELETE" });
      setDocuments((current) => current.filter((entry) => entry.id !== id));
      if (upload.reservedId === id) upload.selectResume();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The unfinished upload could not be removed.", "تعذّر حذف الرفع غير المكتمل."));
    } finally { setDiscarding(undefined); }
  }

  return <section className={styles.materials} dir={language === "ar" ? "rtl" : "ltr"} aria-label={t("Course materials", "مواد الدورة")}>
    <header className={styles.chatHeader}><BookOpen size={23} aria-hidden /><div><h2>{t("Course materials", "مواد الدورة")}</h2><p>{t("Add a private PDF to give the tutor pages to cite.", "أضف ملف PDF خاصاً ليستشهد المعلّم بصفحاته.")}</p></div></header>
    <form ref={selection} className={uploadStyles.selection} onSubmit={async (event) => {
      event.preventDefault();
      const document = await upload.submit(async () => courseId, updateDocument);
      if (document) {
        clearPause(document.id);
        updateDocument(document);
      }
    }}>
      <PdfUploadSelection language={language} upload={upload} disabled={loading} chooseLabel={t("Upload PDF", "رفع ملف PDF")} />
      {upload.file && <div className={styles.uploadRow}>
        <button type="submit" className={styles.primaryButton} disabled={upload.busy}>
          {upload.error || upload.cancelled ? t("Retry upload", "أعد الرفع") : t("Add PDF to course", "أضف ملف PDF إلى الدورة")}
        </button>
      </div>}
    </form>
    <div className={styles.uploadRow}>
      <button type="button" disabled={loading || upload.busy || Boolean(working)} className={styles.secondaryButton} onClick={() => {
        setLoading(true);
        setError("");
        setPaused({});
        setRefresh((value) => value + 1);
      }}><RefreshCw size={16} aria-hidden />{t("Refresh status", "حدّث الحالة")}</button>
    </div>
    {loading && <p className={styles.hint} role="status">{t("Loading materials…", "جارٍ تحميل المواد…")}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!loading && !error && !documents.length && <p className={styles.hint}>{t("This course has no documents yet.", "لا توجد مستندات في هذه الدورة بعد.")}</p>}
    <ul className={styles.materialList}>{documents.map((entry) => {
      const stage = statusText[entry.status][language === "ar" ? 1 : 0];
      const statusNotice = entry.status === "UPLOADING" || isPending(entry.status) ? paused[entry.id] : undefined;
      const waitingForFile = entry.status === "UPLOADING" && (statusNotice || entry.id === upload.reservedId) && !upload.busy;
      const needsRetry = entry.status === "FAILED" || isPending(entry.status) && statusNotice;
      return <li key={entry.id} data-current={entry.id === activeDocumentId ? "true" : undefined}>
        <FileText size={21} aria-hidden /><div>
          <h3 dir="auto">{entry.title}</h3>
          <p className={styles.hint} role="status">{entry.id === upload.reservedId && upload.busy ? t("Receiving PDF", "جارٍ استقبال ملف PDF") : paused[entry.id] && isPending(entry.status) ? t("Processing paused", "المعالجة متوقفة مؤقتاً") : stage}</p>
          <ProcessingDetails entry={entry} language={language} active={working === entry.id && isPending(entry.status)} paused={!!paused[entry.id]} />
          {entry.error && <p className={styles.hint}>{entry.error}</p>}
          {statusNotice && <p className={styles.error} role="alert">{statusNotice.message}</p>}
          <div className={styles.actions}>
            {!["UPLOADING", "DELETING"].includes(entry.status) && <Link className={styles.textButton} href={"/documents/" + encodeURIComponent(entry.id)}>{t("View PDF", "اعرض الملف")}</Link>}
            {waitingForFile && <>
              <button type="button" className={styles.secondaryButton} disabled={!!working || discarding === entry.id} onClick={() => {
                upload.selectResume(entry);
                selection.current?.querySelector("button")?.focus();
              }}>{t("Resume upload", "استأنف الرفع")}</button>
              <button type="button" className={styles.textButton} disabled={!!working || !!discarding} onClick={() => void discard(entry.id)}>{t("Discard unfinished upload", "احذف الرفع غير المكتمل")}</button>
            </>}
            {needsRetry && <button type="button" className={styles.secondaryButton} disabled={!!working} onClick={() => resumeProcessing(entry.id)}>{t("Retry processing", "أعد المعالجة")}</button>}
            {entry.status === "READY" && onStudy && <button type="button" className={styles.primaryButton} onClick={onStudy}><MessageCircle size={16} aria-hidden />{t("Ask the course tutor", "اسأل معلّم الدورة")}</button>}
          </div>
        </div>
      </li>;
    })}</ul>
  </section>;
}

export default CourseMaterials;
