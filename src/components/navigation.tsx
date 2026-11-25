"use client";

import { ChartNoAxesColumn, GraduationCap, History, House, LayoutGrid, Menu, MessageCircle, Settings2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { tr, type Language } from "@/lib/locale";

export function Navigation({ language }: { language: Language }) {
  const current = usePathname();
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const links = [
    ["/", "Home", "الرئيسية", House],
    ["/dashboard", "My Courses", "دوراتي", LayoutGrid],
    ["/chat", "AI Tutor", "المعلّم الذكي", MessageCircle],
    ["/practice", "Practice", "التدريب", GraduationCap],
    ["/progress", "Progress", "التقدّم", ChartNoAxesColumn],
    ["/history", "History", "السجل", History],
    ["/settings", "Settings", "الإعدادات", Settings2],
  ] as const;
  const nav = () => links.map(([href, en, ar, Icon]) => {
    const active = current === href || current.startsWith(href + "/") || href === "/dashboard" && current.startsWith("/courses/");
    return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => { if (mobileMenu.current) mobileMenu.current.open = false; }}><Icon size={16} aria-hidden="true" />{tr(language,en,ar)}</Link>;
  });
  return <header className="site-header">
    <div className="page-width header-inner">
      <Link className="brand-link" href="/" aria-label={tr(language,"FIS Learning home","FIS Learning — الصفحة الرئيسية")}>
        <Image src="/brand/fis-light.svg" width={41} height={41} alt="" className="brand-light" priority />
        <Image src="/brand/fis-dark.svg" width={41} height={41} alt="" className="brand-dark" />
        <span>FIS <b>Learning</b></span>
      </Link>
      <nav aria-label={tr(language,"Main navigation","التنقل الرئيسي")} className="desktop-nav">{nav()}</nav>
      <details ref={mobileMenu} className="mobile-nav" onKeyDown={(event) => {
        if(event.key !== "Escape" || !mobileMenu.current?.open) return;
        mobileMenu.current.open = false;
        mobileMenu.current.querySelector("summary")?.focus();
      }}>
        <summary aria-label={tr(language,"Open navigation","فتح قائمة التنقل")}><Menu size={22} aria-hidden="true" /></summary>
        <nav aria-label={tr(language,"Mobile navigation","التنقل على الجوال")}>{nav()}</nav>
      </details>
    </div>
  </header>;
}
