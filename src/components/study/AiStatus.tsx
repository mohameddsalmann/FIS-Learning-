"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AiFeature, AiFeatureStatus, AiStatusResponse } from "@/lib/ai-status";
import { api } from "@/lib/http";
import { tr, type Language } from "@/lib/locale";

export function useAiStatus(feature: AiFeature, enabled = true, personal = false) {
  const scope = feature + ":" + personal;
  const [incoming, setIncoming] = useState<{ scope: string; value: AiFeatureStatus }>();
  const [outcome, setOutcome] = useState<{ scope: string; value: AiFeatureStatus }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const path = "/api/learning/status" + (personal ? "?personal=1" : "");
    void api<AiStatusResponse>(path, { signal: controller.signal, cache: "no-store" }).then((value) => {
      if (!controller.signal.aborted) setIncoming({ scope, value: value.features[feature] });
    }).catch(() => {});
    return () => controller.abort();
  }, [feature, enabled, personal, scope, revision]);
  const status = outcome?.scope === scope ? outcome.value : incoming?.scope === scope ? incoming.value : undefined;
  useEffect(() => {
    if (!enabled || !status?.retryAfter) return;
    const timer = window.setTimeout(() => {
      setOutcome((current) => current?.scope === scope ? undefined : current);
      setIncoming((current) => current?.scope === scope ? undefined : current);
      setRevision((value) => value + 1);
    }, (Math.min(status.retryAfter, 86_400) + 1) * 1000);
    return () => window.clearTimeout(timer);
  }, [enabled, scope, status]);
  return { status, setStatus: (value: AiFeatureStatus) => setOutcome({ scope, value }) };
}

export function AiStatus({ status, lang, sampleHref = "/courses/sample" }: { status?: AiFeatureStatus; lang: Language; sampleHref?: string }) {
  if (!status) return null;
  const t = (en: string, ar: string) => tr(lang, en, ar);
  const labels = {
    available: t("AI available", "الذكاء الاصطناعي متاح"),
    busy: t("Temporarily busy", "مشغول مؤقتًا"),
    daily_exhausted: t("Daily free capacity exhausted", "نفدت السعة المجانية اليومية"),
    unavailable: t("Feature unavailable", "الميزة غير متاحة"),
  };
  const minutes = status.retryAfter === undefined ? undefined : Math.ceil(status.retryAfter / 60);
  return <div className="muted" role="status">
    <small><strong>{labels[status.state]}</strong>
      {status.state !== "available" && <>
        {minutes !== undefined && <> · {t(`Retry in about ${minutes} min`, `حاول مجددًا بعد نحو ${minutes.toLocaleString("ar-EG")} دقيقة`)}</>}
        {" · "}<Link className="text-link" href={sampleHref}>{t("Study with the example", "ذاكر باستخدام النموذج")}</Link>
      </>}
    </small>
  </div>;
}
