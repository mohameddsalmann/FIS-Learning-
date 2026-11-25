import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Navigation } from "@/components/navigation";
import { languageName, tr } from "@/lib/locale";
import { StudySessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FIS Learning", template: "%s | FIS Learning" },
  description: "Study your materials, practice questions, and use feedback to plan your next review.",
};

export const viewport: Viewport = { viewportFit: "cover" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preferences = await cookies();
  const language = languageName(preferences.get("fis_language")?.value);
  const savedTheme = preferences.get("fis_theme")?.value;
  const theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : "system";
  return <html lang={language} dir={language === "ar" ? "rtl" : "ltr"} data-theme={theme}>
    <body>
      <StudySessionProvider language={language}>
        <a className="skip-link" href="#main-content">{tr(language,"Skip to content","تجاوز إلى المحتوى")}</a>
        <Navigation language={language} />
        <main id="main-content" tabIndex={-1}>{children}</main>
        <footer className="site-footer">
          <div className="page-width footer-inner"><span>FIS Learning</span><Link href="/help">{tr(language,"Help","المساعدة")}</Link><Link href="/engineering">{tr(language,"Engineering","الهندسة")}</Link><Link href="/settings">{tr(language,"Privacy and settings","الخصوصية والإعدادات")}</Link></div>
        </footer>
      </StudySessionProvider>
    </body>
  </html>;
}
