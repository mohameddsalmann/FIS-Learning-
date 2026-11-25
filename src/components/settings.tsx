"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import type { AiCatalog, AiDiagnostics, AiStatusResponse } from "@/lib/ai-status";
import { useStudySession, type AiPreferences } from "@/lib/session";
import { api } from "@/lib/http";
import { tr, type Language } from "@/lib/locale";
import { sampleResultsKey } from "@/lib/sample";
import { isChatMode, teachingStyle, teachingStyles } from "@/lib/teaching-modes";
import { clearStudyDrafts } from "@/lib/study-drafts";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { AiStatus } from "./study/AiStatus";

type Theme = "light" | "dark" | "system";
const keyPattern = /^sk-or-v1-[a-f0-9]{64}$/i;

function ProviderDiagnostics({ diagnostics, lang }: { diagnostics?: AiDiagnostics | null; lang: Language }) {
  const t = (en: string, ar: string) => tr(lang, en, ar);
  const locale = lang === "ar" ? "ar-EG" : "en-GB";
  const time = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  const number = (value: number) => value.toLocaleString(locale);
  const limitLabels: Record<string, string> = {
    chat: t("Study questions today", "أسئلة الدراسة اليوم"), quiz: t("Quizzes today", "الاختبارات اليوم"), speech: t("Read-aloud requests today", "طلبات القراءة الصوتية اليوم"),
    upload: t("Uploads today", "عمليات الرفع اليوم"), workspace: t("Shared FIS provider attempts today", "محاولات FIS المشتركة اليوم"),
    actorDaily: t("Your provider attempts today", "محاولاتك مع المزوّد اليوم"), actorMinute: t("Your provider attempts this minute", "محاولاتك مع المزوّد هذه الدقيقة"),
    openrouter: t("Shared OpenRouter budget today", "حصة OpenRouter المشتركة اليوم"), openrouterMinute: t("Shared OpenRouter budget this minute", "حصة OpenRouter المشتركة هذه الدقيقة"),
  };
  const actionLabels: Record<string, string> = { chat: t("Study question", "سؤال دراسي"), quiz: t("Quiz", "اختبار"), speech: t("Read aloud", "قراءة صوتية"), upload: t("Upload", "رفع ملف") };
  const scopes = { pool: t("Shared provider pool", "حصة مزوّد مشتركة"), model: t("Model", "نموذج"), provider: t("Provider account", "حساب المزوّد") };
  return <details className="study-disclosure">
    <summary>{t("AI usage and diagnostics", "استخدام الذكاء الاصطناعي والتشخيص")}</summary>
    <div className="stack disclosure-body">
      {diagnostics === undefined ? <p>{t("Start a session to see your AI usage.", "ابدأ جلسة لعرض استخدامك للذكاء الاصطناعي.")}</p>
        : diagnostics === null ? <p>{t("Usage details are temporarily unavailable.", "تفاصيل الاستخدام غير متاحة مؤقتًا.")}</p> : <>
          <dl className="plain-list">
            <div className="record"><dt>{t("Last successful route", "آخر مسار ناجح")}</dt><dd>{diagnostics.lastRoute ? <bdi>{diagnostics.lastRoute.provider} · {diagnostics.lastRoute.model}</bdi> : "—"}</dd></div>
            {diagnostics.limits.map(({ kind, remaining, maximum }) => <div className="record" key={kind}>
              <dt>{limitLabels[kind] ?? kind}</dt><dd>{t(`${number(remaining)} of ${number(maximum)} remaining`, `متبقّي ${number(remaining)} من ${number(maximum)}`)}</dd>
            </div>)}
          </dl>
          {!!diagnostics.actions.length && <div>
            <h3>{t("Provider attempts per recent action", "محاولات المزوّد لكل إجراء حديث")}</h3>
            <ul className="plain-list">{diagnostics.actions.map(({ kind, attempts, at }, index) => <li className="record" key={at + index}>
              <span>{actionLabels[kind] ?? kind} · <time dateTime={at}>{time(at)}</time></span><span>{number(attempts)}</span>
            </li>)}</ul>
          </div>}
          {!!diagnostics.providers.length && <div>
            <h3>{t("Recent provider attempts", "محاولات المزوّد الحديثة")}</h3>
            <ul className="plain-list">{diagnostics.providers.map(({ provider, model, status, category, scope, retryAt, remainingRequests, at }, index) => <li className="record" key={at + index}>
              <bdi>{provider} · {model}</bdi><span><bdi>{(category ?? status).replaceAll("_", " ")}</bdi>
                {scope && <> · {scopes[scope]}</>}
                {retryAt && <> · {t("Retry after", "أعد المحاولة بعد")} <time dateTime={retryAt}>{time(retryAt)}</time></>}
                {remainingRequests !== null && <> · {t("Provider reported remaining", "المتبقّي حسب إفادة المزوّد")} {number(remainingRequests)}</>}
              </span>
            </li>)}</ul>
          </div>}
        </>}
    </div>
  </details>;
}

function preferenceCookie(name: string, value: string) {
  document.cookie = name+"="+encodeURIComponent(value)+"; path=/; max-age=31536000; samesite=lax"+(location.protocol==="https:" ? "; secure" : "");
}

export function Settings({ lang, theme }: { lang: Language; theme: Theme }) {
  const t = (en: string, ar: string) => tr(lang,en,ar);
  const { ensureGuest, personalKey, setPersonalKey, preferences, setPreferences } = useStudySession();
  const router = useRouter();
  const { data:session, refetch } = authClient.useSession();
  const [catalog,setCatalog] = useState<AiCatalog|null>(null);
  const [usageSnapshot, setUsage] = useState<{ userId?: string; result: AiStatusResponse }>();
  const [catalogError,setCatalogError] = useState(false);
  const [advanced,setAdvanced] = useState(false);
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [accountMode, setAccountMode] = useState<"signup"|"signin">("signup");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const personal = Boolean(personalKey);
  const sessionUserId = session?.user.id;
  const usage = usageSnapshot?.userId === sessionUserId ? usageSnapshot?.result : undefined;

  useEffect(() => {
    if (!advanced) return;
    const controller = new AbortController();
    void api<AiStatusResponse>("/api/learning/status?diagnostics=1" + (personal ? "&personal=1" : ""), { signal: controller.signal, cache: "no-store" }).then((result) => {
      if (!controller.signal.aborted) { setUsage({ userId: sessionUserId, result }); setCatalog(result.catalog ?? null); setCatalogError(!result.catalog); }
    }).catch(()=>{if(!controller.signal.aborted) setCatalogError(true);});
    return ()=>controller.abort();
  },[advanced, personal, sessionUserId]);
  const report = (err: unknown) => setError(err instanceof Error ? err.message : t("Request failed.","فشل الطلب."));
  const opt = (value: string,label: string,detail?: string) => ({value,label,detail});
  const pref = <K extends keyof AiPreferences>(name: K, value: AiPreferences[K]) => setPreferences({...preferences,[name]:value});
  const auto = opt("",t("Auto — Best available free model","تلقائي — أفضل نموذج مجاني متاح"));
  const list = (kind: string) => [auto,...(catalog?.models || []).filter((model)=>model.kind===kind && (!personalKey || model.gateway === "openrouter")).map((model)=>
    opt(model.id,model.name,[model.provider,model.cost === "paid" ? t("Paid, manual only", "مدفوع، اختيار يدوي فقط") : null,model.detail].filter(Boolean).join(" · ")))];
  const providerStates: Record<string, string> = {
    available: t("Available", "متاح"), degraded: t("Limited", "محدود"), unavailable: t("Unavailable", "غير متاح"),
    not_configured: t("Setup required", "يتطلب الإعداد"), disabled: t("Disabled", "معطّل"),
  };

  function usePersonalKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const key = String(new FormData(form).get("key") || "").trim();
    if (!keyPattern.test(key)) {
      setError(t("Enter a valid OpenRouter API key format.", "أدخل مفتاح OpenRouter بالتنسيق الصحيح."));
      return;
    }
    if (preferences.model && !catalog?.models.some((model) => model.id === preferences.model && model.gateway === "openrouter")) {
      pref("model", undefined);
    }
    setPersonalKey(key);
    form.reset();
    setError("");
    setNotice(t("Personal key is active for this tab.", "المفتاح الشخصي مفعّل في هذه العلامة فقط."));
  }

  async function account(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email")), password = String(fields.get("password"));
    setError(""); setNotice(""); setBusy(true);
    try {
      const result = accountMode==="signup" ? await authClient.signUp.email({ name:String(fields.get("name")),email,password })
        : await authClient.signIn.email({email,password});
      if (result.error) throw new Error(result.error.message || t("Could not sign in.","تعذّر تسجيل الدخول."));
      await refetch(); router.refresh();
      setNotice(t("Your account is active.","حسابك مفعّل."));
    } catch (err) { report(err); }
    finally { setBusy(false); }
  }

  async function exportData() {
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/workspace/export",{cache:"no-store"});
      if (!response.ok) throw new Error(t("Sign in to export your saved workspace.","سجّل الدخول لتصدير مساحة عملك المحفوظة."));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href=url; link.download="fis-learning-export.json"; link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch (err) { report(err); }
    finally { setBusy(false); }
  }

  async function removeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setBusy(true);
    try {
      const confirmation = new FormData(event.currentTarget).get("confirmation");
      await api("/api/workspace/account",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmation})});
      await authClient.signOut();
      clearStudyDrafts();
      setPersonalKey(""); await refetch();
      deleteDialog.current?.close(); router.refresh();
      setNotice(t("Your saved workspace was deleted.","حُذفت مساحة عملك المحفوظة."));
    } catch (err) { deleteDialog.current?.close(); report(err); }
    finally { setBusy(false); }
  }

  return <div className="page-width content-page tight stack">
    <h1 className="page-title">{t("Settings","الإعدادات")}</h1>
    <section className="card stack">
      <h2 className="section-title">{t("Study preferences","تفضيلات الدراسة")}</h2>
      <div className="grid-2">
        <Combobox label={t("Language","اللغة")} value={lang} options={[opt("en","English"),opt("ar","العربية")]} onChange={(value)=>{preferenceCookie("fis_language",value);router.refresh();}} />
        <Combobox label={t("Theme","المظهر")} value={theme} options={[opt("system",t("Use device setting","إعداد الجهاز")),opt("light",t("Light","فاتح")),opt("dark",t("Dark","داكن"))]} onChange={(value)=>{document.documentElement.dataset.theme=value;preferenceCookie("fis_theme",value);router.refresh();}} />
      </div>
      <Combobox label={t("Tutor style","أسلوب المعلّم")} value={teachingStyle(preferences.mode)}
        options={teachingStyles.map(({value, en, ar}) => opt(value, t(en, ar)))}
        onChange={(value)=>{ if (isChatMode(value)) pref("mode", value); }} noOptions={t("No matches.","لا توجد نتائج.")} />
    </section>
    <section className="card stack" id="privacy">
      <h2 className="section-title">{t("Account and privacy","الحساب والخصوصية")}</h2>
      <p className="muted">{t("Original course documents stay private. A tutor request sends the question, attachments and relevant excerpts to the selected AI provider. Free-tier providers may use submitted content to improve their products. Keep sensitive personal information out of prompts and media.","تظل مستندات الدورة الأصلية خاصة. يرسل طلب المعلّم السؤال والمرفقات والمقاطع ذات الصلة إلى مزوّد الذكاء الاصطناعي المحدد. قد يستخدم مزوّدو الخدمة المجانية المحتوى المُرسل لتحسين منتجاتهم. تجنّب المعلومات الشخصية الحساسة في الأسئلة والوسائط.")}</p>
      {session?.user && <p className="status-box">{("isAnonymous" in session.user && session.user.isAnonymous) ? t("Guest session is active on this browser.","جلسة الضيف نشطة على هذا المتصفح.") : session.user.email}</p>}
      {(!session?.user || ("isAnonymous" in session.user && session.user.isAnonymous)) && <>
        {!session?.user && <div className="row"><Button variant="secondary" disabled={busy} onClick={async()=>{setError("");try{await ensureGuest();await refetch();}catch(err){report(err);}}}>{t("Start guest session","ابدأ جلسة ضيف")}</Button><Link className="text-link" href="/courses/sample">{t("Browse the sample","تصفح النموذج")}</Link></div>}
        <form className="stack" onSubmit={account}>
          <div className="row"><Button type="button" variant={accountMode==="signup"?"primary":"secondary"} aria-pressed={accountMode==="signup"} onClick={()=>setAccountMode("signup")}>{t("Create account","إنشاء حساب")}</Button><Button type="button" variant={accountMode==="signin"?"primary":"secondary"} aria-pressed={accountMode==="signin"} onClick={()=>setAccountMode("signin")}>{t("Sign in","تسجيل الدخول")}</Button></div>
          {accountMode==="signup" && <label className="field">{t("Name","الاسم")}<input name="name" required maxLength={100} autoComplete="name" /></label>}
          <label className="field">{t("Email","البريد الإلكتروني")}<input name="email" type="email" required autoComplete="email" dir="ltr" /></label>
          <label className="field">{t("Password","كلمة المرور")}<input name="password" type="password" minLength={accountMode==="signup" ? 12 : undefined} maxLength={128} required autoComplete={accountMode==="signup"?"new-password":"current-password"} /></label>
          <div><Button type="submit" disabled={busy}>{t("Continue","متابعة")}</Button></div>
        </form>
      </>}
      {session?.user && <div className="row">
        <Button variant="secondary" disabled={busy} onClick={()=>void exportData()}>{t("Export workspace data","تصدير بيانات مساحة العمل")}</Button>
        <Button variant="quiet" disabled={busy} onClick={()=>deleteDialog.current?.showModal()}>{t("Delete workspace","حذف مساحة العمل")}</Button>
        <Button variant="quiet" onClick={async()=>{await authClient.signOut();clearStudyDrafts();setPersonalKey("");await refetch();router.refresh();}}>{t("Sign out","تسجيل الخروج")}</Button>
      </div>}
      <div><Button variant="quiet" onClick={()=>{localStorage.removeItem(sampleResultsKey);setNotice(t("Sample attempts cleared on this device.","مُسحت محاولات النموذج من هذا الجهاز."));}}>{t("Clear local sample attempts","امسح محاولات النموذج المحلية")}</Button></div>
    </section>
    <details className="card stack" onToggle={(event)=>setAdvanced(event.currentTarget.open)}>
      <summary><b>{t("Advanced AI settings","إعدادات الذكاء الاصطناعي المتقدمة")}</b></summary>
      {advanced && <div className="stack mt-4">
        <p role="status" className="muted">{catalogError ? t("Could not load the provider catalog.","تعذّر تحميل كتالوج المزوّد.")
          : catalog?.status==="available" ? t("Free model catalog is reachable.","كتالوج النماذج المجانية متاح.")
          : catalog?.status==="degraded" ? t("Provider status is degraded. Some free requests may fail.","حالة المزوّد متدهورة وقد تفشل بعض الطلبات المجانية.")
          : catalog?.status==="not_configured" ? t("A shared provider key is not configured.","لم يُضبط مفتاح مزوّد مشترك.")
          : catalog?.status==="unavailable" ? t("No eligible free routes are available.","لا توجد مسارات مجانية مؤهلة.")
          : t("Checking free models…","جارٍ فحص النماذج المجانية…")}</p>
        {catalog?.providers && <dl className="plain-list">
          {([ ["gemini", "Google Gemini"], ["groq", "GroqCloud"], ["openrouter", "OpenRouter"], ["xai", "xAI / Grok"] ] as const).map(([id, name]) =>
            <div className="record" key={id}><dt>{name}</dt><dd>{providerStates[catalog.providers?.[id]?.status ?? ""] ?? t("Unknown", "غير معروف")}</dd></div>)}
        </dl>}
        {usage && <ul className="plain-list">{([ ["chat", t("Tutor", "المعلّم")], ["quiz", t("Quick Quiz", "الاختبار السريع")], ["speech", t("Read aloud", "القراءة الصوتية")] ] as const).map(([kind, label]) =>
          <li className="record" key={kind}><span>{label}</span><AiStatus status={usage.features[kind]} lang={lang} /></li>)}
        </ul>}
        {usage && <ProviderDiagnostics diagnostics={sessionUserId ? usage.diagnostics : undefined} lang={lang} />}
        <Combobox label={t("Chat model","نموذج المحادثة")} value={preferences.model || ""} options={list("chat")} onChange={(value)=>pref("model",value||undefined)} />
        <Combobox label={t("Read-aloud model","نموذج القراءة الصوتية")} value={preferences.voiceModel || ""} options={list("speech")} onChange={(value)=>pref("voiceModel",value||undefined)} />
        <label className="field">{t("Temperature","معامل التنوّع")} · {preferences.temperature ?? .7}<input type="range" min={0} max={2} step={.1} value={preferences.temperature ?? .7} onChange={(event)=>pref("temperature",Number(event.target.value))} /></label>
        <label className="field">{t("Maximum response tokens","الحد الأقصى لرموز الإجابة")} · {preferences.maxTokens ?? 2048}<input type="range" min={256} max={4096} step={256} value={preferences.maxTokens ?? 2048} onChange={(event)=>pref("maxTokens",Number(event.target.value))} /></label>
        <form className="stack" onSubmit={usePersonalKey}>
          <label className="field">{t("Personal OpenRouter key for this tab","مفتاح OpenRouter شخصي لهذه العلامة")}<input name="key" type="password" autoComplete="off" required dir="ltr" placeholder="sk-or-v1-…" /><small>{t("Uses only eligible free OpenRouter routes. Cleared on refresh or sign-out.","يستخدم مسارات OpenRouter المجانية المؤهلة فقط. يُمسح بعد التحديث أو تسجيل الخروج.")}</small></label>
          <div className="row"><Button type="submit" variant="secondary">{t("Use personal key","استخدم المفتاح الشخصي")}</Button>{personalKey && <Button type="button" variant="quiet" onClick={()=>{setPersonalKey("");setNotice(t("Personal key cleared.","مُسح المفتاح الشخصي."));}}>{t("Clear personal key","امسح المفتاح الشخصي")}</Button>}</div>
        </form>
      </div>}
    </details>
    {notice && <p className="status-box" role="status">{notice}</p>}{error && <p className="error-line" role="alert">{error}</p>}
    <dialog ref={deleteDialog} className="card fis-dialog" aria-labelledby="erase-title">
      <form className="stack" onSubmit={removeAccount}><h2 className="section-title" id="erase-title">{t("Delete saved workspace","احذف مساحة العمل المحفوظة")}</h2>
        <p>{t("This removes your courses, files and learning history. Export your data first if you want to keep it.","يحذف هذا دوراتك وملفاتك وسجل تعلّمك. صدّر بياناتك أولاً إذا أردت الاحتفاظ بها.")}</p>
        <label className="field">{t("Type DELETE to confirm","اكتب DELETE للتأكيد")}<input name="confirmation" pattern="DELETE" required autoComplete="off" dir="ltr" /></label>
        <div className="row"><Button type="submit" disabled={busy}>{t("Delete permanently","احذف نهائياً")}</Button><Button type="button" variant="secondary" disabled={busy} onClick={()=>deleteDialog.current?.close()}>{t("Cancel","إلغاء")}</Button></div>
      </form>
    </dialog>
  </div>;
}
