import { cookies } from "next/headers";
import { Settings } from "@/components/settings";
import { languageName } from "@/lib/locale";

export default async function SettingsPage() {
  const prefs = await cookies();
  const theme = prefs.get("fis_theme")?.value;
  return <Settings lang={languageName(prefs.get("fis_language")?.value)} theme={theme==="light"||theme==="dark"?theme:"system"} />;
}
