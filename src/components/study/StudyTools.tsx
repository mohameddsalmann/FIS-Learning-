"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useStudySession } from "@/lib/session";
import { responseError, type StudyLanguage } from "./client";
import { useStudyLanguage } from "./language";
import styles from "./study.module.css";

type Tool = "image" | "decision" | "notes";
type ToolResult = { checks?: { id: string; probability: number | null }[]; passages?: string[] };

const fields: Record<Tool, { name: string; en: string; ar: string; max: number; optional?: boolean }[]> = {
  image: [{ name: "prompt", en: "Describe the illustration", ar: "صف الرسم التوضيحي", max: 2000 }],
  decision: [
    { name: "question", en: "Question", ar: "السؤال", max: 2000 },
    { name: "answer", en: "Your response", ar: "إجابتك", max: 4000 },
    { name: "reference", en: "Reference answer (optional)", ar: "إجابة مرجعية (اختياري)", max: 4000, optional: true },
  ],
  notes: [
    { name: "query", en: "Search query", ar: "عبارة البحث", max: 1000 },
    { name: "notes", en: "Pasted notes", ar: "الملاحظات الملصقة", max: 16000 },
  ],
};

export function StudyTools({ language: preferred }: { language?: StudyLanguage }) {
  const language = useStudyLanguage(preferred);
  const ar = language === "ar";
  const pick = (en: string, arabic: string) => ar ? arabic : en;
  const { ensureGuest, requestInit } = useStudySession();
  const [tool, setTool] = useState<Tool>("image");
  const [result, setResult] = useState<ToolResult>();
  const [image, setImage] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);

  function changeTool(value: Tool) {
    request.current?.abort();
    request.current = null;
    setTool(value);
    setBusy(false);
    setError("");
    setImage(undefined);
    setResult(undefined);
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setImage(undefined);
    setResult(undefined);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(fields[tool].map(({ name }) => [name, form.get(name)]));
    if (tool === "decision" && !String(payload.reference ?? "").trim()) delete payload.reference;
    const body = tool === "notes" ? { ...payload, rerank: form.has("rerank") } : payload;
    const init = requestInit({ method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": language }, body: JSON.stringify(body), signal: controller.signal });
    try {
      let response = await fetch("/api/learning/" + tool, init);
      if (response.status === 401 && !controller.signal.aborted) { await ensureGuest(); response = await fetch("/api/learning/" + tool, init); }
      if (!response.ok) throw new Error(await responseError(response, pick("The tool could not complete this request.", "تعذّر إكمال الطلب باستخدام هذه الأداة.")));
      if (tool === "image") {
        const blob = await response.blob();
        if (!controller.signal.aborted) setImage(URL.createObjectURL(blob));
      } else {
        const data = await response.json() as ToolResult;
        if (!controller.signal.aborted) setResult(data);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : pick("Try again in a moment.", "حاول مجدداً بعد قليل."));
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  const toolNames = { image: pick("Create illustration", "إنشاء رسم"), decision: pick("Check an answer", "تحقّق من إجابة"), notes: pick("Search notes", "البحث في الملاحظات") };
  const criteria: Record<string,string> = { addresses_prompt: pick("Addresses the question", "يجيب عن السؤال"), agrees_with_reference: pick("Agrees with the reference", "يتوافق مع الإجابة المرجعية") };
  return <details className={styles.tools} dir={ar ? "rtl" : "ltr"}>
    <summary>{pick("More study tools", "أدوات دراسة إضافية")}</summary>
    <div className={styles.toolsForm}>
      <div className={styles.actions}>{(Object.keys(toolNames) as Tool[]).map((value) => <button type="button" key={value} className={tool === value ? styles.primaryButton : styles.secondaryButton} aria-pressed={tool === value} onClick={() => changeTool(value)}>{toolNames[value]}</button>)}</div>
      <form key={tool} onSubmit={run} className={styles.toolsForm}>
        {fields[tool].map(({ name, en, ar: arabic, max, optional }) => <label className={styles.fieldLabel} key={name}>{pick(en, arabic)}
          <textarea name={name} dir="auto" className={styles.field} rows={name === "notes" ? 5 : 2} maxLength={max} required={!optional} />
        </label>)}
        {tool === "notes" && <label className={styles.hint}><input type="checkbox" name="rerank" /> {pick("Refine the matches with an additional ranking request", "حسّن النتائج بطلب ترتيب إضافي")}</label>}
        <div><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? pick("Working…", "جارٍ التنفيذ…") : toolNames[tool]}</button></div>
      </form>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {image && <div className={styles.stack}>
        <Image src={image} alt={pick("Generated study illustration", "رسم توضيحي للدراسة")} width={512} height={512} unoptimized />
        <a className={styles.secondaryButton} href={image} download="study-illustration">{pick("Download illustration", "تنزيل الرسم")}</a>
      </div>}
      {result?.passages && <section aria-label={pick("Matching passages", "المقاطع المطابقة")}><h3>{pick("Matching passages", "المقاطع المطابقة")}</h3>{result.passages.length ? <ol>{result.passages.map((item, index) => <li dir="auto" key={index}>{item}</li>)}</ol> : <p>{pick("No passages matched.", "لا توجد مقاطع مطابقة.")}</p>}</section>}
      {result?.checks && <section aria-label={pick("Review indicators", "مؤشرات المراجعة")}><p className={styles.hint}>{pick("These indicators support review. They are not academic grades.", "هذه المؤشرات للمراجعة وليست درجات أكاديمية.")}</p><ul>{result.checks.map(({ id, probability }) => <li key={id}>{criteria[id] ?? id} · {probability === null ? pick("Review required", "تتطلّب مراجعة") : new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(probability)}</li>)}</ul></section>}
    </div>
  </details>;
}
