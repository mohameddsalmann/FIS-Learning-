import { describe, expect, it } from "vitest";
import { evaluatePreparedRetrieval } from "@/lib/evaluation";
import { findSampleSources, gradePreparedQuiz, normalizeStudyText } from "@/lib/sample";

describe("prepared sample", () => {
  it("links Arabic and English queries to a real lesson section", () => {
    expect(findSampleSources("Why is there a spectrum in a prism?","en").at(0)).toMatchObject({ id:"dispersion",page:3 });
    expect(findSampleSources("كيف ينكسر الضوء في الزجاج؟","ar").at(0)).toMatchObject({ id:"refraction",page:2 });
  });
  it("does not return a fabricated source for unknown questions", () => {
    expect(findSampleSources("How do chess players castle?","en")).toEqual([]);
    expect(findSampleSources("ما عاصمة اليابان؟","ar")).toEqual([]);
  });
  it("grades factual study questions deterministically without penalizing casing or Arabic diacritics", () => {
    expect(normalizeStudyText("التَّشتُّت")).toBe("التشتت");
    expect(gradePreparedQuiz("en",{mirror:"the normal",angle:"false",light:"DISPERSION!"}).map(result=>result.correct)).toEqual([true,true,true]);
    expect(gradePreparedQuiz("ar",{mirror:"سطح المرآة",angle:"خطأ",light:"التَّشتُّت"}).map(result=>result.correct)).toEqual([false,true,true]);
  });
  it("reports actual held fixture outcomes with separate abstention counts", () => {
    expect(evaluatePreparedRetrieval()).toMatchObject({ positive:6,negative:2,found:6,abstentions:2 });
  });
});
