import { Dashboard } from "@/components/workspace";
import { getLanguage } from "@/lib/server-locale";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [lang, query] = await Promise.all([getLanguage(),searchParams]);
  return <Dashboard lang={lang} startForm={query.new === "1"} />;
}
