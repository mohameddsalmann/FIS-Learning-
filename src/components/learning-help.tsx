"use client";

import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hasLearningAction } from "@/lib/learning-actions";
import { tr, type Language } from "@/lib/locale";
import { Button } from "./ui/button";
import { useDashboard } from "./workspace";

const dismissalKey = "fis2_intro_dismissed";

function readDismissal() {
  try { return localStorage.getItem(dismissalKey) === "1"; }
  catch { return false; }
}

function saveDismissal() {
  try { localStorage.setItem(dismissalKey, "1"); }
  catch { /* The tour can still be dismissed for this visit. */ }
}

export function FirstVisitHelp({ lang }: { lang: Language }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(!readDismissal()));
    return () => cancelAnimationFrame(frame);
  }, []);
  if (!visible) return null;
  return <aside className="help-invitation split" aria-label={tr(lang, "Getting started", "البدء")}>
    <p><strong>{tr(lang, "New to FIS Learning?", "هل تستخدم FIS Learning للمرة الأولى؟")}</strong> {tr(lang, "Take a short tour of the study workflow.", "تعرّف سريعاً إلى خطوات الدراسة.")}</p>
    <div className="row">
      <Link className="text-link" href="/help?tour=1">{tr(lang, "Take the tour", "ابدأ الجولة")}</Link>
      <Button type="button" variant="quiet" onClick={() => { saveDismissal(); setVisible(false); }}>{tr(lang, "Don’t show again", "عدم العرض مجدداً")}</Button>
    </div>
  </aside>;
}

export function LearningHelp({ lang, openTour }: { lang: Language; openTour: boolean }) {
  const t = (en: string, ar: string) => tr(lang, en, ar);
  const { data, status } = useDashboard();
  const [step, setStep] = useState(0);
  const [actions, setActions] = useState({ suggestion: false, sample: false, progress: false });
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const restart = useRef<HTMLButtonElement>(null);
  const openedFromLink = useRef(openTour);
  const steps = [
    { title: t("Add a document", "أضف مستنداً"), details: t("Choose or drop a text PDF up to 20 MB. Stay on the course page while its status updates, or reopen the course to resume pending work.", "اختر ملف PDF نصياً أو أفْلته هنا بحجم يصل إلى ٢٠ ميغابايت. تابع الحالة في الدورة أو افتحها من جديد لاستئناف المعالجة.") },
    { title: t("Study with the tutor", "ادرس مع المعلّم"), details: t("Choose a suggested topic from your PDF, or type a question. Open a citation to see the original page, then return to your answer.", "اختر موضوعاً مقترحاً من ملفك أو اكتب سؤالاً. افتح الاستشهاد للاطّلاع على الصفحة الأصلية، ثم عُد إلى الإجابة.") },
    { title: t("Practice and review", "تدرّب وراجع"), details: t("Start a Quick Quiz from your course. Save your attempt, review the explanations, and open Progress to plan what to revisit.", "ابدأ اختباراً سريعاً من دورتك. احفظ المحاولة وراجع الشرح ثم افتح التقدّم لتخطيط المراجعة.") },
  ];

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setActions({ suggestion: hasLearningAction("suggestion"), sample: hasLearningAction("sample-quiz"), progress: hasLearningAction("progress") });
      if (openedFromLink.current && dialog.current && !dialog.current.open) {
        openedFromLink.current = false;
        dialog.current.showModal();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const checklist = [
    { done: data?.hasUploadedDocument === true, label: t("Upload a document", "ارفع مستنداً"), href: "/study" },
    { done: actions.suggestion, label: t("Explore suggested topics", "استكشف الموضوعات المقترحة"), href: "/dashboard" },
    { done: (data?.completedTutorSessions ?? 0) > 0, label: t("Ask the tutor", "اسأل المعلّم"), href: "/chat" },
    { done: Boolean(data?.attempts.length) || actions.sample, label: t("Try a quiz", "جرّب اختباراً"), href: "/practice" },
    { done: actions.progress, label: t("Review progress", "راجع تقدّمك"), href: "/progress" },
  ];

  function startTour() {
    setStep(0);
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }

  function closeTour(dismiss: boolean) {
    if (dismiss) saveDismissal();
    dialog.current?.close();
  }

  function changeStep(next: number) {
    setStep(next);
    requestAnimationFrame(() => dialogHeading.current?.focus());
  }

  return <div className="page-width content-page tight stack">
    <header className="stack">
      <h1 className="page-title">{t("Study help", "مساعدة الدراسة")}</h1>
      <p className="muted">{t("Get started with a PDF and find your next step.", "ابدأ بملف PDF واعرف خطوتك التالية.")}</p>
      <div className="row"><Button type="button" ref={restart} onClick={startTour}>{t("Start guided tour", "ابدأ الجولة الإرشادية")}</Button></div>
    </header>
    <section className="card stack">
      <h2 className="section-title">{t("Getting started checklist", "قائمة خطوات البدء")}</h2>
      {status === "unavailable" && <p className="muted" role="status">{t("Saved activity is temporarily unavailable.", "النشاط المحفوظ غير متاح مؤقتاً.")}</p>}
      <ul className="plain-list">
        {checklist.map(({ done, label, href }) => <li className="record help-checklist-item" key={href}>
          <Link href={href} className="row">{done ? <Check size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}{label}</Link>
          <span className="muted">{done ? t("Done", "تمّت") : status === "loading" ? t("Checking…", "جارٍ التحقّق…") : t("To do", "لم تبدأ بعد")}</span>
        </li>)}
      </ul>
    </section>
    <section className="card stack">
      <h2 className="section-title">{t("When a document or answer needs attention", "عند حدوث مشكلة في المستند أو الإجابة")}</h2>
      <details className="study-disclosure"><summary>{t("My PDF does not have selectable text", "لا يحتوي ملف PDF على نص قابل للتحديد")}</summary><p className="muted disclosure-body">{t("Use a version with selectable text, or run OCR on your device and upload the resulting PDF.", "استخدم نسخة تحتوي على نص قابل للتحديد أو شغّل التعرّف الضوئي على جهازك وارفع الملف الناتج.")}</p></details>
      <details className="study-disclosure"><summary>{t("The tutor cannot find an answer in my sources", "لم يجد المعلّم إجابة في مصادري")}</summary><p className="muted disclosure-body">{t("Name the topic explicitly or refer to the page or section. Add a relevant source if your files do not cover the question.", "اذكر اسم الموضوع بوضوح أو حدّد صفحة أو قسماً. أضف مصدراً مناسباً إذا لم تغطِّ ملفاتك السؤال.")}</p></details>
      <details className="study-disclosure"><summary>{t("A free model is busy", "أحد النماذج المجانية مشغول")}</summary><p className="muted disclosure-body">{t("Use the retry time in the tutor message. The prepared sample and its quiz are available without a provider.", "اتّبع وقت إعادة المحاولة المذكور في رسالة المعلّم. الدرس والاختبار النموذجيان متاحان دون مزوّد.")}</p></details>
    </section>
    <dialog className="card fis-dialog learning-tour" ref={dialog} aria-labelledby="tour-heading" onClose={() => restart.current?.focus()}>
      <div className="stack">
        <p className="muted">{t(`Step ${step + 1} of ${steps.length}`, `الخطوة ${step + 1} من ${steps.length}`)}</p>
        <h2 id="tour-heading" className="section-title" ref={dialogHeading} tabIndex={-1}>{steps[step].title}</h2>
        <p>{steps[step].details}</p>
        <div className="split tour-actions">
          <Button type="button" variant="quiet" onClick={() => closeTour(true)}>{t("Skip tour", "تخطَّ الجولة")}</Button>
          <div className="row">
            <Button type="button" variant="secondary" disabled={step === 0} onClick={() => changeStep(step - 1)}>{t("Previous", "السابق")}</Button>
            {step === steps.length - 1 ? <Button type="button" onClick={() => closeTour(true)}>{t("Finish", "إنهاء")}</Button> :
              <Button type="button" onClick={() => changeStep(step + 1)}>{t("Next", "التالي")}</Button>}
          </div>
        </div>
      </div>
    </dialog>
  </div>;
}
