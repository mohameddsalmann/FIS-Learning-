"use client";

import { FileText, FileUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { tr } from "@/lib/locale";
import { useStudySession } from "@/lib/session";
import type { StudyLanguage } from "./client";
import { documentRequest, uploadCoursePdf, validStudyPdf, type CourseDocument, type TransferProgress, type UploadIntent } from "./upload";
import styles from "./pdf-upload.module.css";

export function usePdfUpload(language: StudyLanguage) {
  const { ensureGuest } = useStudySession();
  const [file, setFile] = useState<File>();
  const [resuming, setResuming] = useState<CourseDocument>();
  const [reservedId, setReservedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<TransferProgress>();
  const [completed, setCompleted] = useState<CourseDocument>();
  const selection = useRef(0);
  const task = useRef<AbortController | null>(null);
  const reservation = useRef<{ courseId: string; intent: UploadIntent } | undefined>(undefined);
  const requestKey = useRef<{ courseId: string; value: string } | undefined>(undefined);

  useEffect(() => () => task.current?.abort(), []);

  function selectResume(document?: CourseDocument) {
    selection.current++;
    setResuming(document);
    setReservedId(document?.id);
    setFile(undefined);
    setCompleted(undefined);
    setError("");
    setCancelled(false);
    setChecking(false);
    reservation.current = undefined;
    requestKey.current = undefined;
  }

  async function selectFile(files: FileList) {
    if (task.current) return;
    const current = ++selection.current;
    const next = files.item(0);
    if (!next) return;
    setError("");
    setFile(undefined);
    setCancelled(false);
    setCompleted(undefined);
    setProgress(undefined);
    setChecking(true);
    if (!resuming) {
      reservation.current = undefined;
      requestKey.current = undefined;
      setReservedId(undefined);
    }
    const valid = files.length === 1 && await validStudyPdf(next).catch(() => false);
    if (current !== selection.current) return;
    setChecking(false);
    if (!valid) {
      setError(tr(language, "Choose one valid PDF up to 20 MB.", "اختر ملف PDF صالحاً واحداً بحجم ٢٠ ميغابايت أو أقل."));
      return;
    }
    const reservationTitle = next.name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "-").slice(0, 150);
    if (resuming && (next.size !== resuming.sizeBytes || reservationTitle !== resuming.title)) {
      setError(tr(language, "Choose the original PDF to resume this upload.", "اختر ملف PDF الأصلي لاستئناف الرفع."));
      return;
    }
    setFile(next);
  }

  async function submit(destination: (signal: AbortSignal) => Promise<string>, onReserved?: (document: CourseDocument) => void) {
    if (!file || task.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    task.current = controller;
    setBusy(true);
    setCancelled(false);
    setError("");
    setProgress(undefined);
    try {
      await ensureGuest();
      signal.throwIfAborted();
      const courseId = await destination(signal);
      signal.throwIfAborted();
      if (requestKey.current?.courseId !== courseId) requestKey.current = { courseId, value: crypto.randomUUID() };
      const previous = reservation.current?.courseId === courseId ? reservation.current.intent
        : resuming ? await documentRequest<UploadIntent>(`/api/documents/uploads/${encodeURIComponent(resuming.id)}`, language, { signal }) : undefined;
      const document = await uploadCoursePdf(file, courseId, language, signal, {
        previous, requestKey: requestKey.current.value, onProgress: setProgress, onReserve: (intent) => {
          reservation.current = { courseId, intent };
          setReservedId(intent.document.id);
          onReserved?.(intent.document);
        },
      });
      reservation.current = undefined;
      requestKey.current = undefined;
      setReservedId(undefined);
      setResuming(undefined);
      setFile(undefined);
      setCompleted(document);
      return document;
    } catch (problem) {
      if (signal.aborted) setCancelled(true);
      else setError(problem instanceof Error && !(problem instanceof TypeError) ? problem.message
        : tr(language, "The upload was interrupted. Try again with the same PDF.", "انقطع الرفع. حاول مرة أخرى باستخدام ملف PDF نفسه."));
    } finally {
      task.current = null;
      setBusy(false);
    }
  }

  return {
    file, resuming, reservedId, busy, checking, error, cancelled, progress, completed,
    selectFile, selectResume, submit, cancel: () => task.current?.abort(),
  };
}

export function PdfUploadSelection({ language, upload, disabled, chooseLabel }: {
  language: StudyLanguage; upload: ReturnType<typeof usePdfUpload>; disabled?: boolean; chooseLabel?: string;
}) {
  const { file, busy, checking, error, cancelled, progress, resuming, completed, selectFile, selectResume, cancel } = upload;
  const t = (en: string, ar: string) => tr(language, en, ar);
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  const [dragging, setDragging] = useState(false);
  const unavailable = disabled || busy;
  const verifying = !!progress && progress.loaded >= progress.total;
  const size = (bytes: number) => new Intl.NumberFormat(language, {
    style: "unit", unit: bytes >= 1024 * 1024 ? "megabyte" : "kilobyte", maximumFractionDigits: 1,
  }).format(bytes >= 1024 * 1024 ? bytes / (1024 * 1024) : bytes / 1024);

  return <div className={styles.selection}>
    <div className={styles.dropZone} data-dragging={dragging} onDragOver={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = unavailable ? "none" : "copy";
      if (!unavailable) setDragging(true);
    }} onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
    }} onDrop={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(false);
      if (!unavailable) void selectFile(event.dataTransfer.files);
    }}>
      <FileUp size={24} aria-hidden="true" />
      <div>
        <strong>{resuming ? t("Choose the original PDF", "اختر ملف PDF الأصلي") : t("Drop a PDF here", "أفلت ملف PDF هنا")}</strong>
        <p id={hint}>{resuming ? <bdi>{resuming.title}</bdi> : t("One text-based PDF, up to 20 MB.", "ملف PDF نصّي واحد حتى ٢٠ ميغابايت.")}</p>
      </div>
      <input ref={input} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => {
        if (event.target.files?.length) void selectFile(event.target.files);
        event.target.value = "";
      }} />
      <button className="button secondary" type="button" disabled={unavailable} aria-describedby={hint} onClick={() => input.current?.click()}>
        {chooseLabel ?? t("Choose PDF", "اختر مستند PDF")}
      </button>
    </div>
    {checking && <p className="muted" role="status">{t("Checking PDF…", "جارٍ فحص ملف PDF…")}</p>}
    {file && <div className={styles.filePreview}>
      <FileText size={21} aria-hidden="true" />
      <div><strong dir="auto">{file.name}</strong><small>{size(file.size)}</small></div>
      <button className="button quiet" type="button" onClick={busy ? cancel : () => selectResume()}>
        {busy ? t("Cancel upload", "ألغِ الرفع") : t("Clear selection", "امسح التحديد")}
      </button>
    </div>}
    {busy && <div className={styles.transfer}>
      <span role="status">{verifying ? t("Verifying private upload…", "جارٍ التحقق من الرفع الخاص…") : t("Uploading PDF…", "جارٍ رفع ملف PDF…")}</span>
      <progress aria-label={t("PDF upload progress", "تقدّم رفع ملف PDF")} max={progress?.total} value={verifying ? undefined : progress?.loaded} />
      {progress && !verifying && <small>{t(`${size(progress.loaded)} of ${size(progress.total)} transferred`, `تم نقل ${size(progress.loaded)} من ${size(progress.total)}`)}</small>}
    </div>}
    {error && <p className="error-line" role="alert">{error}</p>}
    {cancelled && <p className="muted" role="status">{t("Upload cancelled. You can try again with the same PDF.", "تم إلغاء الرفع. يمكنك إعادة المحاولة باستخدام الملف نفسه.")}</p>}
    {completed && <p className="muted" role="status">{t("PDF saved privately. Processing is queued.", "حُفظ ملف PDF بشكل خاص وأُضيف إلى قائمة المعالجة.")}</p>}
  </div>;
}
