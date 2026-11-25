import { LearningHelp } from "@/components/learning-help";
import { getLanguage } from "@/lib/server-locale";

export const metadata = { title: "Study help" };

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const [lang, query] = await Promise.all([getLanguage(), searchParams]);
  return <LearningHelp lang={lang} openTour={query.tour === "1"} />;
}
