"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, GraduationCap, PanelLeft, PanelRightClose } from "lucide-react";
import { CourseMaterials, DocumentViewer, StudyChat } from "@/components/study";
import { sourceHref, type SourceCitation } from "./study/client";
import { Button } from "./ui/button";
import { api, jsonBody } from "@/lib/http";
import { tr, type Language } from "@/lib/locale";
import { markLearningAction } from "@/lib/learning-actions";
import type { CourseSummary } from "./workspace";
import type { CourseDocument } from "./study/upload";

interface Topic { id: string; title: string; }
interface TopicProgress { id: string; topicId: string; title?: string; correct: number; total: number; }
interface CourseView { course: CourseSummary; topics: Topic[]; progress: TopicProgress[]; documents: CourseDocument[]; }

const sourcePanelMedia = "(min-width: 1120px)";

function courseSuggestions(documents: CourseDocument[], lang: Language, activeDocumentId?: string) {
  const indexed = documents.filter(({ status }) => status === "READY");
  const active = indexed.find(({ id }) => id === activeDocumentId);
  const ordered = active ? [active, ...indexed.filter(({ id }) => id !== active.id)] : indexed;
  const suggestions = ordered.flatMap((document) => {
    const outline = document.learningOutline;
    if (!outline?.suggestions?.length) return [{
      label: tr(lang, "Summarize the document", "لخّص المستند"),
      prompt: tr(lang, `Summarize the principal concepts in “${document.title}” using its citations.`, `لخّص المفاهيم الرئيسية في «${document.title}» مع الاستشهاد بصفحاته.`),
      source: document.title,
    }];
    return outline.suggestions.map(({ kind, topics, page }) => {
      const topic = topics.join(tr(lang, " and ", " و")) || document.title;
      const displayTopic = lang === "ar" && topics.length ? topics.map((entry) => `\u2068${entry}\u2069`).join(" و") : topic;
      const label = {
        explain: tr(lang, `Explain ${topic}`, `اشرح ${displayTopic}`),
        summary: tr(lang, "Summarize the key ideas", "لخّص الأفكار الرئيسية"),
        compare: tr(lang, `Compare ${topic}`, `قارن ${displayTopic}`),
        quiz: tr(lang, "Test my understanding", "اختبر فهمي"),
        visual: tr(lang, "Explain this visually", "اشرحها بصرياً"),
      }[kind];
      const question = kind === "quiz" ? tr(lang, `Ask me one practice question about ${topic}`, `اسألني سؤالاً تدريبياً عن ${topic}`)
        : kind === "visual" ? tr(lang, `Explain this visually: ${topic}`, `اشرح هذه الفكرة بصرياً: ${topic}`) : label.replace(/[\u2068\u2069]/gu, "");
      const sourcePage = new Intl.NumberFormat(lang).format(page);
      const source = tr(lang, `Page ${sourcePage}`, `صفحة ${sourcePage}`);
      return { label, source: indexed.length > 1 ? `${document.title} · ${source}` : source,
        prompt: tr(lang, `${question}. Start with page ${page} of “${document.title}” and cite supporting pages.`, `${question}. ابدأ من الصفحة ${sourcePage} من «${document.title}» واستشهد بالصفحات الداعمة.`) };
    });
  });
  const labels = new Set<string>();
  return suggestions.filter(({ label }) => {
    if (labels.has(label)) return false;
    labels.add(label);
    return true;
  }).slice(0, 3);
}

export function CourseWorkspace({ courseId, lang, activeDocumentId }: { courseId: string; lang: Language; activeDocumentId?: string }) {
  const t = (en: string, ar: string) => tr(lang, en, ar);
  const [data, setData] = useState<CourseView | null>(null);
  const [documents, setDocuments] = useState<CourseDocument[]>([]);
  const [failure, setFailure] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  const [readyNotice, setReadyNotice] = useState(false);
  const [topicError, setTopicError] = useState("");
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState<SourceCitation | null>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const tutorSection = useRef<HTMLDivElement>(null);
  const library = useRef<HTMLElement>(null);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const ready = documents.some(({ status }) => status === "READY");

  useEffect(() => {
    const controller = new AbortController();
    void api<CourseView>("/api/workspace/courses/" + encodeURIComponent(courseId), { signal: controller.signal, cache: "no-store" })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setDocuments(result.documents);
        if (window.matchMedia("(max-width: 700px)").matches && result.documents.some(({ status }) => status === "READY")) setMaterialsOpen(false);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : "Course unavailable.");
      });
    return () => controller.abort();
  }, [courseId, loadAttempt]);

  useEffect(() => {
    const media = window.matchMedia(sourcePanelMedia);
    function update() { setSideBySide(media.matches); }
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!source) return;
    if (sideBySide) sourceHeading.current?.focus();
    else if (sourceDialog.current && !sourceDialog.current.open) sourceDialog.current.showModal();
  }, [sideBySide, source]);

  function openTutor() {
    tutorSection.current?.scrollIntoView({ block: "start" });
    tutorSection.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }

  function documentReady() {
    setReadyNotice(true);
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    const restoreFocus = library.current?.contains(document.activeElement);
    setMaterialsOpen(false);
    if (restoreFocus) requestAnimationFrame(() => tutorSection.current?.focus({ preventScroll: true }));
  }

  function openSource(citation: SourceCitation) {
    if (!source) sourceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSource(citation);
  }

  function closeSource() {
    setSource(null);
    requestAnimationFrame(() => sourceTrigger.current?.focus({ preventScroll: true }));
  }

  async function addTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setTopicError("");
    setAdding(true);
    try {
      const { topic } = await api<{ topic: Topic }>("/api/workspace/courses/" + encodeURIComponent(courseId) + "/topics", jsonBody({ title: new FormData(form).get("title") }));
      setData((current) => current ? { ...current, topics: [...current.topics, topic] } : current);
      form.reset();
    } catch (error) {
      setTopicError(error instanceof Error ? error.message : t("Could not add topic.", "تعذّر إضافة الموضوع."));
    } finally { setAdding(false); }
  }

  const sourceContents = source && <>
    <header className="source-reader-header split">
      <h2 id="course-source-heading" className="section-title" ref={sourceHeading} tabIndex={-1}>{t("Cited source", "المصدر المشار إليه")}</h2>
      <Button type="button" variant="quiet" onClick={() => sourceDialog.current?.open ? sourceDialog.current.close() : closeSource()}><PanelRightClose size={16} aria-hidden="true" />{t("Back to answer", "العودة إلى الإجابة")}</Button>
    </header>
    <Link href={sourceHref(source)} className="text-link">{t("Open full-page viewer", "افتح العارض بصفحة كاملة")}</Link>
    <DocumentViewer key={`${source.documentId}:${source.page}:${source.id}`} documentId={source.documentId} initialPage={source.page} citationId={source.id} language={lang} heading="h3" />
  </>;

  return <div className="page-width content-page stack study-workspace">
    <header className="stack">
      <Link className="text-link workspace-breadcrumb" href="/dashboard">{t("My courses", "دوراتي")}</Link>
      <h1 className="page-title" dir="auto">{data?.course.title || t("Course workspace", "مساحة الدورة")}</h1>
      {data?.course.description && <p className="muted" dir="auto">{data.course.description}</p>}
    </header>
    {failure && <div className="card stack">
      <p className="error-line" role="alert">{failure}</p>
      <div><Button variant="secondary" type="button" onClick={() => {
        setFailure("");
        setLoadAttempt((attempt) => attempt + 1);
      }}>{t("Retry loading course", "حاول تحميل الدورة مجدداً")}</Button></div>
    </div>}
    {!data && !failure && <p className="muted" role="status">{t("Loading course…", "جارٍ تحميل الدورة…")}</p>}
    {data && <>
      <nav className="row workspace-actions" aria-label={t("Course navigation", "التنقل في الدورة")}>
        <Button type="button" variant="secondary" aria-controls="course-library" aria-expanded={materialsOpen} onClick={() => setMaterialsOpen((open) => !open)}><PanelLeft size={17} aria-hidden="true" />{t("Materials", "المواد")}</Button>
        <Button type="button" variant="quiet" onClick={openTutor}><BookOpen size={17} aria-hidden="true" />{t("Ask the tutor", "اسأل المعلّم")}</Button>
        <Button asChild variant="quiet"><Link href={"/practice?course=" + encodeURIComponent(courseId)}><GraduationCap size={17} aria-hidden="true" />{t("Quick Quiz", "اختبار سريع")}</Link></Button>
        <Link className="text-link workspace-help" href="/help">{t("Study help", "مساعدة الدراسة")}</Link>
      </nav>
      <div className="study-desk" data-library-open={materialsOpen} data-source-open={!!source && sideBySide} data-ready={ready}>
        <aside className="stack study-library" id="course-library" ref={library} aria-label={t("Course materials and topics", "مواد الدورة وموضوعاتها")} hidden={!materialsOpen}>
          <CourseMaterials courseId={courseId} language={lang} initialDocuments={data.documents} activeDocumentId={activeDocumentId} onStudy={openTutor} onReady={documentReady} onDocumentsChange={setDocuments} />
          <details className="card study-disclosure"><summary>{t("Topics and progress", "الموضوعات والتقدّم")}</summary>
            <div className="stack disclosure-body">
              {data.topics.length ? <ul className="plain-list">{data.topics.map((topic) => {
                const progress = data.progress.find(({ topicId }) => topicId === topic.id);
                return <li className="record" key={topic.id}><span dir="auto">{topic.title}{progress && <> · {progress.correct} / {progress.total}</>}</span><Link href={"/practice?" + new URLSearchParams({ course: courseId, topic: topic.id })}>{t("Practice", "تدرّب")}</Link></li>;
              })}</ul> : <p className="muted">{t("Add a topic to track its quiz results separately.", "أضف موضوعاً لتتبّع نتائج اختباراته بشكل منفصل.")}</p>}
              <form className="stack" onSubmit={addTopic}>
                <label className="field">{t("Topic title", "عنوان الموضوع")}<input name="title" required maxLength={100} dir="auto" /></label>
                <div className="row"><Button variant="secondary" type="submit" disabled={adding}>{t("Add topic", "أضف موضوعاً")}</Button></div>
                {topicError && <p role="alert" className="error-line">{topicError}</p>}
              </form>
              <Link className="text-link" href="/progress">{t("View saved progress", "عرض التقدّم المحفوظ")}</Link>
            </div>
          </details>
        </aside>
        <div className="card course-tutor" ref={tutorSection} tabIndex={-1}>
          {!ready && <p className="course-tutor-note muted">{t("Add a PDF to get suggested topics and answers with page citations.", "أضف ملف PDF لعرض موضوعات مقترحة وإجابات موثّقة بالصفحات.")}</p>}
          {ready && readyNotice && <p className="course-tutor-note muted" role="status">{t("Your course is ready to study.", "دورتك جاهزة للدراسة.")}</p>}
          <StudyChat courseId={courseId} language={lang} suggestions={courseSuggestions(documents, lang, activeDocumentId)} onSourceOpen={openSource} onSuggestionSelected={() => markLearningAction("suggestion")} />
        </div>
        {source && sideBySide && <aside className="card stack course-source" aria-labelledby="course-source-heading">{sourceContents}</aside>}
      </div>
      {source && !sideBySide && <dialog className="card course-source-drawer" ref={sourceDialog} onClose={closeSource} aria-labelledby="course-source-heading"><div className="stack">{sourceContents}</div></dialog>}
    </>}
  </div>;
}
