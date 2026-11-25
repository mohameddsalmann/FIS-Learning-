"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, MessageCircle, Plus } from "lucide-react";
import { api, jsonBody, RequestError } from "@/lib/http";
import { tr, type Language } from "@/lib/locale";
import { sampleResultsKey, type SampleAttempt } from "@/lib/sample";
import { useStudySession } from "@/lib/session";
import { markLearningAction } from "@/lib/learning-actions";
import { Button } from "./ui/button";

export interface CourseSummary { id: string; title: string; description: string | null; }
interface TopicMetric { id: string; topicId: string; courseId: string; title: string; attempts: number; correct: number; total: number; updatedAt: string; }
interface Attempt { id: string; total: number; score: number; createdAt: string; quiz: { title: string; courseId: string }; }
interface Conversation { id: string; title: string; courseId: string | null; updatedAt: string; }
interface Revision { id: string; title: string; topicId: string | null; dueAt: string; completedAt: string | null; }
export interface DashboardData {
  courses: CourseSummary[];
  progress: TopicMetric[];
  conversations: Conversation[];
  attempts: Attempt[];
  revision: Revision[];
  completedSessions: number;
  completedTutorSessions?: number;
  hasUploadedDocument?: boolean;
  practiceTotals?: { attempts: number; correct: number; graded: number; practicedTopics: number };
}

function dateText(date: string, lang: Language) {
  return new Date(date).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" });
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData>();
  const [status, setStatus] = useState<"loading"|"success"|"guest"|"unavailable">("loading");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await api<DashboardData>("/api/workspace/dashboard", { signal, cache: "no-store" });
      if (!signal?.aborted) {
        setData(response);
        setStatus("success");
      }
    } catch (error) {
      if (!signal?.aborted) setStatus(error instanceof RequestError && error.status === 401 ? "guest" : "unavailable");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return refresh(controller.signal);
    });
    return () => controller.abort();
  }, [refresh]);
  return { data, status, refresh };
}

export function HomeActivity({ lang }: { lang: Language }) {
  const { data, status } = useDashboard();
  const t = (en: string, ar: string) => tr(lang,en,ar);
  return <section className="home-activity stack" aria-labelledby="home-activity">
    <div className="split">
      <h2 id="home-activity" className="section-title">{t("Continue a course","تابع دورة")}</h2>
      <Link href="/dashboard" className="text-link">{t("View my courses", "اعرض دوراتي")}</Link>
    </div>
    {data?.courses.length ? <ul className="plain-list card">{data.courses.slice(0,3).map((course) => <li className="record history-entry" key={course.id}>
      <Link className="row" href={"/courses/" + course.id}><BookOpen size={17} aria-hidden="true" /><span dir="auto">{course.title}</span></Link>
      {course.description && <span className="muted" dir="auto">{course.description}</span>}
    </li>)}</ul> : <div className="card row">
      <p className="muted" role="status">{status === "loading" ? t("Loading your courses…", "جارٍ تحميل دوراتك…")
        : status === "unavailable" ? t("Saved courses are temporarily unavailable.", "الدورات المحفوظة غير متاحة مؤقتاً.")
          : t("Courses you create will appear here.", "ستظهر هنا الدورات التي تنشئها.")}</p>
      {status !== "loading" && status !== "unavailable" && <Link href="/dashboard?new=1" className="text-link">{t("Create a course", "أنشئ دورة")}</Link>}
    </div>}
  </section>;
}

export function StudyHistory({ lang }: { lang: Language }) {
  const { data, status, refresh } = useDashboard();
  const t = (en: string, ar: string) => tr(lang, en, ar);
  return <div className="page-width content-page tight stack">
    <div className="split">
      <div><h1 className="page-title">{t("Study history", "سجل الدراسة")}</h1><p className="muted">{t("Open a previous tutor conversation to pick up where you left off.", "افتح محادثة سابقة مع المعلّم لتتابع من حيث توقفت.")}</p></div>
      <Button asChild><Link href="/chat">{t("New conversation", "محادثة جديدة")}</Link></Button>
    </div>
    {status === "loading" && <p role="status" className="muted">{t("Loading history…", "جارٍ تحميل السجل…")}</p>}
    {status === "unavailable" && <div className="status-box row" role="status"><span>{t("History could not load.", "تعذّر تحميل السجل.")}</span><Button variant="quiet" onClick={() => void refresh()}>{t("Retry", "أعد المحاولة")}</Button></div>}
    {data?.conversations.length ? <ul className="card plain-list">{data.conversations.map((chat) => <li className="record history-entry" key={chat.id}>
      <Link className="row" href={"/chat?conversation=" + encodeURIComponent(chat.id)}><MessageCircle size={17} aria-hidden="true" /><span dir="auto">{chat.title}</span></Link>
      <time className="muted" dateTime={chat.updatedAt}>{dateText(chat.updatedAt, lang)}</time>
    </li>)}</ul> : (status === "success" || status === "guest") && <p className="empty">{t("Your saved conversations will appear after you study with the tutor.", "ستظهر محادثاتك المحفوظة بعد الدراسة مع المعلّم.")}</p>}
  </div>;
}

export function Dashboard({ lang, startForm }: { lang: Language; startForm: boolean }) {
  const t = (en: string, ar: string) => tr(lang,en,ar);
  const { data, status, refresh } = useDashboard();
  const { ensureGuest } = useStudySession();
  const router = useRouter();
  const [showForm, setShowForm] = useState(startForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revisionBusy,setRevisionBusy] = useState("");
  const [revisionError,setRevisionError] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(""); setBusy(true);
    try {
      await ensureGuest();
      const result = await api<{course:CourseSummary}>("/api/workspace/courses",jsonBody({ title: form.get("title"), description: form.get("description") }));
      router.push("/courses/"+result.course.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not create the course.","تعذّر إنشاء الدورة."));
    } finally { setBusy(false); }
  }
  async function completeRevision(id: string) {
    setRevisionBusy(id); setRevisionError("");
    try {
      await api("/api/workspace/revision/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({completed:true})});
      await refresh();
    } catch (err) { setRevisionError(err instanceof Error ? err.message : t("Could not update revision.","تعذّر تحديث المراجعة.")); }
    finally { setRevisionBusy(""); }
  }
  return <div className="page-width content-page stack">
    <div className="split"><div className="stack"><h1 className="page-title">{t("My courses","دوراتي")}</h1><p className="muted">{t("Continue a course, review recent work, or start with your materials.","تابع دورة، أو راجع عملك الأخير، أو ابدأ باستخدام موادك.")}</p></div>
      <div className="row"><Button asChild><Link href="/study">{t("Study a document", "ادرس مستنداً")}</Link></Button>
        <Button variant="secondary" aria-expanded={showForm} aria-controls={showForm ? "course-form" : undefined} onClick={() => setShowForm(!showForm)}><Plus size={17} aria-hidden="true" />{t("New course","دورة جديدة")}</Button></div>
    </div>
    {showForm && <form id="course-form" className="card stack" onSubmit={create}>
      <h2 className="section-title">{t("Create a course","أنشئ دورة")}</h2>
      <label className="field">{t("Course title","عنوان الدورة")}<input name="title" required maxLength={110} dir="auto" /></label>
      <label className="field">{t("Description","الوصف")}<textarea name="description" maxLength={1000} rows={2} dir="auto" /></label>
      <div className="row"><Button type="submit" disabled={busy}>{busy ? t("Creating…","جارٍ الإنشاء…") : t("Create course","إنشاء الدورة")}</Button></div>
      {error && <p role="alert" className="error-line">{error}</p>}
    </form>}
    {status === "unavailable" && <div className="status-box row" role="status">
      <span>{t("The saved workspace is temporarily unavailable.","مساحة العمل المحفوظة غير متاحة مؤقتاً.")}</span>
      <Button variant="quiet" onClick={() => void refresh()}>{t("Retry","أعد المحاولة")}</Button>
    </div>}
    <section aria-label={t("Course list","قائمة الدورات")} className="grid-2 course-list">
      {data?.courses.map((course) => <Link key={course.id} className="card stack" href={"/courses/" + course.id}>
        <span className="row"><BookOpen size={18} aria-hidden="true" /><b>{course.title}</b><ArrowUpRight size={15} aria-hidden="true" /></span>
        {course.description && <span className="muted">{course.description}</span>}
      </Link>)}
    </section>
    {(status === "success" || status === "guest") && !data?.courses.length && <p className="empty">{t("No courses yet. Add a PDF or create a course to get started.", "لا توجد دورات بعد. أضف ملف PDF أو أنشئ دورة للبدء.")}</p>}
    <div className="grid-2">
      <section className="card stack"><h2 className="section-title">{t("Upcoming revision","المراجعة القادمة")}</h2>
        {data?.revision.some((item)=>!item.completedAt) ? <ul className="plain-list">{data.revision.filter((item)=>!item.completedAt).slice(0,5).map((item)=><li className="record" key={item.id}><span>{item.title} · <time dateTime={item.dueAt}>{dateText(item.dueAt,lang)}</time></span><Button variant="quiet" disabled={revisionBusy===item.id} onClick={()=>void completeRevision(item.id)}>{t("Mark complete","أكملت المراجعة")}</Button></li>)}</ul> : <p className="muted">{t("Complete a quiz to see revision suggestions here.","أكمل اختباراً لعرض مقترحات المراجعة هنا.")}</p>}
        {revisionError && <p role="alert" className="error-line">{revisionError}</p>}
      </section>
      <section className="card stack"><h2 className="section-title">{t("Recent conversations","المحادثات الأخيرة")}</h2>
        {data?.conversations.length ? <ul className="plain-list">{data.conversations.slice(0,5).map((chat)=><li className="record" key={chat.id}><Link href={"/chat?conversation="+chat.id}>{chat.title}</Link><time dateTime={chat.updatedAt}>{dateText(chat.updatedAt,lang)}</time></li>)}</ul> : <p className="muted">{t("Conversations will appear here after you study with the tutor.","تظهر المحادثات هنا بعد الدراسة مع المعلّم.")}</p>}
      </section>
      <section className="card stack"><h2 className="section-title">{t("Recent quizzes","الاختبارات الأخيرة")}</h2>
        {data?.attempts.length ? <ul className="plain-list">{data.attempts.slice(0,5).map((attempt)=><li className="record" key={attempt.id}><span>{attempt.quiz.title}</span><span>{attempt.score} / {attempt.total}</span></li>)}</ul> : <p className="muted">{t("No saved attempts yet.","لا توجد محاولات محفوظة بعد.")}</p>}
      </section>
      <section className="card stack"><h2 className="section-title">{t("Learning progress","تقدّم التعلّم")}</h2>
        <p className="muted">{t("Review topic coverage, accuracy, and areas to revisit.","راجع الموضوعات التي تدربت عليها والدقة والنقاط التي تحتاج إلى مراجعة.")}</p>
        <Link className="text-link" href="/progress">{t("View progress","عرض التقدّم")}</Link>
      </section>
    </div>
  </div>;
}

export function Progress({ lang }: { lang: Language }) {
  const { data, status } = useDashboard();
  const [sample, setSample] = useState<SampleAttempt[]>([]);
  const t = (en: string, ar: string) => tr(lang,en,ar);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(sampleResultsKey) || "[]");
        if (Array.isArray(saved)) setSample(saved);
      } catch { /* Preview history is optional. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const hasResults = Boolean(data?.attempts.length || sample.length);
  useEffect(() => {
    if (hasResults) markLearningAction("progress");
  }, [hasResults]);
  const correct = data?.practiceTotals?.correct ?? 0;
  const total = data?.practiceTotals?.graded ?? 0;
  const weak = (data?.progress || []).filter((topic)=>topic.total>0 && topic.correct/topic.total<.7);
  const graded = (data?.attempts || []).filter((attempt)=>attempt.total>0);
  const latest=graded[0], earliest=graded.at(-1);
  const change=latest && earliest && graded.length>1 ? Math.round((latest.score/latest.total-earliest.score/earliest.total)*100) : null;
  return <div className="page-width content-page stack">
    <h1 className="page-title">{t("Learning progress","تقدّم التعلّم")}</h1>
    <p className="muted">{t("Accuracy and topic coverage reflect saved practice. A reliable mastery estimate requires more evidence across questions and sessions.","تعكس الدقة وتغطية الموضوعات التدريب المحفوظ. يتطلّب تقدير الإتقان الموثوق أدلة إضافية عبر أسئلة وجلسات متعددة.")}</p>
    {status === "unavailable" && <p className="status-box" role="status">{t("Saved progress is currently unavailable.","التقدّم المحفوظ غير متاح حالياً.")}</p>}
    <div className="grid-3">
      {[ [t("Quiz attempts","محاولات الاختبار"),data?.practiceTotals?.attempts],
        [t("Recorded accuracy","دقة الإجابات المسجّلة"),total ? Math.round(correct/total*100)+"%" : undefined],
        [t("Topics practiced","الموضوعات المتدرّب عليها"),data?.practiceTotals?.practicedTopics],
        [t("Completed study sessions","جلسات الدراسة المكتملة"),data?.completedSessions] ].map(([label,value]) =>
          <div className="card metric" key={label}><span>{label}</span><output>{value ?? "—"}</output></div>)}
    </div>
    <div className="grid-2">
      <section className="card stack"><h2 className="section-title">{t("Topic performance","الأداء حسب الموضوع")}</h2>
        {data?.progress.length ? <ul className="plain-list">{data.progress.map((record)=><li key={record.id} className="record"><span>{record.title}</span><span>{record.correct} / {record.total}</span></li>)}</ul> : <p className="muted">{t("Finish a topic quiz to start tracking results.","أكمل اختبار موضوع لبدء تتبّع النتائج.")}</p>}
      </section>
      <section className="card stack"><h2 className="section-title">{t("Topics to revisit","موضوعات تحتاج إلى مراجعة")}</h2>
        {weak.length ? <ul className="plain-list">{weak.map((record) => <li className="review-topic" key={record.id}>
          <strong dir="auto">{record.title}</strong>
          <div className="row review-actions">
            <Link className="text-link" href={"/courses/" + encodeURIComponent(record.courseId)}>{t("Review", "راجع")}</Link>
            <Link className="text-link" href={"/practice?" + new URLSearchParams({ course: record.courseId, topic: record.topicId })}>{t("Practice again", "تدرّب مجدداً")}</Link>
            <Link className="text-link" href={"/chat?" + new URLSearchParams({ course: record.courseId, prompt: t(`Explain ${record.title} differently, using a simple example and a source.`, `اشرح ${record.title} بطريقة مختلفة، مع مثال بسيط ومصدر.`) })}>{t("Explain differently", "اشرح بطريقة مختلفة")}</Link>
          </div>
        </li>)}</ul> : <p className="muted">{t("Suggestions appear for topics with recorded accuracy below 70%.","تظهر اقتراحات للموضوعات التي تقل الدقة المسجّلة فيها عن ٧٠٪.")}</p>}
      </section>
      <section className="card stack"><h2 className="section-title">{t("Quiz history","سجل الاختبارات")}</h2>
        {change!==null && <p className="muted">{t("Score change across these recorded attempts","تغيّر النتيجة عبر هذه المحاولات المسجّلة")} · {change>0?"+":""}{change} {t("percentage points","نقطة مئوية")}</p>}
        {data?.attempts.length ? <ul className="plain-list">{data.attempts.map((attempt)=><li key={attempt.id} className="record">
          <Link href={"/practice?" + new URLSearchParams({ course: attempt.quiz.courseId, attempt: attempt.id })}>{attempt.quiz.title} · {dateText(attempt.createdAt,lang)}</Link>
          <span>{attempt.score} / {attempt.total}</span>
        </li>)}</ul> : <p className="muted">{t("No saved course quiz attempts yet.","لا توجد محاولات اختبارات دورة محفوظة بعد.")}</p>}
      </section>
      <section className="card stack"><h2 className="section-title">{t("Sample attempts on this device","محاولات النموذج على هذا الجهاز")}</h2>
        {sample.length ? <ul className="plain-list">{sample.slice(0,5).map((attempt)=><li key={attempt.at} className="record"><time dateTime={attempt.at}>{dateText(attempt.at,lang)}</time><span>{attempt.correct} / {attempt.total}</span></li>)}</ul> : <Link href="/practice?sample=1" className="text-link">{t("Take the prepared sample quiz","ابدأ الاختبار النموذجي المُعدّ")}</Link>}
      </section>
    </div>
  </div>;
}
