import { Progress } from "@/components/workspace";
import { getLanguage } from "@/lib/server-locale";

export default async function ProgressPage() {
  return <Progress lang={await getLanguage()} />;
}
