"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "@/lib/http";
import { tr, type Language } from "@/lib/locale";
import { PdfUploadSelection, usePdfUpload } from "./study/PdfUpload";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { useDashboard, type CourseSummary } from "./workspace";

export function StudyIntake({ lang }: { lang: Language }) {
  const t = (en: string, ar: string) => tr(lang, en, ar);
  const router = useRouter();
  const { data } = useDashboard();
  const upload = usePdfUpload(lang);
  const [courseId, setCourseId] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [created, setCreated] = useState<CourseSummary>();

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("fis_pending_upload_course");
      if (pending && /^[a-zA-Z0-9_-]{1,128}$/.test(pending)) {
        sessionStorage.removeItem("fis_pending_upload_course");
        router.replace(`/courses/${encodeURIComponent(pending)}`);
      }
    } catch { /* The course remains accessible from My Courses. */ }
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = upload.file;
    if (!file || upload.busy) return;
    let target = courseId || created?.id;
    const document = await upload.submit(async (signal) => {
      if (target) return target;
      const title = courseTitle.trim() || Array.from(file.name.replace(/\.pdf$/i, "").trim()).slice(0, 54).join("") || t("Study materials", "مواد الدراسة");
      const { course } = await api<{ course: CourseSummary }>("/api/workspace/courses", {
        ...jsonBody({ title }), signal,
      });
      setCreated(course);
      target = course.id;
      return target;
    }, () => {
      try { if (target) sessionStorage.setItem("fis_pending_upload_course", target); } catch { /* Optional recovery shortcut. */ }
    });
    if (document && target) {
      try { sessionStorage.removeItem("fis_pending_upload_course"); } catch { /* Optional recovery shortcut. */ }
      router.push(`/courses/${encodeURIComponent(target)}?document=${encodeURIComponent(document.id)}`);
    }
  }

  return <div className="page-width content-page tight stack">
    <header className="stack">
      <h1 className="page-title">{t("Study a document", "ادرس مستنداً")}</h1>
      <p className="muted">{t("Upload a private PDF and start studying with answers that cite its pages.", "ارفع ملف PDF خاصاً وابدأ المذاكرة بإجابات تشير إلى صفحاته.")}</p>
    </header>
    <form className="card stack" onSubmit={submit}>
      <PdfUploadSelection language={lang} upload={upload} />
      {created && !courseId ? <p role="status">{t("Course created", "تم إنشاء الدورة")} · <b dir="auto">{created.title}</b></p> : !upload.busy && <details>
        <summary>{t("Choose or name a course", "اختر دورة أو سمِّها")}</summary>
        <div className="stack mt-3">
          {!!data?.courses.length && <Combobox label={t("Destination course", "الدورة المستهدفة")} value={courseId}
            options={[{ value: "", label: t("Create a new course", "أنشئ دورة جديدة") }, ...data.courses.map((course) => ({ value: course.id, label: course.title }))]}
            onChange={setCourseId} noOptions={t("No matches.", "لا توجد نتائج.")} />}
          {!courseId && <label className="field">{t("Course title (optional)", "اسم الدورة (اختياري)")}
            <input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} maxLength={110} dir="auto" />
          </label>}
        </div>
      </details>}
      <div className="row">
        <Button type="submit" disabled={!upload.file || upload.busy}>{upload.file && (upload.error || upload.cancelled)
          ? t("Retry upload", "أعد الرفع") : t("Upload and open course", "ارفع الملف وافتح الدورة")}</Button>
        {(courseId || created) && <Link className="text-link" href={`/courses/${encodeURIComponent(courseId || created!.id)}`}>{t("Open course", "افتح الدورة")}</Link>}
      </div>
    </form>
    <Link className="text-link" href="/dashboard?new=1">{t("Create a course without a PDF", "أنشئ دورة دون ملف PDF")}</Link>
  </div>;
}
