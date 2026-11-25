import { tr, type Language } from "./locale";

const lessons = [
  {
    id: "reflection", title: ["Reflection", "الانعكاس"],
    text: [
      "Reflection happens when light bounces off a surface. For a flat mirror, the angle of incidence equals the angle of reflection. Both angles are measured from the normal, the line perpendicular to the mirror, rather than from its surface.",
      "يحدث الانعكاس عندما يرتد الضوء عن سطح. في المرآة المستوية تساوي زاوية السقوط زاوية الانعكاس. تُقاس الزاويتان من العمود المقام على سطح المرآة.",
    ],
    terms: ["reflection", "reflect", "mirror", "bounce", "bounces", "incidence", "normal", "انعكاس", "الانعكاس", "مرآة", "المرآة", "السقوط", "يرتد"],
  },
  {
    id: "refraction", title: ["Refraction", "الانكسار"],
    text: [
      "Refraction is a change in the direction of a wave as it changes speed when entering a different medium. Light entering glass from air at an angle bends toward the normal. At normal incidence the direction stays the same even though the speed changes.",
      "الانكسار هو تغيّر اتجاه الموجة عند تغيّر سرعتها بسبب انتقالها إلى وسط مختلف. ينكسر الضوء نحو العمود المقام عند انتقاله مائلاً من الهواء إلى الزجاج. عند السقوط العمودي تتغيّر السرعة ويبقى الاتجاه ثابتاً.",
    ],
    terms: ["refraction", "refract", "glass", "medium", "media", "speed", "bend", "bends", "water", "الانكسار", "انكسار", "ينكسر", "الزجاج", "وسط", "السرعة", "سرعة"],
  },
  {
    id: "dispersion", title: ["Dispersion", "التشتّت"],
    text: [
      "White light contains a range of wavelengths. In a glass prism, the refractive index varies with wavelength, so its colors bend by different amounts. Violet light generally bends more than red light. The spread into a spectrum is called dispersion.",
      "يحتوي الضوء الأبيض على أطوال موجية متعددة. في المنشور الزجاجي يتغير معامل الانكسار باختلاف الطول الموجي، فتنحرف الألوان بدرجات مختلفة. ينحرف البنفسجي عادةً أكثر من الأحمر. يُسمى انفصال الألوان إلى طيف بالتشتّت.",
    ],
    terms: ["dispersion", "prism", "white", "spectrum", "color", "colors", "wavelength", "wavelengths", "violet", "rainbow", "red", "المنشور", "منشور", "الطيف", "طيف", "التشتت", "الأبيض", "الألوان", "البنفسجي"],
  },
] as const;

export const sampleCourseTitle = (lang: Language) => tr(lang, "Light and color", "الضوء والألوان");
export const sampleLessons = (lang: Language) => lessons.map((lesson, index) => ({
  id: lesson.id, title: lesson.title[lang === "ar" ? 1 : 0], text: lesson.text[lang === "ar" ? 1 : 0], page: index + 1,
}));
export function normalizeStudyText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[إأآ]/g, "ا").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function findSampleSources(query: string, lang: Language) {
  const words = new Set(normalizeStudyText(query).split(" ").filter(Boolean));
  const localized = sampleLessons(lang);
  return lessons.map((lesson, index) => ({
    ...localized[index],
    score: lesson.terms.filter((term) => words.has(normalizeStudyText(term))).length,
  })).filter((lesson) => lesson.score > 0).sort((a,b) => b.score-a.score || a.page-b.page).slice(0,2);
}

export function sampleQuiz(lang: Language) {
  const t = (en: string, ar: string) => tr(lang,en,ar);
  return [
    {
      id: "mirror", type: "MCQ", source: "reflection",
      prompt: t("Where do you measure the angle of reflection from?", "من أي خط تُقاس زاوية الانعكاس؟"),
      options: [t("The normal", "العمود المقام"), t("The mirror surface", "سطح المرآة"), t("The light source", "مصدر الضوء")],
      expected: [t("The normal", "العمود المقام")],
      explanation: t("Both angles are measured from the perpendicular line, called the normal.","تُقاس الزاويتان من الخط العمودي على السطح، ويُسمّى العمود المقام."),
    },
    {
      id: "angle", type: "TRUE_FALSE", source: "refraction",
      prompt: t("Light entering glass along the normal changes direction.", "يتغيّر اتجاه الضوء الداخل إلى الزجاج على امتداد العمود المقام."),
      options: [t("True","صحيح"),t("False","خطأ")], expected: [t("False","خطأ")],
      explanation: t("At normal incidence, speed changes but the ray retains its direction.","عند السقوط العمودي تتغيّر السرعة ويظل اتجاه الشعاع ثابتاً."),
    },
    {
      id: "light", type: "SHORT", source: "dispersion",
      prompt: t("What is the separation of white light into a spectrum called?", "ماذا يُسمّى انفصال الضوء الأبيض إلى طيف؟"),
      options: [], expected: ["dispersion", "light dispersion", "التشتت", "تشتت الضوء", "تشتت"],
      explanation: t("Dispersion is the separation caused by different wavelengths refracting by different amounts.","التشتّت هو انفصال الألوان نتيجة انكسار الأطوال الموجية بدرجات مختلفة."),
    },
  ] as const;
}

export function gradePreparedQuiz(lang: Language, answers: Record<string,string>) {
  return sampleQuiz(lang).map((question) => ({
    ...question,
    correct: question.expected.some((answer) => normalizeStudyText(answer) === normalizeStudyText(answers[question.id] || "")),
  }));
}

export const sampleResultsKey = "fis2_sample_attempts";
export interface SampleAttempt { at: string; correct: number; total: number; }
