export type AiErrorCode =
  | "bad_request" | "unauthenticated" | "forbidden" | "not_found"
  | "too_large" | "unsupported_media" | "unreadable_pdf" | "no_sources"
  | "invalid_model" | "no_free_route" | "not_configured" | "invalid_credentials"
  | "rate_limited" | "workspace_quota" | "provider_budget" | "unavailable" | "timeout" | "invalid_response" | "cancelled"
  | "billing_unavailable" | "provider_busy" | "content_blocked";

export type ProviderErrorCategory =
  | "openrouter_daily" | "openrouter_minute" | "openrouter_upstream_pool" | "openrouter_rate"
  | "gemini_project_daily" | "gemini_model_daily" | "gemini_project" | "gemini_model"
  | "groq_model_daily" | "groq_model" | "groq_organization"
  | "credentials" | "billing" | "timeout" | "unsupported" | "unavailable";

const messages: Record<AiErrorCode, [number, string, string]> = {
  bad_request: [400, "Check the request and try again.", "تحقق من البيانات وحاول مرة أخرى."],
  unauthenticated: [401, "Sign in or start a guest session first.", "سجّل الدخول أو ابدأ جلسة ضيف أولًا."],
  forbidden: [403, "You do not have access to this resource.", "ليس لديك صلاحية الوصول إلى هذا المورد."],
  not_found: [404, "The requested resource was not found.", "لم يتم العثور على المورد المطلوب."],
  too_large: [413, "Keep attachments within 3.5 MB total. Upload larger PDFs through course materials.", "الحد الإجمالي للمرفقات ٣٫٥ ميغابايت. ارفع ملفات PDF الأكبر من خلال مواد المقرر."],
  unsupported_media: [415, "Choose MP4 (up to 60 seconds), JPEG, PNG, WebP, or PDF.", "اختر ملف MP4 لا يتجاوز ٦٠ ثانية، أو JPEG أو PNG أو WebP أو PDF."],
  unreadable_pdf: [422, "This PDF has no readable text. Use an unlocked PDF with selectable text.", "لا يحتوي الملف على نص قابل للقراءة. استخدم ملف PDF غير محمي بنص قابل للتحديد."],
  no_sources: [422, "There is not enough indexed course material for this request. Add study materials or choose another topic.", "لا توجد مواد مفهرسة كافية لهذا الطلب. أضف مواد دراسية أو اختر موضوعًا آخر."],
  invalid_model: [400, "Choose Auto or a compatible model in Advanced settings.", "اختر الوضع التلقائي أو نموذجًا متوافقًا في الإعدادات المتقدمة."],
  no_free_route: [503, "No verified free model currently supports this request. Try another mode or try again later.", "لا يتوفر حاليًا نموذج مجاني مُتحقق منه لهذا الطلب. جرّب وضعًا آخر أو أعد المحاولة لاحقًا."],
  not_configured: [503, "No eligible AI provider is configured. Contact the workspace administrator, or try again after a provider is enabled.", "لم يُعدّ مزود ذكاء اصطناعي مؤهل. تواصل مع مسؤول المنصة أو أعد المحاولة بعد تفعيل مزود."],
  invalid_credentials: [503, "The AI provider rejected the credentials. Check your personal key or contact the workspace administrator.", "رفض مزود الذكاء الاصطناعي بيانات الاعتماد. تحقق من مفتاحك الشخصي أو تواصل مع مسؤول المنصة."],
  rate_limited: [429, "A free AI provider is rate-limiting requests and no compatible fallback succeeded. Try again later.", "قيّد مزوّد مجاني الطلبات ولم ينجح أي بديل متوافق. حاول مرة أخرى لاحقًا."],
  workspace_quota: [429, "You've reached a FIS workspace usage limit. Try again when the limit resets.", "وصلت إلى حد الاستخدام داخل FIS. حاول مرة أخرى بعد تجديد الحصة."],
  provider_budget: [429, "Free AI capacity is reserved for other requests. Try again shortly or keep studying your saved material.", "السعة المجانية مخصصة حالياً لطلبات أخرى. حاول قريباً أو راجع موادك المحفوظة."],
  unavailable: [503, "The AI service is temporarily unavailable. Try again in a moment.", "خدمة الذكاء الاصطناعي غير متاحة مؤقتًا. أعد المحاولة بعد قليل."],
  timeout: [504, "The AI request timed out. Try a shorter question or smaller file.", "انتهت مهلة الطلب. جرّب سؤالًا أقصر أو ملفًا أصغر."],
  invalid_response: [502, "The model returned an incomplete or invalid response. Try again.", "أعاد النموذج استجابة ناقصة أو غير صالحة. حاول مرة أخرى."],
  cancelled: [499, "The request was cancelled.", "تم إلغاء الطلب."],
  billing_unavailable: [503, "This provider's billing eligibility is unavailable. Choose Auto or contact the workspace administrator.", "أهلية الدفع لهذا المزود غير متاحة. اختر الوضع التلقائي أو تواصل مع مسؤول المنصة."],
  provider_busy: [503, "The tutor is handling several requests. Try again in a moment.", "يعالج المعلّم عدة طلبات. أعد المحاولة بعد قليل."],
  content_blocked: [422, "The provider declined this request. Rephrase it or remove the attachment.", "رفض المزود هذا الطلب. أعد صياغته أو أزل المرفق."],
};

export type Language = "en" | "ar";

export class AiError extends Error {
  constructor(readonly code: AiErrorCode, readonly retryAfter?: number, readonly scope?: string,
    readonly category?: ProviderErrorCategory, readonly remainingRequests?: number) {
    super(code);
    this.name = "AiError";
  }
}

export function aiErrorFor(error: unknown) {
  if (error instanceof AiError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") return new AiError("timeout");
  if (error instanceof DOMException && error.name === "AbortError") return new AiError("cancelled");
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  const codes: Partial<Record<number, AiErrorCode>> = {
    400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
    413: "too_large", 415: "unsupported_media", 422: "no_sources", 429: "rate_limited",
  };
  return new AiError((typeof status === "number" && codes[status]) || "unavailable");
}

export function publicAiError(error: unknown, language: Language) {
  const { code } = aiErrorFor(error);
  const [status, english, arabic] = messages[code];
  return { status, code, error: language === "ar" ? arabic : english };
}
