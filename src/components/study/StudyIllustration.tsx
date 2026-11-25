"use client";

import { Image as ImageIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { responseError, type StudyLanguage } from "./client";
import styles from "./teaching.module.css";
import study from "./study.module.css";

export function StudyIllustration({ description, prompt, language, fetchImage }: {
  description: string; prompt: string; language: StudyLanguage; fetchImage: (prompt: string, signal: AbortSignal) => Promise<Response>;
}) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const url = useRef("");
  const ar = language === "ar";
  const unavailable = ar ? "تعذّر إنشاء الرسم التوضيحي." : "The illustration could not be created.";
  useEffect(() => () => {
    request.current?.abort();
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);

  async function generate() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetchImage(prompt, controller.signal);
      if (!response.ok) throw new Error(await responseError(response, unavailable));
      const blob = await response.blob();
      if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type) || !blob.size) throw new Error(unavailable);
      if (!controller.signal.aborted) {
        url.current = URL.createObjectURL(blob);
        setImage(url.current);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : unavailable);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <figure className={styles.visual}>
    <figcaption><strong>{ar ? "رسم توضيحي بالذكاء الاصطناعي" : "AI-generated illustration"}</strong><p>{description}</p></figcaption>
    {image ? <Image src={image} alt={description} width={480} height={480} unoptimized className={styles.illustration} />
      : <button type="button" className={study.secondaryButton} disabled={busy} onClick={() => void generate()}>
        <ImageIcon size={16} aria-hidden />{busy ? (ar ? "جارٍ إنشاء الرسم…" : "Creating illustration…") : (ar ? "أنشئ رسماً توضيحياً" : "Create illustration")}
      </button>}
    {error && <p className={study.error} role="alert">{error}</p>}
  </figure>;
}
