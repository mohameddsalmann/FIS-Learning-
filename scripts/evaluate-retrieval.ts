import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../src/server/db/client";
import { CHUNK_STRATEGY, PROCESSING_VERSION, serializeVector, splitPageText } from "../src/server/rag/chunks";
import { buildDocumentOutline } from "../src/server/rag/outline";
import { retrieveCourseSources, retrievalTerms } from "../src/server/rag/retrieval";
import { questions, readings } from "./retrieval-evaluation-data";

const fixtureModel = "fixture/bilingual-feature-v1";
// Bilingual concept features from the synthetic readings. The provider stub never reads the answer key.
const featureTerms = [
  "reflection incidence انعكاس انعكاسه الانعكاس السقوط",
  "refraction refract refractive medium materials انكسار انكساره الانكسار عبور الانكسار معامل",
  "converging lens focus focal parallel عدسة بؤرة",
  "dispersion wavelength violet colors prism تشتت اللون البنفسجي الاحمر المنشور الموجي",
  "phases phase illuminated sunlit visible phases اطوار البدر بدر مضيء",
  "eclipse shadow خسوف الخسوف ظل",
  "season seasons axial tilt summer daylight hemisphere الفصول الصيف الايام النهار الميل",
  "stellar parallax orbit nearby distance star نجم نجوم اختلاف المنظر مسافة",
  "mean average sum متوسط المتوسط الحسابي مجموع",
  "median middle الوسيط وسيط وسطيتين",
  "range smallest largest minimum maximum المدى مدى اكبر اصغر",
  "correlation causation inference الارتباط ارتباط السببية يسبب",
  "stack undo lifo المكدس مكدس التراجع آخر",
  "queue printer printing fifo الطابور طابور الطباعة الطابعة طابعة",
  "binary sorted exclude half الثنائي ثنائي الترتيب ترتيب نصف استبعاد الأوسط",
  "cache caching stale invalidation update ذاكرة الذاكرة المؤقتة تحديث قديمة النسخة",
].map((terms) => new Set(terms.split(" ")));

function tokens(text: string) {
  return retrievalTerms(text, Infinity).map((term) => term.replace(/[\u0640\u064B-\u065F\u0670]/gu, "")
    .replace(/[أإآٱ]/gu, "ا").replace(/ى/gu, "ي"));
}

function fixtureVector(text: string) {
  const words = new Set(tokens(text));
  const vector = featureTerms.map((features) => [...features].filter((term) => words.has(term)).length);
  return [...vector, Number(vector.every((score) => score === 0))];
}

function fixtureRerank(query: string, candidates: string[]) {
  const queryTerms = new Set(tokens(query));
  const queryFeatures = fixtureVector(query);
  return candidates.map((text, index) => {
    const features = fixtureVector(text);
    const exactMatches = new Set(tokens(text).filter((token) => queryTerms.has(token))).size;
    const conceptMatches = features.slice(0, -1).filter((weight, position) => weight > 0 && queryFeatures[position] > 0).length;
    return { index, score: exactMatches + conceptMatches * 1.25 };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ index }) => index);
}

const strategies = [
  { name: "vector", mode: "vector", rerank: false },
  { name: "hybrid", mode: "hybrid", rerank: false },
  { name: "hybrid+conditional-rerank", mode: "hybrid", rerank: true },
] as const;

function dcg(grades: number[]) {
  return grades.reduce((total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

async function run() {
  const url = new URL(process.env.DATABASE_URL || "postgresql://invalid");
  assert(process.env.FIS_INTEGRATION_DATABASE === "isolated" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    /^\/fis_(?:test|retrieval_eval)(?:_[a-z\d]+)*$/u.test(url.pathname),
  "Use a migrated, disposable local fis_test or fis_retrieval_eval database with FIS_INTEGRATION_DATABASE=isolated.");
  assert.equal(questions.length, 50);
  assert.equal(new Set(questions.map(({ id }) => id)).size, questions.length);
  const pageKeys = new Set<string>(readings.flatMap(({ pages }) => pages.map(([key]) => key)));
  for (const sample of questions) {
    assert(Object.keys(sample.relevance).every((key) => pageKeys.has(key)));
    assert.equal(Object.keys(sample.relevance).length === 0, sample.type === "unsupported");
  }

  const db = database();
  const runId = randomUUID();
  const provenance = new Map<string, { key: string; documentId: string; title: string; page: number; text: string }>();
  const actor = await db.user.create({ data: { id: runId, name: "Retrieval fixture", email: `${runId}@test.invalid`, isAnonymous: true } });
  try {
    const course = await db.course.create({ data: { ownerId: actor.id, title: "Retrieval evaluation" } });
    for (const reading of readings) {
      const chunks = splitPageText(reading.pages.map(([, text], index) => ({ page: index + 1, text })));
      const document = await db.document.create({ data: {
        courseId: course.id, title: reading.title, pathname: `eval/${runId}/${reading.id}.pdf`,
        sizeBytes: 1, pageCount: reading.pages.length, status: "READY",
        learningOutline: buildDocumentOutline({ title: reading.title, chunks }),
      } });
      for (const chunk of chunks) {
        const row = await db.documentChunk.create({ data: { ...chunk, documentId: document.id,
          processingVersion: PROCESSING_VERSION, chunkStrategy: CHUNK_STRATEGY,
        } });
        provenance.set(row.id, { key: reading.pages[row.page - 1][0], documentId: document.id, title: reading.title, page: row.page, text: row.text });
        const vector = fixtureVector(row.text);
        await db.$executeRaw`
          UPDATE "DocumentChunk" SET "embedding" = ${serializeVector(vector)}::vector,
            "embeddingModel" = ${fixtureModel}, "embeddingDimension" = ${vector.length}
          WHERE "id" = ${row.id}
        `;
      }
    }
    assert.equal(provenance.size, pageKeys.size);
    const results = [];
    for (const strategy of strategies) {
      const rows = [];
      for (const sample of questions) {
        let embeddingCalls = 0;
        let rerankCalls = 0;
        const start = performance.now();
        const sources = await retrieveCourseSources(actor.id, course.id, sample.query, async (texts, model) => {
          embeddingCalls++;
          assert.equal(model, fixtureModel);
          return { model, vectors: texts.map(fixtureVector) };
        }, {
          mode: strategy.mode,
          expandNeighbors: false,
          evaluationRerank: strategy.rerank ? async (query, candidates) => {
            rerankCalls++;
            return fixtureRerank(query, candidates);
          } : undefined,
        });
        const milliseconds = performance.now() - start;
        const refs = sources.map((source) => {
          const page = provenance.get(source.id);
          const valid = page?.page === source.page && page.documentId === source.documentId &&
            page.title === source.title && page.text === source.text;
          return { key: page?.key || "unknown", valid };
        });
        const top = refs.slice(0, 5);
        const topKeys = new Set(top.map(({ key }) => key));
        const relevant = Object.keys(sample.relevance);
        const required = relevant.filter((key) => sample.relevance[key] === 2);
        const first = refs.findIndex(({ key }) => sample.relevance[key] > 0);
        const answerable = relevant.length > 0;
        const ideal = dcg(Object.values(sample.relevance).sort((a, b) => b - a).slice(0, 5));
        rows.push({
          id: sample.id, type: sample.type, language: sample.language, answerable, milliseconds, embeddingCalls, rerankCalls,
          retrieved: refs.map(({ key }) => key),
          recall: answerable ? relevant.filter((key) => topKeys.has(key)).length / relevant.length : 0,
          reciprocalRank: first >= 0 ? 1 / (first + 1) : 0,
          ndcg: ideal ? dcg(top.map(({ key }) => sample.relevance[key] || 0)) / ideal : 0,
          validCitations: refs.filter(({ valid }) => valid).length, citations: refs.length,
          evidenceComplete: answerable && required.every((key) => topKeys.has(key)),
        });
      }
      const supported = rows.filter(({ answerable }) => answerable);
      const unsupported = rows.filter(({ answerable }) => !answerable);
      const totalCitations = rows.reduce((total, row) => total + row.citations, 0);
      const validCitations = rows.reduce((total, row) => total + row.validCitations, 0);
      const times = rows.map(({ milliseconds }) => milliseconds).sort((a, b) => a - b);
      assert.equal(validCitations, totalCitations, "Resolved citations must match exact document/page/excerpt provenance");
      results.push({
        strategy: strategy.name,
        recallAt5: mean(supported.map(({ recall }) => recall)),
        crossLanguageRecallAt5: mean(supported.filter(({ type }) => type === "cross-language").map(({ recall }) => recall)),
        mrr: mean(supported.map(({ reciprocalRank }) => reciprocalRank)),
        ndcgAt5: mean(supported.map(({ ndcg }) => ndcg)),
        validCitations,
        totalCitations,
        completeAnswerEvidenceAt5: supported.filter(({ evidenceComplete }) => evidenceComplete).length,
        unsupportedAbstentions: unsupported.filter(({ citations }) => citations === 0).length,
        unsupportedWithSources: unsupported.filter(({ citations }) => citations > 0).map(({ id }) => id),
        meanMs: mean(times),
        p95Ms: times[Math.ceil(times.length * 0.95) - 1],
        embeddingFixtureCalls: rows.reduce((total, row) => total + row.embeddingCalls, 0),
        rerankFixtureCalls: rows.reduce((total, row) => total + row.rerankCalls, 0),
        ...(process.argv.includes("--details") ? { questions: rows } : {}),
      });
    }
    console.log(JSON.stringify({
      setting: "Real PostgreSQL FTS and pgvector with deterministic bilingual embedding/reranking fixtures",
      questions: questions.length,
      answerableQuestions: questions.filter(({ type }) => type !== "unsupported").length,
      documents: readings.length,
      pages: provenance.size,
      liveProviderRequests: 0,
      generatedAnswerGroundedness: null,
      results,
    }, null, 2));
  } finally {
    await db.user.delete({ where: { id: actor.id } });
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error && error.name === "AssertionError" ? error.message :
    `Retrieval evaluation failed (${error instanceof Error ? error.name : "unknown error"}). Check the isolated database and migrations.`);
  process.exitCode = 1;
});
