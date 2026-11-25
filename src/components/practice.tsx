"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { sourceHref } from "./study/client";
import { AiStatus, useAiStatus } from "./study/AiStatus";
import { useDashboard } from "./workspace";
import { useStudySession } from "@/lib/session";
import { api, jsonBody } from "@/lib/http";
import { statusFromError } from "@/lib/ai-status";
import { tr, type Language } from "@/lib/locale";
import { markLearningAction } from "@/lib/learning-actions";
import { readStudyDraft, studyRequestKey, writeStudyDraft } from "@/lib/study-drafts";
import { gradePreparedQuiz, sampleCourseTitle, sampleQuiz, sampleResultsKey, type SampleAttempt } from "@/lib/sample";

interface Question { id: string; prompt: string; type: "MCQ"|"TRUE_FALSE"|"SHORT"; options: readonly string[]; }
interface Quiz { id: string; title: string; questions: Question[]; }
interface Feedback {
  questionId: string;
  correct: boolean | null;
  reviewRequired: boolean;
  explanation: string;
  ideal: string;
  given?: string;
  sourceIds: string[];
  correctConcepts?: string[];
  missingConcepts?: string[];
  incorrectStatements?: string[];
  sources?: { id: string; documentId: string; page: number; title: string }[];
}
interface SavedResult { attempt: { id: string; quizId: string; score: number; total: number }; results: Feedback[]; }

function rememberQuiz(course: string, quiz: string, attempt?: string) {
  const query = new URLSearchParams({ course, quiz });
  if (attempt) query.set("attempt", attempt);
  window.history.replaceState(null, "", "/practice?" + query);
}

function readQuizAnswers(id: string): Record<string, string> {
  try { return JSON.parse(readStudyDraft("quiz:" + id) || "{}"); }
  catch { return {}; }
}

function QuestionInput({ question, index, value, onChange, lang, disabled }: {
  question: Question; index: number; value: string; onChange: (value: string)=>void; lang: Language; disabled: boolean;
}) {
  return <fieldset className="card stack quiz-question" disabled={disabled}>
    <legend>{index+1}. {question.prompt}</legend>
    {question.type === "SHORT" ? <label className="field">{tr(lang,"Your answer","إجابتك")}<textarea required maxLength={2000} rows={2} value={value} dir="auto" onChange={(event)=>onChange(event.target.value)} /></label> :
      question.options.map((option)=><label className="row quiz-option" key={option}>
        <input required type="radio" name={question.id} value={option} checked={value===option} onChange={()=>onChange(option)} /><span>{option}</span>
      </label>)}
  </fieldset>;
}

function PreparedQuiz({ lang }: { lang: Language }) {
  const t = (en: string, ar: string) => tr(lang,en,ar);
  const [answers, setAnswers] = useState<Record<string,string>>({});
  const [results, setResults] = useState<ReturnType<typeof gradePreparedQuiz> | null>(null);
  const questions = sampleQuiz(lang);
  function grade(event: FormEvent) {
    event.preventDefault();
    if (results) return;
    const reviewed = gradePreparedQuiz(lang,answers);
    const record = { at: new Date().toISOString(), correct: reviewed.filter((item)=>item.correct).length, total: reviewed.length };
    setResults(reviewed);
    markLearningAction("sample-quiz");
    try {
      const previous = JSON.parse(localStorage.getItem(sampleResultsKey) || "[]") as SampleAttempt[];
      localStorage.setItem(sampleResultsKey, JSON.stringify([record,...previous].slice(0,20)));
    } catch { /* Results are still visible for the attempt. */ }
  }
  return <section className="stack" aria-labelledby="prepared-heading">
    <div><span className="badge">{t("Prepared sample","نموذج مُعد مسبقاً")}</span><h2 className="section-title" id="prepared-heading">{sampleCourseTitle(lang)}</h2></div>
    <p className="muted">{t("Three fixed questions with source explanations. Your sample result is saved on this device.","ثلاثة أسئلة ثابتة مشروحة بالمصادر. تُحفظ نتيجتك النموذجية على هذا الجهاز.")}</p>
    <form className="stack quiz-list" onSubmit={grade}>
      {questions.map((question,index)=><QuestionInput key={question.id} question={question} index={index} value={answers[question.id] || ""} onChange={(text)=>setAnswers({...answers,[question.id]:text})} lang={lang} disabled={!!results} />)}
      <div className="row">{!results && <Button type="submit">{t("Check answers","تحقّق من الإجابات")}</Button>}
      {results && <><Button type="button" variant="secondary" onClick={()=>{setResults(null);setAnswers({});}}>{t("Try again","حاول مرة أخرى")}</Button><Link className="text-link" href="/progress">{t("View progress","عرض التقدّم")}</Link></>}</div>
    </form>
    {results && <section className="card stack" aria-live="polite">
      <h3><b>{t("Sample result","نتيجة النموذج")} · {results.filter((result)=>result.correct).length} / {results.length}</b></h3>
      {results.map((item)=><div key={item.id} className="stack">
        <b className={!item.correct ? "error-line" : undefined}>{item.correct ? t("Correct","صحيح") : t("Review this answer","راجع هذه الإجابة")}</b>
        <p>{item.explanation}</p><Link className="text-link" href={"/courses/sample#"+item.source}>{t("Read the source","اقرأ المصدر")}</Link>
      </div>)}
    </section>}
  </section>;
}

export function Practice({ lang, courseId, topicId, attemptId, quizId, sample }: { lang: Language; courseId?: string; topicId?: string; attemptId?: string; quizId?: string; sample: boolean }) {
  const t = (en: string, ar: string) => tr(lang,en,ar);
  const { data } = useDashboard();
  const { ensureGuest, requestInit, preferences, personalKey } = useStudySession();
  const [mode, setMode] = useState<"sample"|"course">(sample ? "sample" : "course");
  const { status: aiStatus, setStatus: setAiStatus } = useAiStatus("quiz", mode === "course", Boolean(personalKey));
  const [selected, setSelected] = useState(courseId || "");
  const [difficulty, setDifficulty] = useState("medium");
  const [type, setType] = useState("MIXED");
  const [quiz, setQuiz] = useState<Quiz|null>(null);
  const [answers, setAnswers] = useState<Record<string,string>>({});
  const [feedback, setFeedback] = useState<Feedback[]|null>(null);
  const [score, setScore] = useState<{score:number;total:number}|null>(null);
  const [loadingSaved, setLoadingSaved] = useState(Boolean(attemptId || quizId));
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const quizSettings = useRef<HTMLDetailsElement>(null);
  const quizHeading = useRef<HTMLHeadingElement>(null);
  const courseChoices = (data?.courses || []).map(({id,title})=>({ value:id,label:title }));
  const course = selected || courseChoices[0]?.value || "";

  useEffect(() => {
    if (!attemptId && !quizId) return;
    const controller = new AbortController();
    const request = { signal: controller.signal, cache: "no-store" as const };
    const load = attemptId
      ? api<SavedResult>("/api/workspace/quiz-attempts/" + encodeURIComponent(attemptId), request).then((result) => {
        if (!controller.signal.aborted) { setFeedback(result.results); setScore(result.attempt); }
      })
      : api<{ quiz: Quiz }>("/api/workspace/quizzes/" + encodeURIComponent(quizId!), request).then(({ quiz: saved }) => {
        if (!controller.signal.aborted) { setQuiz(saved); setAnswers(readQuizAnswers(saved.id)); }
      });
    void load.catch(() => {
      if (!controller.signal.aborted) setError(tr(lang, "Could not open the saved quiz. Check your quiz history.", "تعذّر فتح الاختبار المحفوظ. راجع سجل الاختبارات."));
    }).finally(() => { if (!controller.signal.aborted) setLoadingSaved(false); });
    return () => controller.abort();
  }, [attemptId, quizId, lang]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(""); setBusy(true);
    try {
      await ensureGuest();
      const payload = {
        courseId:course, ...(topicId && course === courseId ? {topicId} : {}), topic:form.get("topic") || undefined,
        difficulty,type,language:lang,count:Number(form.get("count")), model:preferences.model,
      };
      const key = await studyRequestKey("request:quiz:" + course, JSON.stringify(payload));
      const options = jsonBody(payload);
      const headers = new Headers(options.headers);
      headers.set("Idempotency-Key", key);
      const result = await api<{quiz:Quiz}>("/api/learning/quiz-generation", requestInit({ ...options, headers }));
      writeStudyDraft("request:quiz:" + course, "");
      setQuiz(result.quiz); setAnswers({}); setFeedback(null); setScore(null);
      rememberQuiz(course, result.quiz.id);
      setAiStatus({ state: "available" });
      requestAnimationFrame(() => quizHeading.current?.focus());
    } catch (err) {
      const status = statusFromError(err);
      if (status) setAiStatus(status);
      setError(err instanceof Error ? err.message : t("Quiz generation failed.","تعذّر إنشاء الاختبار."));
    }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!quiz) return;
    setError(""); setBusy(true);
    try {
      const submitted = quiz.questions.map(({ id }) => ({ questionId: id, answer: answers[id] }));
      const submissionKey = await studyRequestKey("request:submit:" + quiz.id, JSON.stringify(submitted));
      const result = await api<SavedResult>("/api/workspace/quizzes/" + encodeURIComponent(quiz.id) + "/attempts", jsonBody({ submissionKey, answers: submitted }));
      setFeedback(result.results); setScore(result.attempt);
      writeStudyDraft("request:submit:" + quiz.id, "");
      writeStudyDraft("quiz:" + quiz.id, "");
      rememberQuiz(course, quiz.id, result.attempt.id);
    } catch (err) { setError(err instanceof Error ? err.message : t("Could not save the attempt.","تعذّر حفظ المحاولة.")); }
    finally { setBusy(false); }
  }
  function retry() {
    if (!quiz) return;
    setAnswers({}); setFeedback(null); setScore(null); setError("");
    writeStudyDraft("quiz:" + quiz.id, "");
    rememberQuiz(course, quiz.id);
    requestAnimationFrame(() => quizHeading.current?.focus());
  }
  return <div className="page-width content-page tight stack">
    <h1 className="page-title">{t("Practice questions","أسئلة التدريب")}</h1>
    <div className="row" aria-label={t("Practice options","خيارات التدريب")}>
      <Button variant={mode==="course"?"primary":"secondary"} aria-pressed={mode==="course"} onClick={()=>setMode("course")}>{t("Quiz my course","اختبرني في دورتي")}</Button>
      <Button variant={mode==="sample"?"primary":"quiet"} aria-pressed={mode==="sample"} onClick={()=>setMode("sample")}>{t("Example quiz","اختبار نموذجي")}</Button>
    </div>
    {mode==="sample" ? <PreparedQuiz lang={lang} /> : <>
      <form className="card stack" onSubmit={generate} onInvalid={() => { if (quizSettings.current) quizSettings.current.open = true; }}>
        <h2 className="section-title">{t("Quick Quiz","اختبار سريع")}</h2>
        <p className="muted">{t("Start with three mixed questions from your course sources.","ابدأ بثلاثة أسئلة متنوّعة من مصادر دورتك.")}</p>
        <AiStatus status={aiStatus} lang={lang} sampleHref="/practice?sample=1" />
        {!courseChoices.length && <Link href="/study" className="text-link">{t("Add a PDF to start course practice", "أضف ملف PDF لبدء التدريب على الدورة")}</Link>}
        {!!courseChoices.length && <Combobox label={t("Course","الدورة")} value={course} options={courseChoices} onChange={setSelected} />}
        <details className="study-disclosure" ref={quizSettings}><summary>{t("Quiz options","خيارات الاختبار")}</summary>
          <div className="stack disclosure-body">
            <label className="field">{t("Topic (optional)","الموضوع (اختياري)")}<input name="topic" maxLength={160} dir="auto" /></label>
            <div className="grid-2">
              <Combobox label={t("Difficulty","الصعوبة")} value={difficulty} onChange={setDifficulty} options={[{value:"easy",label:t("Easy","سهل")},{value:"medium",label:t("Medium","متوسط")},{value:"hard",label:t("Hard","صعب")}]} />
              <Combobox label={t("Question type","نوع السؤال")} value={type} onChange={setType} options={[{value:"MIXED",label:t("Mixed","متنوع")},{value:"MCQ",label:t("Multiple choice","اختيار من متعدد")},{value:"TRUE_FALSE",label:t("True or false","صح أو خطأ")},{value:"SHORT",label:t("Short answer","إجابة قصيرة")}]} />
            </div>
            <label className="field">{t("Number of questions","عدد الأسئلة")}<input name="count" type="number" min={1} max={10} defaultValue={3} required /></label>
          </div>
        </details>
        <div className="row"><Button type="submit" disabled={busy||loadingSaved||!course}>{busy ? t("Working…","جارٍ التنفيذ…") : t("Start Quick Quiz","ابدأ اختباراً سريعاً")}</Button></div>
      </form>
      {loadingSaved && <p role="status" className="muted">{t("Opening saved quiz…", "جارٍ فتح الاختبار المحفوظ…")}</p>}
      {quiz && <form className="stack" onSubmit={submit}>
        <h2 className="section-title" tabIndex={-1} ref={quizHeading}>{quiz.title}</h2>
        {quiz.questions.map((question,index)=><QuestionInput key={question.id} question={question} index={index} value={answers[question.id]||""} onChange={(value) => {
          const next = { ...answers, [question.id]: value };
          setAnswers(next); writeStudyDraft("quiz:" + quiz.id, JSON.stringify(next));
        }} lang={lang} disabled={!!feedback} />)}
        {!feedback && <div className="row"><Button type="submit" disabled={busy}>{t("Save attempt and review","احفظ المحاولة وراجعها")}</Button></div>}
      </form>}
      {error && <p role="alert" className="error-line">{error}</p>}
      {feedback && <section className="card stack" aria-live="polite">
        <h2 className="section-title">{t("Feedback","الملاحظات")}{score && " · "+score.score+" / "+score.total}</h2>
        {feedback.map((item,index)=><article className="stack" key={item.questionId}>
          <b>{index+1}. {item.reviewRequired ? t("Review required","تحتاج إلى مراجعة") : item.correct ? t("Correct","صحيح") : t("Review this answer","راجع الإجابة")}</b>
          {item.given && <p className="muted">{t("Your answer", "إجابتك")} · {item.given}</p>}
          <p>{item.explanation}</p><p className="muted">{t("Expected answer","الإجابة المتوقعة")} · {item.ideal}</p>
          {item.correctConcepts?.length ? <p>{t("Correct concepts","المفاهيم الصحيحة")} · {item.correctConcepts.join(", ")}</p> : null}
          {item.missingConcepts?.length ? <p>{t("Missing concepts","المفاهيم الناقصة")} · {item.missingConcepts.join(", ")}</p> : null}
          {item.incorrectStatements?.length ? <p>{t("Incorrect statements","عبارات غير صحيحة")} · {item.incorrectStatements.join(", ")}</p> : null}
          {item.sources?.map((source)=><Link className="text-link" key={source.id} href={sourceHref(source)}>{source.title || t("Source","المصدر")} · {source.page}</Link>)}
        </article>)}
        {feedback.some(({ correct, reviewRequired }) => correct !== true || reviewRequired) && <p className="muted">{t("Review the cited pages before trying these questions again.","راجع الصفحات المشار إليها قبل تجربة هذه الأسئلة مجدداً.")}</p>}
        <div className="row">
          {quiz && <Button type="button" variant="secondary" onClick={retry}>{t("Try these questions again", "جرّب هذه الأسئلة مجدداً")}</Button>}
          <Link className="text-link" href="/progress">{t("View saved progress","عرض التقدّم المحفوظ")}</Link>
        </div>
      </section>}
    </>}
  </div>;
}
