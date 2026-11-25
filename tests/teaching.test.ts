import { describe, expect, it } from "vitest";
import { formatTeachingAnswer, mermaidGraph, plainTeachingAnswer, splitTeachingAnswer, teachingBlock } from "../src/lib/teaching-content";
import { isContextualTutorPrompt, selectTeachingMode } from "../src/lib/teaching-modes";
import { prepareTeachingAnswer } from "../src/server/ai/teaching";

const lensText = "Parallel rays → Convex lens → Focal point";
const lens = { id: "optics-lens", documentId: "optics-pdf", page: 2, title: "Optics course", text: lensText };
const sources = new Map([["S2", lens]]);
const lensFlow = {
  type: "mermaid", title: "How light bends", description: "Light travels through a convex lens.",
  grounding: { kind: "source", source: "S2", quote: lensText },
  flow: "flowchart TD\nA[Parallel rays] --> B[Convex lens]\nB --> C[Focal point]",
} as const;

function output(blocks: unknown[], markdown = "") {
  return markdown + "\n\n```fis-teaching\n" + JSON.stringify({ blocks }) + "\n```";
}

describe("teaching response", () => {
  it("selects the appropriate intent in English and Arabic while honoring explicit mode", () => {
    expect(selectTeachingMode("auto", "Give a worked example of refraction.")).toBe("examples");
    expect(selectTeachingMode("auto", "ارسم مخطط يوضح الانكسار.")).toBe("visual");
    expect(selectTeachingMode("auto", "اشرح الخطوات خطوة بخطوة.")).toBe("steps");
    expect(selectTeachingMode("auto", "اختبرني في الانكسار.")).toBe("exam");
    expect(selectTeachingMode("auto", "What is refraction?")).toBe("explain");
    expect(selectTeachingMode("quick", "What is refraction?")).toBe("quick");
    expect(selectTeachingMode("socratic", "Show this as a chart.")).toBe("socratic");
    expect(isContextualTutorPrompt("اشرح الموضوع السابق بصرياً.")).toBe(true);
  });

  it("keeps readable text when a teaching payload is invalid, incomplete or oversized", () => {
    const markdown = "Refraction is a change in direction. $n = c/v$";
    for (const suffix of ["\n```fis-teaching\n{", "\n```fis-teaching\n{\"blocks\":false}\n```"]) {
      expect(splitTeachingAnswer(markdown + suffix).markdown.trim()).toBe(markdown);
      expect(splitTeachingAnswer(markdown + suffix).blocks).toEqual([]);
    }
    expect(splitTeachingAnswer(markdown + "\n```fis-teac", true).markdown.trim()).toBe(markdown);
    expect(splitTeachingAnswer(output([{ type: "paragraph", text: "a".repeat(13_000) }], markdown)).blocks).toEqual([]);
  });

  it("renders only the bounded data-only flowchart grammar", () => {
    expect(mermaidGraph(lensFlow.flow)?.edges).toEqual([{ from: "A", to: "B" }, { from: "B", to: "C" }]);
    expect(mermaidGraph(lensFlow.flow + '\nclick A "javascript:alert(1)"')).toBeNull();
    expect(mermaidGraph('flowchart TD\nA[<img src=x>] --> B[Focus]')).toBeNull();
    expect(teachingBlock.safeParse({ type: "interactive_check", question: "What happened?", choices: ["A", "B"], correct: 4, explanation: "A" }).success).toBe(false);
  });

  it("normalizes JSON-tagged teaching payloads without hiding ordinary code examples", () => {
    const code = "```json\n{\"unit\":\"mm\"}\n```";
    const withTeaching = output([{ type: "paragraph", text: "Validated explanation" }], code).replace("```fis-teaching", "```json");
    expect(splitTeachingAnswer(withTeaching)).toEqual({ markdown: code, blocks: [{ type: "paragraph", text: "Validated explanation" }] });
    expect(splitTeachingAnswer('Read this.\n```json\n{"blocks":[', true)).toEqual({ markdown: "Read this.\n", blocks: [] });
  });

  it("accepts supported flow edges, binds citation labels and drops invented edges despite a valid quote", () => {
    const sourced = prepareTeachingAnswer(output([lensFlow], "A convex lens converges light [S2]."), sources, "en", true);
    expect(sourced.citations).toEqual([{ ...lens, label: "S2" }]);
    const blocks = splitTeachingAnswer(sourced.answer).blocks;
    expect(blocks).toEqual([expect.objectContaining({ type: "mermaid", description: lensText, title: lens.title })]);
    const unverified = prepareTeachingAnswer(output([{ ...lensFlow, flow: "flowchart TD\nA[Parallel rays] --> C[Focal point]" }], "See [S2] and [S8]."), sources, "en", true);
    expect(splitTeachingAnswer(unverified.answer).blocks).toEqual([{ type: "document_excerpt", source: "S2" }]);
    expect(unverified.citations).toHaveLength(1);
  });

  it("checks values and units against a complete source line", () => {
    const text = "Trial A: 120 mm; Trial B: 180 mm";
    const block = {
      type: "chart", title: "Measured focal lengths", description: "Two trials", unit: "mm",
      grounding: { kind: "source", source: "S2", quote: text }, values: [{ label: "Trial A", value: 120 }, { label: "Trial B", value: 180 }],
    };
    const chartSources = new Map([["S2", { ...lens, text }]]);
    const accepted = prepareTeachingAnswer(output([block]), chartSources, "en", false);
    expect(splitTeachingAnswer(accepted.answer).blocks[0]).toMatchObject({ type: "chart", unit: "mm" });
    expect(plainTeachingAnswer(accepted.answer)).toContain("Trial B 180 mm");
    const wrongUnit = prepareTeachingAnswer(output([{ ...block, unit: "cm" }], "Read the results."), chartSources, "en", false);
    expect(wrongUnit).toEqual({ answer: "Read the results.", citations: [] });
  });

  it("recovers a visual from exact same-unit values in the cited source", () => {
    const text = "Spring data\n0 N: 0 cm, 1 N: 2 cm, 2 N: 4 cm\nFor small loads only.";
    const result = prepareTeachingAnswer("The data are on this page [S2].", new Map([["S2", { ...lens, text }]]), "en", true);
    expect(splitTeachingAnswer(result.answer).blocks).toEqual([expect.objectContaining({ type: "chart", unit: "cm", values: [
      { label: "0 N", value: 0 }, { label: "1 N", value: 2 }, { label: "2 N", value: 4 },
    ] })]);
  });

  it("offers an illustration only when explicitly requested and does not attach a model-provided URL", () => {
    const illustration = { type: "illustration", description: "Artistic waves", prompt: "Stylized teal waves on a plain background." } as const;
    expect(splitTeachingAnswer(prepareTeachingAnswer(output([illustration]), new Map(), "en", false, "Explain waves").answer).blocks).toHaveLength(0);
    expect(teachingBlock.safeParse({ ...illustration, url: "https://untrusted.test/image" }).success).toBe(false);
    expect(prepareTeachingAnswer(output([illustration]), new Map(), "en", true, "Generate a picture of waves").answer)
      .toBe(formatTeachingAnswer("", [illustration]));
  });
});
