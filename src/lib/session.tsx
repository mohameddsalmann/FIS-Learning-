"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authClient } from "./auth-client";
import { tr, type Language } from "./locale";
import type { ChatMode } from "./teaching-modes";

export interface AiPreferences {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  voiceModel?: string;
  mode?: ChatMode;
}

interface StudySession {
  language: Language;
  personalKey: string;
  setPersonalKey: (value: string) => void;
  preferences: AiPreferences;
  setPreferences: (preferences: AiPreferences) => void;
  ensureGuest: () => Promise<void>;
  requestInit: (init?: RequestInit) => RequestInit;
}

const Context = createContext<StudySession | null>(null);
const preferenceKey = "fis2_ai_preferences";

export function StudySessionProvider({ language, children }: { language: Language; children: ReactNode }) {
  const [personalKey, setPersonalKey] = useState("");
  const [preferences, updatePreferences] = useState<AiPreferences>({});
  const opening = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}") as AiPreferences;
        if (value && typeof value === "object") updatePreferences(value);
      } catch { /* Preferences are optional in private browsing. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const setPreferences = useCallback((next: AiPreferences) => {
    updatePreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* Keep tab settings. */ }
  }, []);

  const ensureGuest = useCallback(async () => {
    if (opening.current) return opening.current;
    opening.current = (async () => {
      let retryAfter: number | undefined;
      const fetchOptions = { onError: ({ response }: { response: Response }) => {
        const seconds = Number(response.headers.get("Retry-After") ?? response.headers.get("X-Retry-After"));
        if (response.status === 429 && Number.isFinite(seconds) && seconds > 0) retryAfter = seconds;
      } };
      const wait = () => retryAfter === undefined
        ? tr(language, "Try again later.", "حاول مرة أخرى لاحقاً.")
        : tr(language, `Try again in about ${Math.ceil(retryAfter / 60)} min.`,
          `حاول مرة أخرى بعد نحو ${Math.ceil(retryAfter / 60).toLocaleString("ar-EG")} دقيقة.`);
      const session = await authClient.getSession({ fetchOptions });
      if (session.error?.status === 429) {
        throw new Error(tr(language, "Too many session checks.", "تم التحقق من الجلسة مرات كثيرة.") + " " + wait());
      }
      if (session.data?.user) return;
      const guest = await authClient.signIn.anonymous({ fetchOptions });
      if (guest.error?.status === 429) {
        throw new Error(tr(language, "Guest sign-in is temporarily limited.", "تم تقييد دخول الضيوف مؤقتاً.") + " " + wait());
      }
      if (guest.error) throw new Error(guest.error.message || "Guest session unavailable.");
    })();
    try { await opening.current; } finally { opening.current = null; }
  }, [language]);

  const requestInit = useCallback((init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (personalKey) headers.set("x-fis-openrouter-key", personalKey);
    return { ...init, headers };
  }, [personalKey]);

  return <Context.Provider value={{ language, personalKey, setPersonalKey, preferences, setPreferences, ensureGuest, requestInit }}>
    {children}
  </Context.Provider>;
}

export function useStudySession() {
  const session = useContext(Context);
  if (!session) throw new Error("StudySessionProvider is required.");
  return session;
}
