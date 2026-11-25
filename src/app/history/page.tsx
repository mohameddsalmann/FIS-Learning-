import { StudyHistory } from "@/components/workspace";
import { getLanguage } from "@/lib/server-locale";

export const metadata = { title: "Study history" };

export default async function HistoryPage() {
  return <StudyHistory lang={await getLanguage()} />;
}
