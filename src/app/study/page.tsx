import { StudyIntake } from "@/components/study-intake";
import { getLanguage } from "@/lib/server-locale";

export const metadata = { title: "Study a document" };

export default async function StudyPage() {
  return <StudyIntake lang={await getLanguage()} />;
}
