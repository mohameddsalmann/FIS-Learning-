import Link from "next/link";
import { ArrowUpRight, Database, ExternalLink, FileLock2, Layers3, Route } from "lucide-react";
import { evaluatePreparedRetrieval } from "@/lib/evaluation";
import { getLanguage } from "@/lib/server-locale";
import { tr } from "@/lib/locale";

export const metadata = { title: "Engineering" };

export default async function Engineering() {
  const lang = await getLanguage();
  const t = (en: string, ar: string) => tr(lang, en, ar);
  const baseline = evaluatePreparedRetrieval();
  const architecture = [
    { icon: Route, name: "Next.js · Better Auth", detail: t("Session, course workspace and streaming API", "الجلسة ومساحة الدورة والواجهة المتدفقة") },
    { icon: FileLock2, name: "Vercel Blob", detail: t("Private PDF originals, streamed with ownership checks", "ملفات PDF الأصلية الخاصة، مع التحقّق من الملكية عند العرض") },
    { icon: Database, name: "PostgreSQL · pgvector", detail: t("Processing checkpoints, search, sessions and practice", "نقاط استئناف المعالجة والبحث والجلسات والتدريب") },
    { icon: Layers3, name: "Gemini · Groq · OpenRouter", detail: t("Capability-aware routing to verified free models", "توجيه حسب الإمكانات إلى نماذج مجانية متحقَّق منها") },
  ];
  const stages = [
    { title: t("Extract", "استخراج"), description: t("Read the original PDF in bounded page batches and preserve page references.", "اقرأ ملف PDF الأصلي على دفعات صفحات محدودة واحتفظ بمراجع الصفحات.") },
    { title: t("Index", "فهرسة"), description: t("Chunk source text and retain keyword search if a free embedding service is unavailable.", "قسّم نص المصدر وأبقِ البحث بالكلمات المفتاحية متاحاً عند تعذّر خدمة التضمين المجانية.") },
    { title: t("Retrieve", "استرجاع"), description: t("Fuse lexical and compatible vector rankings, with bounded reranking when useful.", "ادمج قوائم البحث النصي والمتجهات المتوافقة، مع إعادة ترتيب محدودة عند الحاجة.") },
    { title: t("Teach and cite", "شرح واستشهاد"), description: t("Build a bounded source context, validate citations, and open the exact PDF page.", "ابنِ سياقاً محدود الحجم وتحقّق من الاستشهادات وافتح صفحة PDF المحدّدة.") },
  ];

  return <article className="page-width content-page stack engineering-case">
    <header className="engineering-intro">
      <div className="stack">
        <h1 className="page-title">{t("Engineering FIS Learning", "هندسة منصة FIS Learning")}</h1>
        <p className="muted">{t("How a private course PDF becomes a cited explanation, a practice question, and a saved review plan.", "كيف يتحوّل ملف دورة خاص إلى شرح موثّق وسؤال تدريبي وخطّة مراجعة محفوظة.")}</p>
      </div>
      <div className="row">
        <Link className="button primary" href="/engineering/documentation">{t("Project documentation", "وثائق المشروع")}<ArrowUpRight size={16} aria-hidden="true" /></Link>
        <a className="button secondary" href="https://github.com/mohameddsalmann/chatbot_fis_learning">GitHub <ExternalLink size={16} aria-hidden="true" /></a>
      </div>
    </header>
    <section className="stack" aria-labelledby="architecture-title">
      <h2 className="section-title" id="architecture-title">{t("Architecture", "البنية")}</h2>
      <div className="card stack architecture-map">
        <p className="architecture-entry">{t("Student browser → authenticated Next.js boundary", "متصفّح الطالب ← واجهة Next.js الموثّقة")}</p>
        <ul className="plain-list architecture-services" aria-label={t("Application dependencies", "مكوّنات التطبيق")}>{architecture.map(({ icon: Icon, name, detail }) => <li key={name}>
          <Icon size={20} aria-hidden="true" /><strong dir="ltr">{name}</strong><span className="muted">{detail}</span>
        </li>)}</ul>
      </div>
    </section>
    <section className="stack" aria-labelledby="pipeline-title">
      <h2 className="section-title" id="pipeline-title">{t("From PDF to cited answer", "من ملف PDF إلى الإجابة الموثّقة")}</h2>
      <ol className="retrieval-stages">{stages.map(({ title, description }) => <li key={title}><h3>{title}</h3><p className="muted">{description}</p></li>)}</ol>
    </section>
    <section className="stack" aria-labelledby="verification-title">
      <h2 id="verification-title" className="section-title">{t("Evaluation and testing", "التقييم والاختبارات")}</h2>
      <div className="grid-2">
        <div className="card stack"><h3>{t("Prepared lesson baseline", "القياس المرجعي للدرس المُعد مسبقاً")}</h3>
          <p className="muted">{t("Eight curated English and Arabic queries. Local lexical retrieval on the built-in optics lesson.", "ثمانية استعلامات مختارة بالعربية والإنجليزية لقياس الاسترجاع النصي المحلي في درس البصريات.")}</p>
          <dl className="plain-list"><div className="record"><dt>Recall@2</dt><dd>{(baseline.recallAt2 * 100).toFixed(0)}% ({baseline.found}/{baseline.positive})</dd></div><div className="record"><dt>MRR</dt><dd>{baseline.mrr.toFixed(3)}</dd></div><div className="record"><dt>{t("Unsupported queries declined", "الاستعلامات غير المدعومة المرفوضة")}</dt><dd>{baseline.abstentions}/{baseline.negative}</dd></div></dl>
          <Link className="text-link" href="/courses/sample">{t("Explore the prepared lesson", "تصفّح الدرس المُعد مسبقاً")}</Link>
        </div>
        <div className="card stack"><h3>{t("Course retrieval benchmark", "قياس استرجاع مواد الدورات")}</h3>
          <p className="muted">{t("50 reviewable queries across four synthetic readings. PostgreSQL and pgvector ran locally with controlled embeddings and reranking.", "٥٠ استعلاماً قابلاً للمراجعة عبر أربع قراءات اصطناعية. شُغّل PostgreSQL وpgvector محلياً بتضمينات وإعادة ترتيب مضبوطتين.")}</p>
          <dl className="plain-list"><div className="record"><dt>{t("Vector-only Recall@5", "استرجاع المتجهات Recall@5")}</dt><dd>80.7%</dd></div><div className="record"><dt>{t("Hybrid Recall@5", "الاسترجاع الهجين Recall@5")}</dt><dd>93.6%</dd></div><div className="record"><dt>{t("Hybrid nDCG@5, with conditional reranking", "‏nDCG@5 للهجين مع إعادة ترتيب مشروطة")}</dt><dd>0.927</dd></div></dl>
          <Link className="text-link" href="/engineering/docs/AI_EVALUATION" prefetch={false}>{t("Retrieval evaluation and results", "تقييم الاسترجاع ونتائجه")}</Link>
          <Link className="text-link" href="/engineering/docs/IMPLEMENTATION_STATUS" prefetch={false}>{t("Implementation and verification record", "سجل التنفيذ والتحقّق")}</Link>
        </div>
      </div>
    </section>
    <section className="card stack" aria-labelledby="deployment-title">
      <h2 id="deployment-title" className="section-title">{t("Deployment", "النشر")}</h2>
      <p>{t("One Vercel application uses Neon with pgvector, a private Blob store, and environment-scoped Better Auth credentials. Preview and production each need their own configuration and hosted validation.", "يستخدم تطبيق Vercel واحد قاعدة Neon مع pgvector وتخزين Blob خاصاً وبيانات اعتماد Better Auth خاصة بكل بيئة. تحتاج المعاينة والإنتاج إلى ضبط واختبارات استضافة مستقلّة.")}</p>
      <Link className="text-link" href="/engineering/docs/DEPLOYMENT" prefetch={false}>{t("Deployment runbook", "دليل تشغيل النشر")}</Link>
    </section>
  </article>;
}
