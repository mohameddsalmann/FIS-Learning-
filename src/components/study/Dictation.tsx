"use client";

import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StudyLanguage } from "./client";
import styles from "./study.module.css";

type SpeechOptions = { langs: string[]; processLocally: true };
type SpeechResult = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
interface Recognizer {
  lang: string;
  processLocally: boolean;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: SpeechResult }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechConstructor {
  new (): Recognizer;
  available?(options: SpeechOptions): Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install?(options: SpeechOptions): Promise<boolean>;
}

export function Dictation({ language, onInsert, onClose }: { language: StudyLanguage; onInsert: (text: string) => void; onClose: () => void }) {
  const ar = language === "ar";
  const dialog = useRef<HTMLDialogElement>(null);
  const recognizer = useRef<Recognizer | null>(null);
  const active = useRef(false);
  const [dialect, setDialect] = useState(language === "ar" ? "ar-EG" : "en-US");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "listening" | "unsupported" | "error">("idle");

  useEffect(() => {
    const element = dialog.current;
    active.current = true;
    element?.showModal();
    return () => {
      active.current = false;
      recognizer.current?.abort();
      element?.close();
    };
  }, []);

  async function start() {
    if (status === "listening") {
      recognizer.current?.stop();
      return;
    }
    const speech = window as Window & { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };
    const Ctor = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
    if (!Ctor?.available) {
      setStatus("unsupported");
      return;
    }
    setStatus("checking");
    const options: SpeechOptions = { langs: [dialect], processLocally: true };
    try {
      const available = await Ctor.available(options);
      if (!active.current) return;
      if (available !== "available" && (available !== "downloadable" || !Ctor.install || !(await Ctor.install(options)))) {
        if (active.current) setStatus("unsupported");
        return;
      }
      if (!active.current) return;
      const next = new Ctor();
      if (!("processLocally" in next)) { setStatus("unsupported"); return; }
      recognizer.current = next;
      next.lang = dialect;
      next.processLocally = true;
      next.continuous = true;
      next.interimResults = true;
      next.onresult = (event) => {
        const text = Array.from(event.results).map((item) => item[0].transcript).join(" ").trim();
        if (active.current) setDraft(text);
      };
      next.onerror = () => { if (active.current) setStatus("error"); };
      next.onend = () => { if (active.current) setStatus((value) => value === "error" ? value : "idle"); };
      next.start();
      setStatus("listening");
    } catch {
      if (active.current) setStatus("error");
    }
  }

  const messages = {
    idle: ar ? "ابدأ التسجيل، ثم راجع النص قبل إدراجه." : "Start dictation, then review the transcript before inserting it.",
    checking: ar ? "جارٍ التحقق من حزمة اللغة المحلية…" : "Checking the on-device language pack…",
    listening: ar ? "الميكروفون يعمل على الجهاز." : "The microphone is listening on this device.",
    unsupported: ar ? "الإملاء المحلي غير متاح لهذه اللغة أو في هذا المتصفح. يمكنك الكتابة أدناه." : "On-device dictation is unavailable for this language or browser. You can type below.",
    error: ar ? "تعذّر بدء الإملاء. راجع إذن الميكروفون أو اكتب النص." : "Dictation could not start. Check microphone permission or type your transcript.",
  };

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="dictation-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={styles.dialogHeader}>
        <h3 id="dictation-title">{ar ? "إملاء سؤال" : "Dictate a question"}</h3>
        <button type="button" className={styles.iconButton} aria-label={ar ? "إغلاق" : "Close dictation"} onClick={onClose}><X size={18} aria-hidden /></button>
      </div>
      <fieldset className={styles.languageOptions} disabled={status === "listening" || status === "checking"}>
        <legend>{ar ? "لغة الإملاء" : "Dictation language"}</legend>
        <label><input type="radio" name="study-dialect" value="en-US" checked={dialect === "en-US"} onChange={(event) => setDialect(event.target.value)} /> English (US)</label>
        <label><input type="radio" name="study-dialect" value="ar-EG" checked={dialect === "ar-EG"} onChange={(event) => setDialect(event.target.value)} /> العربية (مصر)</label>
      </fieldset>
      <p role="status" className={styles.hint}>{messages[status]}</p>
      <label className={styles.fieldLabel} htmlFor="dictation-draft">{ar ? "النص" : "Transcript"}</label>
      <textarea id="dictation-draft" className={styles.field} dir="auto" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={start} disabled={status === "checking"}>
          {status === "listening" ? <Square size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
          {status === "listening" ? ar ? "إيقاف" : "Stop dictation" : ar ? "ابدأ الإملاء" : "Start dictation"}
        </button>
        <button type="button" className={styles.primaryButton} disabled={!draft.trim() || status === "listening"} onClick={() => onInsert(draft.trim())}>{ar ? "استخدم النص" : "Use transcript"}</button>
      </div>
    </dialog>
  );
}
