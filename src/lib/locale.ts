export type Language = "en" | "ar";
export const languageName = (code?: string): Language => code === "ar" ? "ar" : "en";
export const tr = (lang: Language, english: string, arabic: string) => lang === "ar" ? arabic : english;
