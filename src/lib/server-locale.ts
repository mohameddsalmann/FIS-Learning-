import "server-only";
import { cookies } from "next/headers";
import { languageName } from "./locale";

export async function getLanguage() {
  return languageName((await cookies()).get("fis_language")?.value);
}
