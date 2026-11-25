import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finishStudyAction, studyUsage } from "../src/server/ai/usage";
import { database } from "../src/server/db/client";
import { CHUNK_STRATEGY, PROCESSING_VERSION, serializeVector } from "../src/server/rag/chunks";
import { getCourseSources, retrieveCourseSources } from "../src/server/rag/retrieval";
import { courseRecord, createCourse, dashboardRecord, exportWorkspace } from "../src/server/workspace/courses";
import { contextualTutorSources, conversationRecord, quizAttemptRecord, quizRecord, saveGeneratedQuiz, saveTutorTurn, submitQuizAttempt } from "../src/server/workspace/learning";

const localDb = process.env.FIS_INTEGRATION_DATABASE === "isolated" && (() => {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL || "").hostname); }
  catch { return false; }
})();

describe.runIf(Boolean(localDb))("isolated PostgreSQL learning integration", () => {
  const actor = { id: randomUUID(), isAnonymous: true };
  const stranger = { id: randomUUID(), isAnonymous: true };
  const model = "fixture/embedded-source:free";
  let courseId: string;
  let docId: string;
  let sourceIds: string[];

  beforeAll(async () => {
    const db = database();
    await db.user.createMany({ data: [actor, stranger].map((user) => ({
      id: user.id, name: "Test learner", email: `${user.id}@test.invalid`, isAnonymous: true,
    })) });
    const course = await createCourse(actor, "Biology", "Controlled retrieval fixture", "Plants");
    courseId = course.id;
    const doc = await db.document.create({
      data: { courseId, title: "Course reading.pdf", pathname: `test/${randomUUID()}.pdf`, sizeBytes: 1, pageCount: 3, status: "READY" },
    });
    docId = doc.id;
    const data = [
      { text: "Photosynthesis uses sunlight and chlorophyll to produce sugars.", page: 1, embedding: [1, 0, 0] },
      { text: "التمثيل الضوئي يستخدم ضوء الشمس لصنع السكريات.", page: 2, embedding: [0, 1, 0] },
      { text: "Roots absorb water and minerals from soil.", page: 3, embedding: [0, 0, 1] },
    ];
    sourceIds = [];
    for (const [ordinal, source] of data.entries()) {
      const chunk = await db.documentChunk.create({ data: {
        documentId: docId, page: source.page, ordinal, text: source.text, contentHash: randomUUID(),
        chunkStrategy: CHUNK_STRATEGY, processingVersion: PROCESSING_VERSION,
      } });
      sourceIds.push(chunk.id);
      const vector = serializeVector(source.embedding);
      await db.$executeRaw`
        UPDATE "DocumentChunk" SET "embedding" = ${vector}::vector, "embeddingModel" = ${model}, "embeddingDimension" = 3
        WHERE "id" = ${chunk.id}
      `;
    }
  });

  afterAll(async () => {
    if (!localDb) return;
    await database().user.deleteMany({ where: { id: { in: [actor.id, stranger.id] } } });
  });

  it("checks course ownership before any embedding retrieval", async () => {
    let invoked = false;
    await expect(courseRecord(stranger.id, courseId)).rejects.toMatchObject({ status: 404 });
    await expect(retrieveCourseSources(stranger.id, courseId, "photosynthesis", async () => {
      invoked = true;
      return { model, vectors: [[1, 0, 0]] };
    })).rejects.toMatchObject({ status: 404 });
    expect(invoked).toBe(false);
  });

  it("measures English and Arabic Recall@6, MRR, citation validity and retrieval latency", async () => {
    const cases = [
      { query: "photosynthesis", vector: [1, 0, 0], expected: 0 },
      { query: "التمثيل الضوئي", vector: [0, 1, 0], expected: 1 },
      { query: "roots", vector: [0, 0, 1], expected: 2 },
    ];
    let recall = 0;
    let reciprocal = 0;
    let citationCount = 0;
    let valid = 0;
    const latency: number[] = [];
    for (const sample of cases) {
      const start = performance.now();
      const sources = await retrieveCourseSources(actor.id, courseId, sample.query, async (_queries, embeddingModel) => {
        expect(embeddingModel).toBe(model);
        return { model, vectors: [sample.vector] };
      });
      latency.push(performance.now() - start);
      const position = sources.findIndex(({ id }) => id === sourceIds[sample.expected]);
      recall += Number(position >= 0);
      reciprocal += position < 0 ? 0 : 1 / (position + 1);
      citationCount += sources.length;
      valid += sources.filter(({ id, documentId, title, page }) =>
        sourceIds[page - 1] === id && documentId === docId && title === "Course reading.pdf").length;
    }
    const metrics = {
      cases: cases.length, recallAt6: recall / cases.length, mrr: reciprocal / cases.length,
      validCitations: valid, citations: citationCount,
      retrievalMeanMs: Number((latency.reduce((sum, value) => sum + value, 0) / cases.length).toFixed(2)),
    };
    console.log("Controlled retrieval fixture only:", JSON.stringify(metrics));
    expect(metrics).toMatchObject({ recallAt6: 1, mrr: 1 });
    expect(valid).toBe(citationCount);
    const unknown = await retrieveCourseSources(actor.id, courseId, "cosmonauts", async () => ({ model, vectors: [[-1, -1, -1]] }));
    expect(unknown).toEqual([]);
  });

  it("persists scoped conversations and adjusts measured quiz progress once per attempt", async () => {
    const citations = await getCourseSources(actor.id, courseId);
    const save = await saveTutorTurn(actor.id, { courseId, prompt: "What is photosynthesis?", answer: "Plants use light.", citations });
    await expect(conversationRecord(stranger.id, save.conversationId)).rejects.toMatchObject({ status: 404 });
    const conversation = await conversationRecord(actor.id, save.conversationId);
    expect(conversation.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
    const quiz = await saveGeneratedQuiz(actor.id, { courseId, title: "Plants", questions: [{
      prompt: "Energy source?", type: "MCQ", answer: "Sun", options: ["Sun", "Mud"], explanation: "Light supplies energy.",
      sourceIds: [sourceIds[0]],
    }] });
    await expect(quizRecord(stranger.id, quiz.id)).rejects.toMatchObject({ status: 404 });
    expect(quiz.questions[0]).not.toHaveProperty("answer");
    const key = randomUUID();
    const answers = [{ questionId: quiz.questions[0].id, answer: "Sun" }];
    const first = await submitQuizAttempt(actor.id, quiz.id, answers, key);
    expect(first.results[0].sources).toEqual([{ id: sourceIds[0], documentId: docId, page: 1, title: "Course reading.pdf" }]);
    const duplicate = await submitQuizAttempt(actor.id, quiz.id, answers, key);
    expect(duplicate.attempt.id).toBe(first.attempt.id);
    expect(duplicate.results).toEqual(first.results);
    await expect(quizAttemptRecord(actor.id, first.attempt.id)).resolves.toMatchObject({ attempt: { id: first.attempt.id }, results: [{ given: "Sun", correct: true }] });
    await expect(quizAttemptRecord(stranger.id, first.attempt.id)).rejects.toMatchObject({ status: 404 });
    const dashboard = await dashboardRecord(actor.id);
    expect(dashboard.progress[0]).toMatchObject({ title: "Plants", correct: 1, total: 1, attempts: 1 });
    expect(dashboard.completedSessions).toBe(2);
    expect(await exportWorkspace(stranger.id)).toMatchObject({ courses: [], conversations: [], assessments: [] });
  });

  it("claims a study action once across concurrent retries and counts upstream failures separately", async () => {
    const request = new Request("http://localhost", { headers: { "Idempotency-Key": randomUUID() } });
    const usage = studyUsage(actor, request);
    const replacement = studyUsage(actor, request);
    const input = { courseId };
    const first = await usage.begin("quiz", input);
    if (first.replay) throw new Error("New quiz unexpectedly replayed");
    await expect(replacement.begin("quiz", input)).rejects.toMatchObject({ status: 409 });
    const endpoint = { provider: "gemini" as const, modelId: "fixture", endpoint: "generate" };
    const attemptId = await usage.authorizeAttempt("chat", endpoint);
    await usage.reportAttempt({ ...endpoint, attemptId, status: "rate_limited", latencyMs: 12 });
    await usage.fail();
    const retry = await replacement.begin("quiz", input);
    if (retry.replay) throw new Error("Failed quiz unexpectedly replayed");
    await finishStudyAction(database(), retry.action, "saved-quiz");
    await expect(usage.begin("quiz", input)).resolves.toMatchObject({ replay: true, record: { resultRef: "saved-quiz" } });
    await expect(usage.begin("quiz", { courseId: "different" })).rejects.toMatchObject({ status: 409 });
    expect(await database().aiProviderAttempt.findMany({ where: { actionId: first.action.id }, select: { status: true } }))
      .toEqual([{ status: "rate_limited" }]);
  });

  it("does not persist a tutor answer after its sources enter deletion", async () => {
    const db = database();
    const citations = await getCourseSources(actor.id, courseId);
    const previous = await saveTutorTurn(actor.id, { courseId, prompt: "Explain the reading", answer: "The prior verified answer", citations });
    const previousSources = (id: string, answer: string) => contextualTutorSources(id, courseId, previous.conversationId, answer);
    await expect(previousSources(actor.id, "The prior verified answer")).resolves.toEqual(citations);
    await expect(previousSources(actor.id, "A different answer")).resolves.toEqual([]);
    await expect(previousSources(stranger.id, "The prior verified answer")).resolves.toEqual([]);
    const before = await db.conversation.count({ where: { ownerId: actor.id } });
    await db.document.update({ where: { id: docId }, data: { status: "DELETING" } });
    try {
      await expect(saveTutorTurn(actor.id, { courseId, prompt: "Explain photosynthesis", answer: "A stale reply", citations }))
        .rejects.toMatchObject({ status: 422 });
      await expect(previousSources(actor.id, "The prior verified answer")).resolves.toEqual([]);
      expect(await db.conversation.count({ where: { ownerId: actor.id } })).toBe(before);
    } finally {
      await db.document.update({ where: { id: docId }, data: { status: "READY" } });
    }
  });
});
