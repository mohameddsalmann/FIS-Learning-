import { describe, expect, it } from "vitest";
import { LEGACY_PROCESSING_VERSION, normalizePage, serializeVector, splitPageText } from "../src/server/rag/chunks";
import { buildDocumentOutline, refreshDocumentSuggestions } from "../src/server/rag/outline";
import { reciprocalRank, retrievalTerms } from "../src/server/rag/retrieval";

describe("PDF retrieval primitives", () => {
  it("normalizes Unicode and preserves page references across duplicate material", () => {
    expect(normalizePage("  أَثَرٌ\u0000\tضوئي  ")).toBe("أَثَرٌ ضوئي");
    expect(splitPageText([
      { page: 4, text: "Study\tpractice" }, { page: 5, text: " Study practice " },
      { page: 6, text: "التعلم بالتجربة" },
    ]).map(({ page, ordinal, text }) => ({ page, ordinal, text }))).toEqual([
      { page: 4, ordinal: 0, text: "Study practice" }, { page: 6, ordinal: 1, text: "التعلم بالتجربة" },
    ]);
  });

  it("splits long pages with overlap and without splitting surrogate pairs", () => {
    const text = Array.from({ length: 400 }, (_, n) => `😀concept-${n}`).join(" ");
    const sections = splitPageText([{ page: 3, text }]);
    expect(sections.length).toBeGreaterThan(2);
    expect(sections.every((section) => section.page === 3 && !section.text.includes("\ufffd"))).toBe(true);
    expect(sections[0].text.includes(sections[1].text.slice(20, 70))).toBe(true);
  });

  it("rejects invalid or incompatible vector payloads", () => {
    expect(serializeVector([0, -0.5, 0.5])).toBe("[0,-0.5,0.5]");
    expect(() => serializeVector([NaN])).toThrow();
    expect(() => serializeVector([])).toThrow();
    expect(() => serializeVector(Array.from({ length: 4097 }, () => 0))).toThrow();
  });

  it("retains headings and table rows with the current strategy and preserves old flat chunks on resume", () => {
    const pages = [{ page: 2, text: "Measurements\r\n\r\nLens    |\tfocus\r\nBlue | 4 cm" }];
    const [current] = splitPageText(pages);
    const [legacy] = splitPageText(pages, LEGACY_PROCESSING_VERSION);
    expect(current).toMatchObject({ page: 2, ordinal: 0, text: "Measurements\n\nLens | focus\nBlue | 4 cm" });
    expect(legacy.text).toBe("Measurements Lens | focus Blue | 4 cm");
    expect(current.contentHash).toBe(legacy.contentHash);
  });

  it("reuses deterministic suggestions with source labels, evidence excerpts and page references", () => {
    const pages = [
      { page: 1, text: "Spring Motion\nPeriod is the duration of one cycle. The period increases with the mass." },
      { page: 2, text: "Example Calculations\nWorked example: measure three periods and divide the total duration by three." },
      { page: 4, text: "المتوسط الحسابي\nالمتوسط الحسابي هو مجموع القيم مقسوما على عددها." },
    ];
    const chunks = splitPageText(pages);
    const outline = buildDocumentOutline({ title: "Studying Motion", chunks });
    expect(outline).toEqual(buildDocumentOutline({ title: "Studying Motion", chunks }));
    expect(outline.headings).toEqual([
      { label: "Spring Motion", page: 1 }, { label: "Example Calculations", page: 2 }, { label: "المتوسط الحسابي", page: 4 },
    ]);
    expect(outline.topics).toContainEqual({ label: "Period", page: 1 });
    expect(outline.definitions).toContainEqual({ text: "Period is the duration of one cycle.", page: 1 });
    expect(outline.definitions).toContainEqual({ text: "المتوسط الحسابي هو مجموع القيم مقسوما على عددها.", page: 4 });
    expect(outline.examples).toContainEqual({ text: "Worked example: measure three periods and divide the total duration by three.", page: 2 });
    expect(outline.relationships).toEqual([{ text: "The period increases with the mass.", page: 1 }]);
    expect(outline.suggestions).toEqual([
      { kind: "explain", topics: ["Period"], page: 1 },
      { kind: "visual", topics: ["The period increases with the mass."], page: 1 },
      { kind: "quiz", topics: ["Period"], page: 1 },
    ]);
    expect(buildDocumentOutline({ title: "Unindexed", chunks: [] }).suggestions).toEqual([]);
    const withoutHeading = buildDocumentOutline({
      title: "Class Handout",
      chunks: [{ page: 7, text: "Plants use light for photosynthesis." }],
    });
    expect(withoutHeading.suggestions).toContainEqual({ kind: "summary", topics: ["Plants use light for photosynthesis"], page: 7 });
    expect(withoutHeading.contentFingerprint).toMatch(/^[\da-f]{64}$/u);
  });

  it("uses comparable measurements from the same page and refreshes legacy suggestions from stored evidence", () => {
    const title = "Recovery laboratory";
    const measurementRow = "0 N: 0 cm, 1 N: 2 cm, 2 N: 4 cm";
    const chunks = [
      { page: 1, text: "Spring Elasticity Laboratory\nElasticity: A spring returns to its original length after the load is removed." },
      { page: 3, text: `Study data for spring force and extension:\n${measurementRow}\nThe extension doubles when the force doubles.` },
      { page: 4, text: "7 A: 6 V" },
    ];
    const outline = buildDocumentOutline({ title, chunks });
    expect(outline.suggestions).toEqual([
      { kind: "explain", topics: ["Elasticity"], page: 1 },
      { kind: "compare", topics: ["1 N", "2 N"], page: 3 },
      { kind: "quiz", topics: ["Elasticity"], page: 1 },
    ]);
    expect(outline.topics.map(({ label }) => label)).not.toContain("0 N");
    expect(refreshDocumentSuggestions(outline)).toBeUndefined();

    const legacy = {
      ...outline,
      definitions: [...outline.definitions, { text: measurementRow, page: 3 }],
      suggestions: Array.from({ length: 6 }, () => ({ kind: "explain", topics: [title], page: 1 })),
    };
    expect(refreshDocumentSuggestions(legacy)).toEqual(outline.suggestions);
    expect(refreshDocumentSuggestions({ ...legacy, definitions: outline.definitions })).toContainEqual({
      kind: "visual", topics: ["The extension doubles when the force doubles."], page: 3,
    });
  });

  it("retains Arabic concepts and does not compare unrelated measurements", () => {
    const outline = buildDocumentOutline({ title: "تمرين", chunks: [
      { page: 2, text: "المرونة: يعود الجسم إلى شكله بعد أن تزول القوة.\n١ نيوتن: ٢ سم، ٢ أمبير: ٤ فولت، ١نيوتن: ٢سم\nملاحظة التجربة:\nراقب شكل الجسم عندما تسحب يدك منه." },
    ] });
    expect(outline.suggestions[0]).toEqual({ kind: "explain", topics: ["المرونة"], page: 2 });
    expect(outline.suggestions[1]).toEqual({ kind: "explain", topics: ["ملاحظة التجربة"], page: 2 });
    expect(outline.suggestions.some(({ kind }) => kind === "compare")).toBe(false);
  });

  it("preserves normalized search vocabulary while dropping question boilerplate", () => {
    expect(retrievalTerms("What does the Moon’s brightness depend on?")).toEqual(["moon", "brightness", "depend"]);
    expect(retrievalTerms("إلى أين ينحرف الضَّوء؟")).toEqual(["ينحرف", "الضَّوء"]);
  });

  it("fuses independent rankings and avoids counting a duplicate result twice", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    expect(reciprocalRank([[a, a, b], [c, b]])[0]).toEqual(b);
  });
});
