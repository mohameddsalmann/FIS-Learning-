import Link from "next/link";
import { getLanguage } from "@/lib/server-locale";
import { tr } from "@/lib/locale";

const docs = [
  ["PRD","Product and scope","المنتج والنطاق"],["FR_NFR","Requirements and acceptance","المتطلبات والقبول"],["ARCHITECTURE","Architecture","البنية"],
  ["DATABASE","Database and migrations","قاعدة البيانات والترحيل"],["API","API contracts","عقود واجهات البرمجة"],
  ["AI_MODELS","Model routing","توجيه النماذج"],["RAG_PIPELINE","Document retrieval","استرجاع المستندات"],["AI_EVALUATION","Evaluation","التقييم"],
  ["SECURITY","Security and privacy","الأمان والخصوصية"],["DEPLOYMENT","Deployment","النشر"],["PORTFOLIO_CASE_STUDY","Portfolio case study","دراسة المشروع"],["IMPLEMENTATION_STATUS","Verification status","حالة التحقق"],
];

export default async function DocumentationIndex() {
  const lang = await getLanguage();
  return <div className="page-width tight content-page stack">
    <Link href="/engineering" className="text-link">{tr(lang,"Engineering","الهندسة")}</Link>
    <h1 className="page-title">{tr(lang,"Project documentation","وثائق المشروع")}</h1>
    <p className="muted">{tr(lang,"These files are part of the repository. Links open the local build’s documents.","هذه الملفات جزء من المستودع. تفتح الروابط وثائق الإصدار المحلي.")}</p>
    <ul className="card plain-list">{docs.map(([file,en,ar])=><li className="record" key={file}><a href={"/engineering/docs/"+file}>{tr(lang,en,ar)}</a><code>{file}.md</code></li>)}</ul>
  </div>;
}
