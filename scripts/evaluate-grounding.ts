import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { questions, readings } from "./retrieval-evaluation-data";

type Verdict = "supported" | "unsupported" | "contradicted" | "unverifiable";
type Claim = { text: string; verdict: Verdict; sourceKey: string | null; page: number | null; passage: string | null; errorCategory?: string };
type Answer = { questionId: string; strategy: string; answer: string; abstained: boolean; relevant: boolean; retrieved: string[]; claims: Claim[]; latencyMs: number; generationCalls: number; embeddingCalls: number; rerankCalls: number };
const strategies = ["vector", "hybrid", "hybrid+conditional-rerank"];
const pages = new Map(readings.flatMap((reading) => reading.pages.map(([key, text], index) => [key, { text, page: index + 1, title: reading.title }] as const)));
const allowed = new Set(["supported", "unsupported", "contradicted", "unverifiable"]);

async function main() {
  const [action, path] = process.argv.slice(2);
  assert(path && (action === "template" || action === "score"), "Usage: tsx scripts/evaluate-grounding.ts template|score <file.json>");
  if (action === "template") {
    const records = strategies.flatMap((strategy) => questions.map((question) => ({ questionId: question.id, strategy, question: question.query,
      expectedAnswer: question.expected, expectedEvidence: Object.keys(question.relevance).map((key) => ({ key, ...pages.get(key) })),
      retrieved: null, answer: null, abstained: null, relevant: null, claims: [], latencyMs: null, generationCalls: null, embeddingCalls: null, rerankCalls: null })));
    await writeFile(path, JSON.stringify({ instructions: "Replace null values with observed results and independently review each factual claim. Do not submit unanswered records as scores.", records }, null, 2));
    console.log(`Created ${records.length} review records for ${questions.length} questions. No answers were generated.`);
    return;
  }
  const input = JSON.parse(await readFile(path, "utf8")) as { records: Answer[] };
  assert(Array.isArray(input.records), "Expected records array.");
  assert.equal(input.records.length, questions.length * strategies.length, "All strategy-question pairs must be reviewed.");
  const seen = new Set<string>();
  const q = new Map(questions.map((item) => [item.id, item]));
  const reviewed = input.records.map((record) => {
    const question = q.get(record.questionId);
    assert(question && strategies.includes(record.strategy), "Unknown question or strategy.");
    const key = record.strategy + ":" + record.questionId;
    assert(!seen.has(key), "Duplicate strategy-question pair."); seen.add(key);
    assert(typeof record.answer === "string" && record.answer.trim() && typeof record.abstained === "boolean" && typeof record.relevant === "boolean", `Incomplete answer ${key}`);
    assert(Array.isArray(record.retrieved) && record.retrieved.every((source) => pages.has(source)), `Invalid retrieved sources ${key}`);
    for (const name of ["latencyMs", "generationCalls", "embeddingCalls", "rerankCalls"] as const) assert(Number.isFinite(record[name]) && record[name] >= 0, `Missing ${name} ${key}`);
    assert(Array.isArray(record.claims) && (record.abstained || record.claims.length > 0), `Review claims for ${key}`);
    const claims = record.claims.map((claim) => {
      assert(typeof claim.text === "string" && claim.text.trim() && allowed.has(claim.verdict), `Invalid claim ${key}`);
      const source = claim.sourceKey ? pages.get(claim.sourceKey) : undefined;
      const citationValid = Boolean(source && claim.sourceKey && record.retrieved.includes(claim.sourceKey) && source.page === claim.page && typeof claim.passage === "string" && claim.passage.trim() && source.text.includes(claim.passage));
      if (claim.verdict === "supported" || claim.verdict === "contradicted") assert(citationValid, `Verified evidence required for ${key}`);
      if (claim.verdict !== "supported") assert(typeof claim.errorCategory === "string" && claim.errorCategory.trim(), `Error category required for ${key}`);
      return { ...claim, citationValid };
    });
    return { ...record, answerable: question.type !== "unsupported", claims };
  });
  const result = strategies.map((strategy) => {
    const rows = reviewed.filter((item) => item.strategy === strategy);
    const claims = rows.flatMap((item) => item.claims);
    const unsupported = rows.filter((item) => !item.answerable);
    const times = rows.map((item) => item.latencyMs).sort((a,b) => a-b);
    return { strategy, answers: rows.length, claims: claims.length,
      verdicts: Object.fromEntries([...allowed].map((verdict) => [verdict, claims.filter((claim) => claim.verdict === verdict).length])),
      citationIntegrity: { valid: claims.filter((claim) => claim.citationValid).length, attempted: claims.filter((claim) => claim.sourceKey).length },
      relevantAnswers: rows.filter((row) => row.relevant).length,
      unsupportedAbstentions: unsupported.filter((row) => row.abstained).length, unsupportedQuestions: unsupported.length,
      latencyP50Ms: times[Math.floor((times.length - 1) * .5)], latencyP95Ms: times[Math.ceil(times.length * .95) - 1],
      calls: { generation: rows.reduce((n,row) => n+row.generationCalls,0), embeddings: rows.reduce((n,row) => n+row.embeddingCalls,0), rerank: rows.reduce((n,row) => n+row.rerankCalls,0) } };
  });
  console.log(JSON.stringify({ methodology: "Human-reviewed claim judgments; deterministic exact passage, source and page validation", results: result }, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Evaluation failed"); process.exitCode = 1; });
