export const teachingStyles = [
  { value: "auto", en: "Automatic", ar: "تلقائي" },
  { value: "quick", en: "Quick explanation", ar: "شرح سريع" },
  { value: "detailed", en: "Detailed explanation", ar: "شرح مفصّل" },
  { value: "steps", en: "Step-by-step tutorial", ar: "شرح خطوة بخطوة" },
  { value: "examples", en: "Teach with examples", ar: "شرح بالأمثلة" },
  { value: "visual", en: "Visual explanation", ar: "شرح مرئي" },
  { value: "socratic", en: "Socratic tutor", ar: "تعلّم بالأسئلة" },
  { value: "exam", en: "Exam preparation", ar: "الاستعداد للاختبار" },
  { value: "hint", en: "Give hints", ar: "تلميحات" },
] as const;

export const chatModes = ["auto", "quick", "detailed", "steps", "examples", "visual", "socratic", "exam", "hint", "explain", "simplify", "quiz"] as const;
export type ChatMode = typeof chatModes[number];

export const contextualTutorActions = [
  { mode: "simplify", label: ["Simplify", "بسّط الشرح"], prompt: ["Simplify the explanation of the previous topic.", "بسّط شرح الموضوع السابق."] },
  { mode: "visual", label: ["Explain visually", "اشرح بصرياً"], prompt: ["Explain the previous topic visually.", "اشرح الموضوع السابق بصرياً."] },
  { mode: "quiz", label: ["Test me", "اختبرني"], prompt: ["Quiz me on the previous topic.", "اختبرني في الموضوع السابق."] },
  { mode: "steps", label: ["Explain step by step", "اشرح خطوة بخطوة"], prompt: ["Explain the previous topic step by step.", "اشرح الموضوع السابق خطوة بخطوة."] },
  { mode: "examples", label: ["Show an example", "اعرض مثالاً"], prompt: ["Give a worked example about the previous topic.", "اعرض مثالاً محلولاً عن الموضوع السابق."] },
  { mode: "socratic", label: ["Guide me with questions", "وجّهني بالأسئلة"], prompt: ["Guide me with questions about the previous topic.", "وجّهني بأسئلة حول الموضوع السابق."] },
] as const;

export function isContextualTutorPrompt(question: string) {
  return contextualTutorActions.some(({ prompt }) => prompt.some((value) => value === question));
}

export function isChatMode(value: unknown): value is ChatMode {
  return chatModes.some((mode) => mode === value);
}

export function teachingStyle(value: unknown) {
  if (value === "explain") return "detailed";
  if (value === "simplify") return "quick";
  if (value === "quiz") return "exam";
  return isChatMode(value) ? value : "auto";
}

const intent: ReadonlyArray<[ChatMode, RegExp]> = [
  ["visual", /\b(?:visually|visualize|diagram|chart|draw|timeline|graph|illustrate|illustration)\b|بصري|مرئي|مخطط|رسم|خط زمني/iu],
  ["exam", /\b(?:exam|quiz|test me|practice questions?)\b|اختبرني|امتحان|اختبار|أسئلة تدريب/iu],
  ["socratic", /\b(?:socratic|guide me with questions|without (?:telling|giving) me the answer)\b|سقراط|وجّهني|وجهني|دون (?:الإجابة|الحل)/iu],
  ["hint", /\bhints?\b|تلميح/iu],
  ["steps", /\b(?:step[- ]by[- ]step|walk me through|each step|show (?:your|the) work)\b|خطوة بخطوة|بالخطوات|خطوات الحل/iu],
  ["examples", /\b(?:examples?|worked problem)\b|مثال|أمثلة/iu],
  ["detailed", /\b(?:in detail|detailed|in depth|derive|compare|why|implications)\b|بالتفصيل|لماذا|قارن|اشتق/iu],
];

export function selectTeachingMode(value: ChatMode, question: string): Exclude<ChatMode, "auto"> {
  if (value !== "auto") return value;
  const matched = intent.find(([, pattern]) => pattern.test(question))?.[0];
  return matched && matched !== "auto" ? matched : "explain";
}
