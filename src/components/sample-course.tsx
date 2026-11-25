"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { findSampleSources, sampleCourseTitle, sampleLessons } from "@/lib/sample";
import { tr, type Language } from "@/lib/locale";
import { Button } from "./ui/button";

export function SampleCourse({ lang }: { lang: Language }) {
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const matches = question ? findSampleSources(question,lang) : [];
  const lessons = sampleLessons(lang);
  const t = (en: string, ar: string) => tr(lang,en,ar);
  function search(event: FormEvent) {
    event.preventDefault();
    setQuestion(query.trim());
  }
  return <div className="page-width content-page stack">
    <div className="stack">
      <div className="row"><span className="badge">{t("Prepared sample course","دورة نموذجية مُعدّة مسبقاً")}</span><span className="muted">{t("3 short lessons","٣ دروس قصيرة")}</span></div>
      <h1 className="page-title">{sampleCourseTitle(lang)}</h1>
      <p className="muted">{t("Use three short notes to understand what light does at a mirror, when it enters glass, and inside a prism.","استخدم ثلاث ملاحظات قصيرة لفهم ما يحدث للضوء عند المرآة وعند انتقاله إلى الزجاج ومروره داخل المنشور.")}</p>
      <div className="row">
        <Button asChild><Link href="/practice?sample=1">{t("Take the sample quiz","ابدأ الاختبار النموذجي")}</Link></Button>
        <Button asChild variant="secondary"><Link href="/chat">{t("Open live tutor","افتح المعلّم المباشر")}</Link></Button>
      </div>
    </div>
    <div className="course-grid">
      <section className="card stack" aria-labelledby="sample-notes">
        <h2 id="sample-notes" className="section-title">{t("Source notes","الملاحظات المصدرية")}</h2>
        <nav className="row" aria-label={t("Lesson sections","أقسام الدرس")}>{lessons.map((section) => <a className="text-link" key={section.id} href={"#"+section.id}>{section.title}</a>)}</nav>
        {lessons.map((section) => <article className="source-panel stack" key={section.id} id={section.id} tabIndex={-1}>
          <h3><b>{section.page}. {section.title}</b></h3><p>{section.text}</p>
        </article>)}
      </section>
      <section className="card stack" aria-labelledby="sample-search">
        <h2 id="sample-search" className="section-title">{t("Search the sample notes","ابحث في ملاحظات النموذج")}</h2>
        <p className="muted">{t("This prepared demo finds source passages without calling an AI provider.","يعثر هذا النموذج المُعَد مسبقاً على مقاطع من المصدر دون استدعاء مزوّد ذكاء اصطناعي.")}</p>
        <form className="stack" onSubmit={search}>
          <label className="field">{t("Question about the lesson","سؤال عن الدرس")}
            <input dir="auto" value={query} maxLength={400} onChange={(event) => setQuery(event.target.value)} placeholder={t("Why does a prism separate colors?","لماذا يفصل المنشور الألوان؟")} />
          </label>
          <div className="row"><Button type="submit" disabled={!query.trim()}><Search size={17} aria-hidden="true" />{t("Find sources","اعثر على المصادر")}</Button></div>
        </form>
        <div className="stack" aria-live="polite">
          {question && !matches.length && <p className="empty">{t("The sample notes have no matching evidence. Try mirror, glass, or prism.","لا يوجد دليل مطابق في الملاحظات. جرّب المرآة أو الزجاج أو المنشور.")}</p>}
          {matches.map((part) => <article className="source-panel stack" key={part.id}>
            <a className="text-link" href={"#"+part.id}>{t("Source","المصدر")} {part.page} · {part.title}</a><p>{part.text}</p>
          </article>)}
        </div>
      </section>
    </div>
  </div>;
}
