import { describe, expect, it, vi } from "vitest";
import { studyActionPolicy } from "../src/server/ai/usage";
import { validatePdfBytes } from "../src/server/documents/storage";
import { assessAnswer, normalizeAnswer, revisionDue } from "../src/server/workspace/scoring";
import { requireSameOrigin } from "../src/server/workspace/errors";

describe("assessment, quota, and file validation", () => {
  it("normalizes user-facing choice variants and Arabic presentation marks", () => {
    expect(normalizeAnswer("  Carbon   Dioxide!  ")).toBe("carbon dioxide");
    expect(normalizeAnswer(" نَـباتٌ؟ ")).toBe("نبات");
  });

  it("distinguishes a reviewed short answer from an incorrect choice", () => {
    const question = { id: "question", answer: "Water", explanation: "The root absorbs water.", sourceIds: ["citation"] };
    expect(assessAnswer({ ...question, type: "MCQ" }, "Soil")).toMatchObject({
      correct: false, reviewRequired: false, missingConcepts: ["Water"], incorrectStatements: ["Soil"],
    });
    expect(assessAnswer({ ...question, type: "SHORT" }, "A liquid in the soil")).toMatchObject({
      correct: null, reviewRequired: true, missingConcepts: [],
    });
    expect(assessAnswer({ ...question, type: "SHORT" }, "water.")).toMatchObject({ correct: true, reviewRequired: false });
  });

  it("derives revision dates only from measured performance", () => {
    const date = new Date("2026-11-19T00:00:00.000Z");
    expect(revisionDue(1, 3, date)?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(revisionDue(3, 3, date)?.toISOString()).toBe("2026-11-26T00:00:00.000Z");
    expect(revisionDue(0, 0, date)).toBeNull();
  });

  it("reserves separate allowances for questions, quizzes, listening and uploads", () => {
    expect(Object.values(studyActionPolicy).map(({ guest }) => guest)).toEqual([24, 8, 12, 5]);
  });

  it("requires PDF magic bytes rather than trusting upload MIME", () => {
    expect(() => validatePdfBytes(new TextEncoder().encode("%PDF-1.7"))).not.toThrow();
    expect(() => validatePdfBytes(new TextEncoder().encode("%PDFlate"))).toThrow();
    expect(() => validatePdfBytes(new Uint8Array())).toThrow();
  });

  it("accepts the pinned auth origin behind a proxy and still rejects an unrelated origin", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://preview.fis.test");
    vi.stubEnv("APP_URL", "");
    try {
      const request = (origin: string) => new Request("http://internal.local/api/workspace/courses", { method: "POST", headers: { Origin: origin } });
      expect(() => requireSameOrigin(request("https://preview.fis.test"))).not.toThrow();
      expect(() => requireSameOrigin(request("https://unrelated.test"))).toThrow("This request origin is not allowed.");
    } finally { vi.unstubAllEnvs(); }
  });
});
