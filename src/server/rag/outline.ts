import { createHash } from "node:crypto";
import { normalizePage, type DocumentPage } from "./chunks";

type OutlineTopic = { label: string; page: number };
type OutlineExcerpt = { text: string; page: number };
type Measurement = { input: string; key: string; units: string };
type OutlineSuggestion = {
  kind: "explain" | "summary" | "compare" | "quiz" | "visual";
  topics: string[];
  page: number;
};

export type DocumentLearningOutline = {
  title: string;
  contentFingerprint?: string;
  headings: OutlineTopic[];
  topics: OutlineTopic[];
  definitions: OutlineExcerpt[];
  examples: OutlineExcerpt[];
  relationships: OutlineExcerpt[];
  suggestions: OutlineSuggestion[];
};

const definition = /^(.{3,60}?)(?:\s+(?:is (?:a |an |the |defined as )|are |means |refers to |هو |هي |تعني |يعني )|\s*[:：]\s+)/iu;
const leadingHeading = /^(?:#{1,6}\s+|(?:chapter|section|unit|الفصل|الوحدة|القسم)\s+|\d+(?:\.\d+){0,3}[.)]?\s+)/iu;
const example = /(?:\b(?:worked example|example|exercise|practice problem)\b|(?:مثال|تمرين|مسألة))/iu;
const relationship = /(?:\b(?:proportional|depends on|increases|decreases|doubl(?:es|ing)|compared (?:to|with)|whereas|equivalent|relationship|ratio of)\b|(?:يتناسب|يعتمد|مقارنة|يزداد|ينخفض|نسبة))/iu;
const measurement = /(?:^|[,;|،]\s*)([+\-−]?\p{N}+(?:[.٫]\p{N}+)?\s*([\p{L}°%/]{1,14}))\s*[:：|=→]\s*[+\-−]?\p{N}+(?:[.٫]\p{N}+)?\s*([\p{L}°%/]{1,14})(?![\p{L}\p{N}])/gu;

function isHeading(line: string, next: string | undefined) {
  if (line.length < 4 || line.length > 90 || /[.!?؟؛|]$/u.test(line)) return false;
  if (leadingHeading.test(line) || /[:：]$/u.test(line)) return true;
  const words = line.split(/\s+/u);
  return Boolean(next && next.length > line.length && words.length <= 8 &&
    (!/\p{Script=Latin}/u.test(line) || words.filter((word) => /^\p{Lu}/u.test(word)).length >= Math.ceil(words.length / 2)));
}

function appendUnique<T extends { page: number }>(items: T[], entry: T, key: (item: T) => string) {
  if (items.length < 12 && !items.some((item) => key(item).toLowerCase() === key(entry).toLowerCase())) items.push(entry);
}

function measurementComparison(byPage: Map<number, Measurement[]>): OutlineSuggestion | undefined {
  for (const [page, measurements] of byPage) {
    for (const { units } of measurements) {
      const pair = measurements.filter((entry) => entry.units === units).slice(-2);
      if (pair.length === 2) return { kind: "compare", topics: pair.map(({ input }) => input), page };
    }
  }
}

function collectMeasurements(byPage: Map<number, Measurement[]>, page: number, line: string) {
  for (const [, input, inputUnit, outputUnit] of line.matchAll(measurement)) {
    const entries = byPage.get(page) ?? [];
    const key = input.normalize("NFKC").replace(/\s+/gu, "");
    if (entries.length < 12 && !entries.some((entry) => entry.key === key)) {
      entries.push({ input, key, units: `${inputUnit}\0${outputUnit}` });
      byPage.set(page, entries);
    }
  }
}

function definedTerm(sentence: string) {
  const match = sentence.match(definition);
  const term = match?.[1];
  if (match && term && /^\p{L}/u.test(term) && match[0].length < sentence.length
      && !/^(?:(?:worked )?example|exercise|practice problem|مثال|تمرين|مسألة)(?:\s|$)/iu.test(term)) return term;
}

function studySuggestions({ title, headings, topics, definitions, relationships }: Pick<DocumentLearningOutline, "title" | "headings" | "topics" | "definitions" | "relationships">,
  measurements: Map<number, Measurement[]>): OutlineSuggestion[] {
  const definedTopics: OutlineTopic[] = [];
  for (const { text, page } of definitions) {
    const label = definedTerm(text);
    if (label) appendUnique(definedTopics, { label, page }, (item) => item.label);
  }
  const primary = definedTopics[0] ?? headings[0] ?? topics[0];
  if (!primary) return [];
  const normalizeTopic = (label: string) => normalizePage(label.replace(/\.pdf$/iu, "")).toLowerCase();
  const covered = new Set([normalizeTopic(title), normalizeTopic(primary.label)]);
  const alternate = definedTopics[1] ?? topics.find(({ label }) => !covered.has(normalizeTopic(label)));
  const suggestions: OutlineSuggestion[] = [{ kind: "explain", topics: [primary.label], page: primary.page }];
  const comparison = measurementComparison(measurements);
  if (comparison) suggestions.push(comparison);
  else if (relationships[0]) suggestions.push({ kind: "visual", topics: [relationships[0].text], page: relationships[0].page });
  else if (alternate) suggestions.push({ kind: "explain", topics: [alternate.label], page: alternate.page });
  else suggestions.push({ kind: "summary", topics: [primary.label], page: primary.page });
  suggestions.push({ kind: "quiz", topics: [primary.label], page: primary.page });
  return suggestions;
}

function savedEvidence(value: unknown, field: "text" | "label"): OutlineTopic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const label: unknown = entry[field];
    const page: unknown = entry.page;
    return typeof label === "string" && label.trim() && typeof page === "number" && Number.isInteger(page) && page > 0
      ? [{ label, page }] : [];
  });
}

export function refreshDocumentSuggestions(value: unknown): OutlineSuggestion[] | undefined {
  if (!value || typeof value !== "object" || !("suggestions" in value)
      || !Array.isArray(value.suggestions) || value.suggestions.length <= 3) return undefined;
  const outline = value as Record<string, unknown>;
  const title = typeof outline.title === "string" ? outline.title : "";
  const headings = savedEvidence(outline.headings, "label");
  const topics = savedEvidence(outline.topics, "label");
  const definitions = savedEvidence(outline.definitions, "text").map(({ label, page }) => ({ text: label, page }));
  const relationships = savedEvidence(outline.relationships, "text").map(({ label, page }) => ({ text: label, page }));
  const measurements = new Map<number, Measurement[]>();
  for (const { text, page } of [...definitions, ...relationships]) collectMeasurements(measurements, page, text);
  const suggestions = studySuggestions({ title, headings, topics, definitions, relationships }, measurements);
  return suggestions.length ? suggestions : undefined;
}

export function buildDocumentOutline({ title, pages, chunks }: {
  title: string;
  pages?: DocumentPage[];
  chunks: Pick<DocumentPage, "page" | "text">[];
}): DocumentLearningOutline {
  const headingTitle = (pages?.find((page) => page.title)?.title || title).trim().slice(0, 180);
  const fingerprint = createHash("sha256");
  for (const { page, text } of chunks) fingerprint.update(JSON.stringify([page, normalizePage(text)]));
  const headings: OutlineTopic[] = [];
  const topics: OutlineTopic[] = [];
  const definitions: OutlineExcerpt[] = [];
  const examples: OutlineExcerpt[] = [];
  const relationships: OutlineExcerpt[] = [];
  const measurements = new Map<number, Measurement[]>();
  const sources = pages?.length ? pages : chunks;
  for (const { page, text } of sources) {
    const lines = text.split(/\n+/u).map((line) => line.trim()).filter(Boolean);
    lines.forEach((line, index) => {
      collectMeasurements(measurements, page, line);
      if (isHeading(line, lines[index + 1])) {
        const label = line.replace(/^#{1,6}\s+/u, "").replace(/[:：]$/u, "");
        appendUnique(headings, { label, page }, (item) => item.label);
        appendUnique(topics, { label, page }, (item) => item.label);
      }
      for (const sentence of line.split(/(?<=[.!?؟؛])\s+/u)) {
        const text = sentence.slice(0, 260);
        const term = definedTerm(sentence);
        if (term) {
          appendUnique(topics, { label: term, page }, (item) => item.label);
          appendUnique(definitions, { text, page }, (item) => item.text);
        }
        if (example.test(text)) appendUnique(examples, { text, page }, (item) => item.text);
        if (relationship.test(text)) appendUnique(relationships, { text, page }, (item) => item.text);
      }
    });
  }
  const first = sources.find(({ text }) => /\p{L}/u.test(text));
  if (!topics.length && first) {
    const lead = first.text.trim().split(/[\n.!?؟؛]/u).find((part) => /\p{L}/u.test(part));
    const label = lead?.trim().split(/\s+/u).slice(0, 8).join(" ").slice(0, 90);
    if (label) topics.push({ label, page: first.page });
  }
  const suggestions = studySuggestions({ title: headingTitle, headings, topics, definitions, relationships }, measurements);
  return {
    title: headingTitle, ...(chunks.length ? { contentFingerprint: fingerprint.digest("hex") } : {}),
    headings, topics, definitions, examples, relationships, suggestions,
  };
}
