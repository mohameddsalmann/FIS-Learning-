import { z } from "zod";

const text = z.string().trim().min(1).max(1_600);
const label = z.string().trim().min(1).max(68);
const itemId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,15}$/);
const citationLabel = z.string().regex(/^S[1-8]$/);
const grounding = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("illustrative") }),
  z.strictObject({ kind: z.literal("source"), source: citationLabel, quote: text.max(550) }),
]);
const visual = { title: label, description: text.max(460), grounding };

export const teachingBlock = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("paragraph"), text }),
  z.strictObject({ type: z.literal("heading"), text: label }),
  z.strictObject({ type: z.literal("numbered_steps"), items: z.array(text).min(2).max(8) }),
  z.strictObject({ type: z.literal("bullet_list"), items: z.array(text).min(2).max(8) }),
  z.strictObject({ type: z.literal("comparison_table"), ...visual, columns: z.array(label).min(2).max(4), rows: z.array(z.array(text.max(220)).min(2).max(4)).min(1).max(8) }),
  z.strictObject({ type: z.literal("equation"), latex: text.max(420), explanation: text.optional(), steps: z.array(text).max(6).optional() }),
  z.strictObject({ type: z.literal("code_example"), language: label, code: text.max(1_600), explanation: text.optional() }),
  z.strictObject({ type: z.literal("source_citation"), source: citationLabel }),
  z.strictObject({ type: z.literal("document_excerpt"), source: citationLabel }),
  z.strictObject({
    type: z.literal("diagram"), ...visual, nodes: z.array(z.strictObject({ id: itemId, label })).min(2).max(7),
    edges: z.array(z.strictObject({ from: itemId, to: itemId })).min(1).max(9),
  }),
  z.strictObject({ type: z.literal("mermaid"), ...visual, flow: text.max(800) }),
  z.strictObject({
    type: z.literal("chart"), ...visual, unit: z.string().trim().max(24),
    values: z.array(z.strictObject({ label, value: z.number().min(-1e9).max(1e9) })).min(2).max(8),
  }),
  z.strictObject({ type: z.literal("timeline"), ...visual, milestones: z.array(z.strictObject({ label, detail: text.max(240) })).min(2).max(8) }),
  z.strictObject({ type: z.literal("worked_example"), title: label, problem: text, steps: z.array(text).min(1).max(7) }),
  z.strictObject({ type: z.literal("practice_question"), question: text, hint: text.optional(), answer: text.optional() }),
  z.strictObject({
    type: z.literal("interactive_check"), question: text, choices: z.array(label).min(2).max(5),
    correct: z.number().int().nonnegative().max(4), explanation: text,
  }),
  z.strictObject({ type: z.literal("illustration"), description: text.max(320), prompt: text.max(500) }),
]).superRefine((block, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (block.type === "diagram" && !validGraph(block)) invalid("Invalid diagram connections");
  if (block.type === "mermaid" && !mermaidGraph(block.flow)) invalid("Unsupported flowchart");
  if (block.type === "comparison_table" && block.rows.some((row) => row.length !== block.columns.length)) invalid("Invalid table columns");
  if (block.type === "chart" && new Set(block.values.map(({ label }) => label)).size !== block.values.length) invalid("Duplicate chart labels");
  if (block.type === "interactive_check" && (block.correct >= block.choices.length || new Set(block.choices).size !== block.choices.length)) invalid("Invalid answer choices");
});

export type TeachingBlock = z.infer<typeof teachingBlock>;
export type TeachingGraph = Pick<Extract<TeachingBlock, { type: "diagram" }>, "nodes" | "edges">;
export type TeachingGrounding = z.infer<typeof grounding>;

function validGraph({ nodes, edges }: TeachingGraph) {
  const ids = new Set(nodes.map(({ id }) => id));
  const pairs = new Set(edges.map(({ from, to }) => from + ">" + to));
  return ids.size === nodes.length && pairs.size === edges.length
    && edges.every(({ from, to }) => from !== to && ids.has(from) && ids.has(to));
}

// Parse a data-only subset. Mermaid never receives model text to interpret.
export function mermaidGraph(flow: string): TeachingGraph | null {
  const [header, ...lines] = flow.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (header !== "flowchart TD" || !lines.length || lines.length > 9) return null;
  const labels = new Map<string, string>();
  const edges: TeachingGraph["edges"] = [];
  for (const line of lines) {
    const match = /^([A-Za-z][\w-]{0,15})(?:\[([^\[\]<>`"';{}\\]{1,68})\])?\s+-->\s+([A-Za-z][\w-]{0,15})(?:\[([^\[\]<>`"';{}\\]{1,68})\])?$/.exec(line);
    if (!match) return null;
    const [, from, start, to, end] = match;
    for (const [id, label] of [[from, start], [to, end]]) {
      const value = label?.trim();
      if (value && labels.has(id) && labels.get(id) !== value) return null;
      if (value) labels.set(id, value);
    }
    edges.push({ from, to });
  }
  const graph = { nodes: [...labels].map(([id, label]) => ({ id, label })), edges };
  return labels.size >= 2 && labels.size <= 7 && validGraph(graph) ? graph : null;
}

const marker = "```fis-teaching";
const opening = /^```(?:fis-teaching[ \t]*\r?\n|json[ \t]*\r?\n(?=\s*\{\s*"blocks"\s*:))/im;
const closing = /^```[ \t]*(?:\r?\n|$)/m;

export function splitTeachingAnswer(answer: string, streaming = false): { markdown: string; blocks: TeachingBlock[] } {
  let remaining = answer;
  let payload: string | undefined;
  const prose: string[] = [];
  for (;;) {
    const start = opening.exec(remaining);
    if (!start) {
      const lastLine = remaining.slice(remaining.lastIndexOf("\n") + 1);
      const partial = lastLine.startsWith("```f") && (marker.startsWith(lastLine) || lastLine.trimEnd() === marker);
      prose.push(streaming && partial ? remaining.slice(0, remaining.length - lastLine.length) : remaining);
      break;
    }
    prose.push(remaining.slice(0, start.index));
    const rest = remaining.slice(start.index + start[0].length);
    const end = closing.exec(rest);
    if (!end) break;
    payload ??= rest.slice(0, end.index);
    remaining = rest.slice(end.index + end[0].length);
  }
  const markdown = prose.length === 1 ? prose[0] : prose.map((section) => section.trim()).filter(Boolean).join("\n\n");
  if (streaming || !payload || payload.length > 12_000) return { markdown, blocks: [] };
  try {
    const parsed = z.strictObject({ blocks: z.array(teachingBlock).min(1).max(10) }).safeParse(JSON.parse(payload));
    return { markdown, blocks: parsed.success ? parsed.data.blocks : [] };
  } catch {
    return { markdown, blocks: [] };
  }
}

export function formatTeachingAnswer(markdown: string, blocks: TeachingBlock[]) {
  if (!blocks.length) return markdown;
  return [markdown, marker + "\n" + JSON.stringify({ blocks }) + "\n```"].filter(Boolean).join("\n\n");
}

export function plainTeachingAnswer(answer: string) {
  const { markdown, blocks } = splitTeachingAnswer(answer);
  return [markdown, ...blocks.map((block) => {
    switch (block.type) {
      case "paragraph": case "heading": return block.text;
      case "bullet_list": case "numbered_steps": return block.items.join("\n");
      case "equation": return [block.latex, block.explanation, ...(block.steps ?? [])].filter(Boolean).join("\n");
      case "code_example": return [block.code, block.explanation].filter(Boolean).join("\n");
      case "worked_example": return [block.title, block.problem, ...block.steps].join("\n");
      case "interactive_check": case "practice_question": return block.question;
      case "diagram": case "mermaid": return block.title + "\n" + block.description;
      case "chart": return [block.title, block.description, ...block.values.map(({ label, value }) => [label, value, block.unit].join(" "))].join("\n");
      case "timeline": return [block.title, block.description, ...block.milestones.map(({ label, detail }) => label + " " + detail)].join("\n");
      case "comparison_table": return [block.title, block.description, block.columns.join(" | "), ...block.rows.map((row) => row.join(" | "))].join("\n");
      case "source_citation": case "document_excerpt": case "illustration": return "";
    }
  })].filter(Boolean).join("\n\n");
}
