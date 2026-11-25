import {
  formatTeachingAnswer, mermaidGraph, plainTeachingAnswer, splitTeachingAnswer, teachingBlock,
  type TeachingBlock, type TeachingGraph,
} from "@/lib/teaching-content";
import type { Language } from "./errors";
import type { SourceCitation } from "./services";

const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();

function sequenceIn(quote: string, values: string[]) {
  let index = 0;
  return values.every((value) => {
    const next = quote.indexOf(normalize(value), index);
    if (next < 0) return false;
    index = next + normalize(value).length;
    return true;
  });
}

function verifiesGraph(graph: TeachingGraph, quote: string) {
  const labels = new Map(graph.nodes.map(({ id, label }) => [id, normalize(label)]));
  const statements = quote.split(/\s*[,;|]\s*/u).map((entry) => entry.split(/\s(?:→|->|⇒)\s/u));
  return graph.nodes.every(({ label }) => quote.includes(normalize(label)))
    && graph.edges.every(({ from, to }) => statements.some((statement) =>
      statement.some((label, index) => label === labels.get(from) && statement[index + 1] === labels.get(to))));
}

function verifiedBlock(block: TeachingBlock, sources: Map<string, SourceCitation>): TeachingBlock | null {
  if (block.type === "source_citation" || block.type === "document_excerpt") return sources.has(block.source) ? block : null;
  if (!("grounding" in block) || block.grounding.kind === "illustrative") return block;
  const source = sources.get(block.grounding.source);
  const quote = normalize(block.grounding.quote);
  if (!source) return null;
  const excerpt = source.text.slice(0, 1400);
  if (quote !== normalize(excerpt) && !excerpt.split(/\r?\n/).some((line) => normalize(line) === quote)) return null;
  switch (block.type) {
    case "diagram":
      if (!verifiesGraph(block, quote)) return null;
      break;
    case "mermaid": {
      const graph = mermaidGraph(block.flow);
      if (!graph || !verifiesGraph(graph, quote)) return null;
      break;
    }
    case "chart": {
      if (!block.values.every(({ label, value }) => {
        const line = normalize(label + ": " + value + (block.unit ? " " + block.unit : ""));
        // Require the complete displayed value, including its unit.
        return quote.split(/\s*[,;|]\s*/u).some((entry) => entry.trim() === line);
      })) return null;
      break;
    }
    case "timeline":
      if (!sequenceIn(quote, block.milestones.map(({ label, detail }, index) => (index + 1) + ". " + label + ": " + detail))) return null;
      break;
    case "comparison_table":
      if (!sequenceIn(quote, [block.columns, ...block.rows].map((row) => row.join(" | ")))) return null;
      break;
  }
  return { ...block, title: source.title.slice(0, 68), description: quote.slice(0, 460) };
}

function sourceChart(source: SourceCitation & { label: string }) {
  for (const text of source.text.slice(0, 1400).split(/\r?\n/u)) {
    const quote = normalize(text);
    if (quote.length > 460) continue;
    const entries = quote.split(/\s*[,;|]\s*/u);
    if (entries.length < 2 || entries.length > 8) continue;
    const measurements = entries.map((entry) => entry.match(/^([^:]{1,68}):\s*(-?\d+(?:\.\d+)?)\s+([\p{L}%°][\p{L}\p{N}%°/²³-]{0,23})$/u));
    const unit = measurements[0]?.[3];
    if (!unit || !measurements.every((entry) => entry?.[3] === unit)) continue;
    const chart = teachingBlock.safeParse({
      type: "chart", title: source.title.slice(0, 68), description: quote, unit,
      grounding: { kind: "source", source: source.label, quote },
      values: measurements.flatMap((entry) => entry ? [{ label: entry[1].trim(), value: Number(entry[2]) }] : []),
    });
    if (chart.success) return chart.data;
  }
  return null;
}

export function sourceMeasurementAnswer(sources: Map<string, SourceCitation>, language: Language) {
  for (const [label, citation] of sources) {
    const source = { ...citation, label };
    const chart = sourceChart(source);
    if (!chart) continue;
    const intro = language === "ar" ? "يعرض الرسم القياسات المدرجة في المصدر" : "The chart plots the measurements listed in the source";
    return { answer: formatTeachingAnswer(`${intro} [${label}].`, [chart]), citations: [source] };
  }
  return null;
}

export function prepareTeachingAnswer(answer: string, sources: Map<string, SourceCitation>, language: Language, visualRequested: boolean, question = "") {
  const { markdown, blocks } = splitTeachingAnswer(answer);
  const allowIllustration = /\b(?:illustrations?|illustrate|generate (?:an? )?(?:image|picture))\b|رسم توضيحي|إنشاء صورة|ولّد صورة/iu.test(question);
  const accepted = blocks.flatMap((block) => block.type === "illustration" && !allowIllustration ? [] : verifiedBlock(block, sources) ?? []);
  const labels = new Set([...plainTeachingAnswer(formatTeachingAnswer(markdown, accepted)).matchAll(/\[(S[1-8])\]/g)].map((match) => match[1]));
  for (const block of accepted) {
    if (block.type === "document_excerpt" || block.type === "source_citation") labels.add(block.source);
    if ("grounding" in block && block.grounding.kind === "source") labels.add(block.grounding.source);
  }
  const citations = [...labels].flatMap((label) => {
    const source = sources.get(label);
    return source ? [{ ...source, label }] : [];
  });
  if (visualRequested && !accepted.some((block) => ["diagram", "mermaid", "chart", "timeline", "comparison_table", "equation", "illustration"].includes(block.type))) {
    const cited = citations[0];
    if (cited) {
      const measurement = sourceChart(cited);
      if (measurement) accepted.push(measurement);
      else if (!accepted.some((block) => block.type === "document_excerpt")) accepted.push({ type: "document_excerpt", source: cited.label });
    }
  }
  const completed = formatTeachingAnswer(markdown.trim(), accepted);
  return {
    answer: completed || (language === "ar" ? "لم يكتمل الشرح. أعد صياغة السؤال وحاول مجدداً." : "The explanation did not come through. Try asking again."),
    citations,
  };
}

export const teachingFormat = `Start with useful, independently readable Markdown. When it improves the explanation, append one fenced block with the info string fis-teaching and a raw JSON object {"blocks":[...]} inside. Use the exact fields below, omit unused blocks and do not repeat the prose. Keep code fenced as plain text and math in LaTeX. No HTML, external URLs, SVG markup, scripts or web embeds.
Choose 1–4 relevant blocks using these shapes:
{"type":"paragraph","text":"..."} or {"type":"heading","text":"..."}
{"type":"numbered_steps","items":["...","..."]} or {"type":"bullet_list","items":["...","..."]}
{"type":"equation","latex":"...","explanation":"...","steps":["..."]}
{"type":"code_example","language":"...","code":"...","explanation":"..."}
{"type":"worked_example","title":"...","problem":"...","steps":["..."]}
{"type":"practice_question","question":"...","hint":"...","answer":"..."}
{"type":"interactive_check","question":"...","choices":["...","..."],"correct":0,"explanation":"..."} (zero-based correct index)
{"type":"source_citation","source":"S1"} or {"type":"document_excerpt","source":"S1"} (only provided sources)
Visuals share fields "title", "description" (accessible text equivalent) and "grounding". Use {"kind":"illustrative"} only for explicitly hypothetical examples or background, or {"kind":"source","source":"S1","quote":"exact supporting excerpt"} for source visuals.
{"type":"diagram","title":"...","description":"...","grounding":{"kind":"illustrative"},"nodes":[{"id":"a","label":"..."},{"id":"b","label":"..."}],"edges":[{"from":"a","to":"b"}]}
{"type":"mermaid","title":"...","description":"...","grounding":{"kind":"illustrative"},"flow":"flowchart TD\\nA[One] --> B[Two]"} (that syntax only, with labels and --> arrows)
{"type":"chart","title":"...","description":"...","grounding":{"kind":"illustrative"},"unit":"...","values":[{"label":"...","value":1},{"label":"...","value":2}]}
{"type":"timeline","title":"...","description":"...","grounding":{"kind":"illustrative"},"milestones":[{"label":"...","detail":"..."},{"label":"...","detail":"..."}]}
{"type":"comparison_table","title":"...","description":"...","grounding":{"kind":"illustrative"},"columns":["...","..."],"rows":[["...","..."]]}
{"type":"illustration","description":"Accessible description","prompt":"Optional artistic illustration of a general concept, never scientific or course evidence"} (only when the student explicitly requests an illustration)
For sourced visuals the quote must directly contain every displayed item: arrows in the form "A → B"; chart values in the form "label: value unit" separated by commas, semicolons or pipes; timelines as "1. label: detail"; tables with pipe-separated cells. If direct evidence is unavailable, link the relevant document_excerpt, use a clearly hypothetical example, or give a text explanation. Never invent data points, relationships, page numbers or evidence.`;
