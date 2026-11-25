"use client";

import { ArrowUp, BookOpen, ChartNoAxesColumn, Check, CircleAlert, Copy, FileText, Mic, Paperclip, Plus, RefreshCw, Square, Volume2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Combobox } from "@/components/ui/combobox";
import { statusFromError, type AiFeatureStatus } from "@/lib/ai-status";
import { readRequestError } from "@/lib/http";
import { useStudySession } from "@/lib/session";
import { readStudyDraft, studyRequestKey, writeStudyDraft } from "@/lib/study-drafts";
import { plainTeachingAnswer, splitTeachingAnswer } from "@/lib/teaching-content";
import { contextualTutorActions, isChatMode, teachingStyle, teachingStyles, type ChatMode } from "@/lib/teaching-modes";
import {
  CHAT_FILE_TYPES, chatHistory, readChatStream, readVideoDuration, validateFiles,
  type SourceCitation, type StudyLanguage, type StudyMessage,
} from "./client";
import { Dictation } from "./Dictation";
import { AiStatus, useAiStatus } from "./AiStatus";
import { useStudyLanguage } from "./language";
import { CitationLink, TeachingReply } from "./TeachingReply";
import { StudyIllustration } from "./StudyIllustration";
import styles from "./study.module.css";
import teachingStylesCss from "./teaching.module.css";

type ActiveTurn = { question: StudyMessage; answer: string; citations: SourceCitation[] };
type PendingChat = { payload: string; files: File[]; key: string };
type PendingSpeech = { payload: string; key: string };
export interface StudyChatProps {
  courseId?: string;
  conversationId?: string;
  initialPrompt?: string;
  initialMessages?: StudyMessage[];
  language?: StudyLanguage;
  heading?: "h1" | "h2";
  suggestions?: readonly { prompt: string; label: string; source: string }[];
  onSourceOpen?: (source: SourceCitation) => void;
  onSuggestionSelected?: () => void;
}

const prompts = {
  en: ["Explain a topic", "Walk me through the steps", "Give me a hint"],
  ar: ["اشرح لي موضوعاً", "اشرح الخطوات بالتفصيل", "أعطني تلميحاً"],
};

export function StudyChat({ courseId: providedCourseId, conversationId, initialPrompt = "", initialMessages, language: preferred, heading: Heading = "h2", suggestions, onSourceOpen, onSuggestionSelected }: StudyChatProps) {
  const language = useStudyLanguage(preferred);
  const ar = language === "ar";
  const pick = (en: string, arabic: string) => ar ? arabic : en;
  const { ensureGuest, requestInit, preferences, personalKey } = useStudySession();
  const { status: aiStatus, setStatus: setAiStatus } = useAiStatus("chat", true, Boolean(personalKey));
  const [speechStatus, setSpeechStatus] = useState<AiFeatureStatus>();
  const [messages, setMessages] = useState<StudyMessage[]>(initialMessages ?? []);
  const [conversation, setConversation] = useState(conversationId);
  const [courseId, setCourseId] = useState(providedCourseId);
  const [draft, setDraft] = useState(initialPrompt);
  const [addedQuestions, setAddedQuestions] = useState(0);
  const suggestionHeading = useId();
  const [mode, setMode] = useState<ChatMode>();
  const [files, setFiles] = useState<File[]>([]);
  const [validating, setValidating] = useState(false);
  const [current, setCurrent] = useState<ActiveTurn | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(Boolean(conversationId && !initialMessages));
  const [historyError, setHistoryError] = useState("");
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string>();
  const [speaking, setSpeaking] = useState<string>();
  const [audio, setAudio] = useState<{ id: string; url: string }>();
  const [dictating, setDictating] = useState(false);
  const request = useRef<AbortController | null>(null);
  const pendingChat = useRef<PendingChat | null>(null);
  const pendingSpeech = useRef<PendingSpeech | null>(null);
  const voiceRequest = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const uploader = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const sent = useRef(new Map<string, { files: File[]; mode: ChatMode }>());
  const chosenMode = mode ?? teachingStyle(preferences.mode);
  const draftKey = "chat:" + (conversationId ?? providedCourseId ?? "standalone");
  const requestKey = "request:" + draftKey;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDraft(readStudyDraft(draftKey) ?? initialPrompt));
    return () => cancelAnimationFrame(frame);
  }, [draftKey, initialPrompt]);

  function updateDraft(value: string) {
    setDraft(value);
    writeStudyDraft(draftKey, value);
  }

  useEffect(() => () => { request.current?.abort(); voiceRequest.current?.abort(); }, []);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  useEffect(() => {
    if (!conversationId || initialMessages) return;
    const controller = new AbortController();
    fetch(`/api/workspace/conversations/${encodeURIComponent(conversationId)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const payload = await response.json() as { conversation: { messages: StudyMessage[]; courseId?: string | null } };
      if (!controller.signal.aborted) {
        setMessages(payload.conversation.messages);
        if (payload.conversation.courseId !== undefined) setCourseId(payload.conversation.courseId ?? undefined);
        setLoadingHistory(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) { setHistoryError("unavailable"); setLoadingHistory(false); }
    });
    return () => controller.abort();
  }, [conversationId, historyAttempt, initialMessages]);

  useEffect(() => {
    const scroller = bottom.current?.parentElement;
    if (scroller && followLatest.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [current, messages]);

  async function authenticatedFetch(url: string, init: RequestInit) {
    let response = await fetch(url, requestInit(init));
    if (response.status === 401 && !init.signal?.aborted) {
      await ensureGuest();
      if (!init.signal?.aborted) response = await fetch(url, requestInit(init));
    }
    return response;
  }

  async function addFiles(next: File[]) {
    setError("");
    const merged = [...files, ...next];
    const problem = validateFiles(merged);
    if (problem) {
      setError({
        count: pick("Attach up to five files.", "يمكن إرفاق خمسة ملفات كحد أقصى."),
        type: pick("Use a PDF, PNG, JPEG, WebP, or MP4 file.", "استخدم ملف PDF أو PNG أو JPEG أو WebP أو MP4."),
        size: pick("Attachments must be non-empty and total 3.5 MB or less.", "يجب ألا تكون الملفات فارغة، وألا يتجاوز حجمها الإجمالي ٣٫٥ ميغابايت."),
      }[problem]);
      return;
    }
    setValidating(true);
    try {
      const durations = await Promise.all(next.filter((file) => file.type === "video/mp4").map(readVideoDuration));
      if (durations.some((duration) => duration > 60)) throw new Error("duration");
      setFiles(merged);
    } catch {
      setError(pick("Choose a playable MP4 clip up to 60 seconds.", "اختر مقطع MP4 قابلاً للتشغيل ومدته ٦٠ ثانية أو أقل."));
    } finally { setValidating(false); }
  }

  async function send(text: string, override?: ChatMode, retry?: StudyMessage) {
    if (request.current || validating || loadingHistory || historyError || (!text.trim() && (!files.length || retry))) return;
    const controller = new AbortController();
    request.current = controller;
    followLatest.current = true;
    setError("");
    setSpeechStatus(undefined);
    const composerTurn = !retry && !override;
    const prior = retry ? sent.current.get(retry.id) : undefined;
    const staged = retry ? prior?.files ?? [] : composerTurn ? files : [];
    const style = prior?.mode ?? override ?? chosenMode;
    const question = retry ?? { id: crypto.randomUUID(), role: "user" as const, content: text.trim() || pick("Help me understand the attached material.", "ساعدني في فهم المواد المرفقة."), files: staged.map((file) => file.name) };
    const preceding = retry ? messages.slice(0, messages.findIndex((message) => message.id === retry.id)) : messages;
    const turn: ActiveTurn = { question, answer: "", citations: [] };
    setCurrent({ ...turn });
    const payload = JSON.stringify({
      messages: chatHistory([...preceding, question]),
      courseId, mode: style, language, conversationId: retry ? undefined : conversation,
      model: preferences.model, temperature: preferences.temperature, maxTokens: preferences.maxTokens,
    });
    const previous = pendingChat.current;
    const sameRequest = previous?.payload === payload && previous.files.length === staged.length && previous.files.every((file, index) => file === staged[index]);
    try {
      const key = sameRequest ? previous.key : staged.length ? crypto.randomUUID() : await studyRequestKey(requestKey, payload);
      pendingChat.current = { payload, files: staged, key };
      const form = new FormData();
      if (staged.length) {
        form.set("chat", payload);
        staged.forEach((file) => form.append("attachment", file));
      }
      const response = await authenticatedFetch("/api/learning/chat", {
        method: "POST", signal: controller.signal, body: staged.length ? form : payload,
        headers: { "Idempotency-Key": key, "Accept-Language": language, ...(staged.length ? {} : { "Content-Type": "application/json" }) },
      });
      if (!response.ok || !response.body) throw await readRequestError(response, pick("The tutor is unavailable. Your draft is still here.", "المعلّم غير متاح حالياً. لا تزال مسودتك محفوظة هنا."));
      let nextConversation: string | undefined;
      await readChatStream(response.body, (event) => {
        turn.answer += event.content ?? "";
        if (typeof event.answer === "string") turn.answer = event.answer;
        if (event.citations) turn.citations = event.citations;
        if (event.conversationId) nextConversation = event.conversationId;
        setCurrent({ ...turn });
      }, language);
      if (!turn.answer.trim()) throw new Error(pick("The tutor returned an empty response. Try again.", "لم يُرجع المعلّم إجابة. حاول مجدداً."));
      if (nextConversation) setConversation(nextConversation);
      sent.current.set(question.id, { files: staged, mode: style });
      pendingChat.current = null;
      writeStudyDraft(requestKey, "");
      setAiStatus({ state: "available" });
      setMessages([...preceding, question, { id: crypto.randomUUID(), role: "assistant", content: turn.answer, citations: turn.citations }]);
      if (composerTurn) { updateDraft(""); setFiles([]); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        const status = statusFromError(failure);
        if (status) setAiStatus(status);
        setError(failure instanceof Error ? failure.message : pick("Unable to send. Try again.", "تعذّر الإرسال. حاول مجدداً."));
      }
    } finally {
      if (request.current === controller) request.current = null;
      setCurrent(null);
    }
  }

  async function listen(message: StudyMessage) {
    voiceRequest.current?.abort();
    setAudio(undefined);
    setError("");
    setSpeechStatus(undefined);
    const controller = new AbortController();
    voiceRequest.current = controller;
    setSpeaking(message.id);
    const payload = JSON.stringify({ text: plainTeachingAnswer(message.content).slice(0, 4000), model: preferences.voiceModel });
    const key = pendingSpeech.current?.payload === payload ? pendingSpeech.current.key : crypto.randomUUID();
    pendingSpeech.current = { payload, key };
    try {
      const response = await authenticatedFetch("/api/learning/speech", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Accept-Language": language, "Idempotency-Key": key }, body: payload,
      });
      if (!response.ok) throw await readRequestError(response, pick("Read-aloud is unavailable.", "القراءة الصوتية غير متاحة."));
      const blob = await response.blob();
      if (!controller.signal.aborted) {
        setAudio({ id: message.id, url: URL.createObjectURL(blob) });
        pendingSpeech.current = null;
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setSpeechStatus(statusFromError(failure));
        setError(failure instanceof Error ? failure.message : pick("Read-aloud is unavailable.", "القراءة الصوتية غير متاحة."));
      }
    } finally {
      if (voiceRequest.current === controller) { voiceRequest.current = null; setSpeaking(undefined); }
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }
  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); }
  }

  function renderMessage(message: StudyMessage, busy = false) {
    const assistant = message.role === "assistant";
    return <article key={message.id} className={assistant ? styles.answer : styles.question} aria-label={assistant ? pick("Tutor reply", "رد المعلّم") : pick("Your question", "سؤالك")}>
      <p className={styles.messageLabel}>{assistant ? <><BookOpen size={15} aria-hidden /> {pick("FIS tutor", "معلّم FIS")}</> : pick("You", "أنت")}</p>
      <div className={styles.markdown} dir="auto">
        {assistant && !busy ? <TeachingReply content={message.content} citations={message.citations} language={language} onSourceOpen={onSourceOpen}
          renderIllustration={(block) => <StudyIllustration description={block.description} prompt={block.prompt} language={language}
            fetchImage={(prompt, signal) => authenticatedFetch("/api/learning/image", {
              method: "POST", signal, body: JSON.stringify({ prompt, language }),
              headers: { "Content-Type": "application/json", "Accept-Language": language },
            })} />}
          /> : <p>{(assistant ? splitTeachingAnswer(message.content, true).markdown.replace(/\[S\d+\]/g, "") : message.content) || pick("Preparing a reply…", "جارٍ إعداد الرد…")}</p>}
      </div>
      {message.files?.length ? <ul className={styles.fileList}>{message.files.map((name, index) => <li key={`${name}-${index}`}><FileText size={14} aria-hidden /> {name}</li>)}</ul> : null}
      {message.citations?.length ? <section aria-label={pick("Sources", "المصادر")} className={styles.sources}>
        <p>{pick("Sources", "المصادر")}</p><ul>{message.citations.map((source) => <li key={source.id}>
          <CitationLink className={styles.sourceLink} source={source} onSourceOpen={onSourceOpen}><BookOpen size={14} aria-hidden /> <span>{source.title}</span><span>{pick("Page", "صفحة")} {source.page}</span></CitationLink>
        </li>)}</ul>
      </section> : null}
      {assistant && !busy && <>
        <div className={styles.actions}>
          <button type="button" className={styles.textButton} onClick={async () => {
            try { await navigator.clipboard.writeText(plainTeachingAnswer(message.content)); setCopied(message.id); }
            catch { setError(pick("Clipboard access was denied.", "تعذّر الوصول إلى الحافظة.")); }
          }}>{copied === message.id ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{copied === message.id ? pick("Copied", "تم النسخ") : pick("Copy", "نسخ")}</button>
          <button type="button" className={styles.textButton} disabled={speaking === message.id} onClick={() => void listen(message)}><Volume2 size={16} aria-hidden />{speaking === message.id ? pick("Loading audio…", "جارٍ تحميل الصوت…") : pick("Listen", "استمع")}</button>
          {message.id === messages.at(-1)?.id && messages.at(-2)?.role === "user" && <button type="button" className={styles.textButton} disabled={Boolean(current)} onClick={() => { const last = messages.at(-2); if (last) void send(last.content, undefined, last); }}><RefreshCw size={15} aria-hidden />{pick("Regenerate", "إعادة الإجابة")}</button>}
        </div>
        {audio?.id === message.id && <audio controls autoPlay aria-label={pick("Spoken tutor reply", "الرد الصوتي للمعلّم")} src={audio.url} className={styles.audio} onError={() => setError(pick("The audio could not be played.", "تعذّر تشغيل الصوت."))} />}
      </>}
    </article>;
  }

  const regenerationIndex = messages.findIndex((message) => message.id === current?.question.id);
  const shownMessages = regenerationIndex >= 0 ? messages.slice(0, regenerationIndex) : messages;
  const lastReply = messages.at(-1);
  const firstSource = lastReply?.citations?.[0];
  const asked = new Set(messages.filter(({ role }) => role === "user").map(({ content }) => content));
  const nextSuggestions = suggestions?.filter(({ prompt }) => !asked.has(prompt)).slice(0, 3) ?? [];
  function addSuggestion(prompt: string) {
    const updated = draft.includes(prompt) ? draft : [draft.trimEnd(), prompt].filter(Boolean).join("\n\n");
    if (updated.length > 16000) {
      setError(pick("Shorten your draft before adding another question.", "اختصر مسودتك قبل إضافة سؤال آخر."));
    } else if (updated !== draft) {
      updateDraft(updated);
      setAddedQuestions((count) => count + 1);
      onSuggestionSelected?.();
    }
    input.current?.focus();
  }
  function followupButton({ mode, label, prompt }: typeof contextualTutorActions[number]) {
    return <button key={mode} type="button" className={styles.secondaryButton} onClick={() => void send(pick(prompt[0], prompt[1]), mode)}>
      {mode === "visual" && <ChartNoAxesColumn size={15} aria-hidden />}{pick(label[0], label[1])}
    </button>;
  }
  return <section className={styles.chat} dir={ar ? "rtl" : "ltr"} aria-label={pick("Study chat", "محادثة الدراسة")}>
    <header className={styles.chatHeader}><BookOpen size={23} aria-hidden /><div><Heading>{pick("Study tutor", "معلّم الدراسة")}</Heading><p>{courseId ? pick("Ask about your course materials.", "اسأل عن مواد دورتك.") : pick("Ask a question or bring a study file.", "اسأل سؤالاً أو أرفق مادة للدراسة.")}</p><AiStatus status={aiStatus} lang={language} /></div></header>
    {loadingHistory && <p role="status" className={styles.hint}>{pick("Loading conversation…", "جارٍ تحميل المحادثة…")}</p>}
    {historyError && <p role="alert" className={styles.error}>{pick("This conversation could not be opened.", "تعذّر فتح هذه المحادثة.")} <button className={styles.textButton} type="button" onClick={() => { setHistoryError(""); setLoadingHistory(true); setHistoryAttempt((value) => value + 1); }}>{pick("Retry", "حاول مجدداً")}</button></p>}
    <p className={styles.srOnly} role="status">{current ? pick("Preparing a reply…", "جارٍ إعداد الرد…") : messages.at(-1)?.role === "assistant" ? pick("The tutor's reply is ready.", "رد المعلّم جاهز.") : ""}</p>
    <div className={styles.thread} data-empty={!messages.length && !current} aria-busy={Boolean(current)} aria-label={pick("Conversation", "المحادثة")} onScroll={(event) => { const target = event.currentTarget; followLatest.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100; }}>
      {!loadingHistory && !historyError && !messages.length && !current && (suggestions?.length ?
        <section className={styles.studyStarters} aria-labelledby={suggestionHeading}>
          <h3 id={suggestionHeading}>{pick("Start with your PDF", "ابدأ من ملف PDF")}</h3>
          <p>{pick("Add a question to your draft, then edit or send it.", "أضف سؤالاً إلى المسودة، ثم عدّله أو أرسله.")}</p>
          <ul className={styles.suggestionList}>
            {suggestions.map(({ prompt, label, source }) => <li key={prompt}>
              <button type="button" className={styles.suggestion} onClick={() => addSuggestion(prompt)}>
                <span dir="auto" className={styles.suggestionLabel}>{label}</span>
                <Plus size={18} aria-hidden="true" />
                <small dir="auto">{source}</small>
              </button>
            </li>)}
          </ul>
        </section> : <div className={styles.empty}>
        <p>{pick("What are we learning today?", "ماذا سنتعلّم اليوم؟")}</p>
        <div className={styles.actions}>{prompts[language].map((prompt) => <button type="button" key={prompt} className={styles.secondaryButton} onClick={() => addSuggestion(prompt + (ar ? " " : ": "))}>{prompt}</button>)}</div>
      </div>)}
      {shownMessages.map((message) => renderMessage(message))}
      {current && <>{renderMessage(current.question)}{renderMessage({ id: "streaming", role: "assistant", content: current.answer }, true)}</>}
      <div ref={bottom} />
    </div>
    {lastReply?.role === "assistant" && !current && <div aria-label={pick("Follow-up actions", "أسئلة المتابعة")}>
      <div className={styles.followups}>{contextualTutorActions.slice(0, 3).map(followupButton)}
        {firstSource && <CitationLink className={styles.secondaryButton} source={firstSource} onSourceOpen={onSourceOpen}><BookOpen size={15} aria-hidden />{pick("Show source", "عرض المصدر")}</CitationLink>}
      </div>
      <details className={teachingStylesCss.followupDetails}><summary>{pick("More ways to study", "المزيد من طرق الدراسة")}</summary>
        <div className={styles.followups}>{contextualTutorActions.slice(3).map(followupButton)}
          {courseId && <Link className={styles.secondaryButton} href={"/practice?course=" + encodeURIComponent(courseId)}>{pick("Open course practice", "افتح تدريبات الدورة")}</Link>}
        </div>
        {nextSuggestions.length > 0 && <div className={styles.followups} aria-label={pick("Suggested course questions", "أسئلة مقترحة عن الدورة")}>{nextSuggestions.map(({ prompt, label }) =>
          <button type="button" key={prompt} className={styles.secondaryButton} onClick={() => addSuggestion(prompt)}>{label}</button>)}</div>}
      </details>
    </div>}
    {error && <div className={styles.error} role="alert"><CircleAlert size={17} aria-hidden /><div><p>{error}</p><AiStatus status={speechStatus} lang={language} /></div><button aria-label={pick("Dismiss error", "إخفاء الخطأ")} type="button" className={styles.iconButton} onClick={() => setError("")}><X size={16} aria-hidden /></button></div>}
    <form onSubmit={submit} className={styles.composer} data-course-composer={courseId ? "" : undefined}>
      <p className={styles.srOnly} role="status">{addedQuestions > 0 && <span key={addedQuestions}>{pick("Question added to your draft.", "تمت إضافة السؤال إلى المسودة.")}</span>}</p>
      {files.length > 0 && <ul className={styles.fileList} aria-label={pick("Selected files", "الملفات المحدّدة")}>{files.map((file, index) => <li key={file.name + "-" + index}><FileText size={14} aria-hidden /><span>{file.name}</span>
        <button type="button" className={styles.iconButton} disabled={Boolean(current) || validating} aria-label={pick("Remove ", "أزل ") + file.name} onClick={() => setFiles(files.filter((_, ix) => ix !== index))}><X size={14} aria-hidden /></button></li>)}</ul>}
      <label className={styles.srOnly} htmlFor="study-chat-input">{pick("Message FIS", "اكتب إلى FIS")}</label>
      <textarea id="study-chat-input" ref={input} className={styles.chatInput} rows={3} dir="auto" placeholder={pick("Ask about a topic or your materials…", "اسأل عن موضوع أو عن موادك…")} value={draft}
        disabled={Boolean(current) || loadingHistory || Boolean(historyError)} maxLength={16000} onKeyDown={handleKey} onChange={(event) => updateDraft(event.target.value)} />
      <input hidden type="file" ref={uploader} aria-label={pick("Chat attachments", "مرفقات المحادثة")} accept={CHAT_FILE_TYPES.join(",")} multiple onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <div className={styles.composerFooter}>
        <div className={styles.actions}>
          <button type="button" className={styles.textButton} disabled={Boolean(current) || validating} onClick={() => uploader.current?.click()}><Paperclip size={17} aria-hidden />{validating ? pick("Checking files…", "جارٍ فحص الملفات…") : pick("Attach", "إرفاق")}</button>
          <button type="button" className={styles.textButton} disabled={Boolean(current)} onClick={() => setDictating(true)}><Mic size={17} aria-hidden />{pick("Dictate", "إملاء")}</button>
        </div>
        <div className={teachingStylesCss.mode}><Combobox label={pick("Teaching style", "أسلوب الشرح")} value={chosenMode}
          options={teachingStyles.map(({ value, en, ar }) => ({ value, label: pick(en, ar) }))}
          onChange={(value) => { if (isChatMode(value)) setMode(value); }}
          noOptions={pick("No matches.", "لا توجد نتائج.")} disabled={Boolean(current) || loadingHistory || Boolean(historyError)} /></div>
        {current ? <button type="button" onClick={() => request.current?.abort()} className={styles.secondaryButton}><Square size={16} aria-hidden />{pick("Stop", "إيقاف")}</button>
          : <button type="submit" className={styles.primaryButton} disabled={(!draft.trim() && !files.length) || validating || loadingHistory || Boolean(historyError)}><ArrowUp size={18} aria-hidden />{pick("Send", "إرسال")}</button>}
      </div>
    </form>
    <p className={styles.hint}>{pick("Review important details against the source material.", "راجع التفاصيل المهمة بالرجوع إلى المصادر.")}</p>
    {dictating && <Dictation language={language} onClose={() => setDictating(false)} onInsert={(text) => { updateDraft([draft, text].filter(Boolean).join(" ")); setDictating(false); requestAnimationFrame(() => input.current?.focus()); }} />}
  </section>;
}

export default StudyChat;
