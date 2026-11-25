"use client";

import { useSyncExternalStore } from "react";
import type { StudyLanguage } from "./client";

function observeLanguage(change: () => void) {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => observer.disconnect();
}

function languageSnapshot(): StudyLanguage {
  return document.documentElement.lang.startsWith("ar") ? "ar" : "en";
}

export function useStudyLanguage(preferred?: StudyLanguage) {
  const active = useSyncExternalStore(observeLanguage, languageSnapshot, () => preferred ?? "en");
  return preferred ?? active;
}
