import { ArrowUpRight, ChartNoAxesColumn, FileText, FileUp, GraduationCap, MessageCircle } from "lucide-react";
import Link from "next/link";
import { HomeActivity } from "@/components/workspace";
import { FirstVisitHelp } from "@/components/learning-help";
import { Button } from "@/components/ui/button";
import { getLanguage } from "@/lib/server-locale";
import { tr } from "@/lib/locale";

export default async function Home() {
  const lang = await getLanguage();
  const t = (en: string, ar: string) => tr(lang,en,ar);
  const actions = [
    { url: "/practice", icon: GraduationCap, title: t("Prepare for an exam", "استعد للامتحان"), detail: t("Practice with questions from your course.", "تدرّب بأسئلة من مواد دورتك.") },
    { url: "/chat", icon: MessageCircle, title: t("Ask AI Tutor", "اسأل المعلّم الذكي"), detail: t("Get an explanation or work through a question.", "احصل على شرح أو حلّ سؤال خطوة بخطوة.") },
    { url: "/progress", icon: ChartNoAxesColumn, title: t("Review progress", "راجع تقدّمك"), detail: t("See what you’ve practiced and what to revisit.", "راجع ما تدرّبت عليه وما يحتاج إلى مراجعة.") },
  ];
  return <div className="page-width home">
    <section className="hero" aria-labelledby="home-intro">
      <div className="hero-copy">
        <h1 id="home-intro">{t("Study from your own materials.","ادرس من موادك الخاصة.")}</h1>
        <p>{t("Upload a PDF, ask questions with citations, and practice what you learn.","ارفع ملف PDF، واطرح أسئلة بإجابات موثّقة بالمصادر، وتدرّب على ما تتعلّمه.")}</p>
        <Button asChild><Link href="/study"><FileUp size={19} aria-hidden="true" />{t("Study a document","ادرس مستنداً")}</Link></Button>
        <small>{t("PDF up to 20 MB. Start without an account.","ملف PDF بحجم يصل إلى ٢٠ ميغابايت. ابدأ دون حساب.")}</small>
      </div>
      <ol className="study-sequence" aria-label={t("How to study a document", "كيف تدرس مستنداً")}>
        <li><span className="sequence-icon"><FileText size={19} aria-hidden="true" /></span><span>{t("Add a study PDF", "أضف ملف الدراسة")}</span></li>
        <li><span className="sequence-icon"><MessageCircle size={19} aria-hidden="true" /></span><span>{t("Ask and open the cited page", "اسأل وافتح الصفحة المشار إليها")}</span></li>
        <li><span className="sequence-icon"><GraduationCap size={19} aria-hidden="true" /></span><span>{t("Practice and save your progress", "تدرّب واحفظ تقدّمك")}</span></li>
      </ol>
    </section>
    <section className="home-journeys" aria-label={t("Ways to study","طرق الدراسة")}>
      {actions.map(({url, icon: Icon, title, detail}) => <Link key={url} className="card study-card" href={url}>
        <span className="icon-tile"><Icon size={19} aria-hidden="true" /></span><strong>{title}</strong><span>{detail}</span><ArrowUpRight className="card-arrow" size={17} aria-hidden="true" />
      </Link>)}
    </section>
    <HomeActivity lang={lang} />
    <Link className="text-link optional-example" href="/courses/sample">{t("Explore the pre-authored example lesson","تصفّح الدرس النموذجي المُعد مسبقاً")}</Link>
    <FirstVisitHelp lang={lang} />
  </div>;
}
