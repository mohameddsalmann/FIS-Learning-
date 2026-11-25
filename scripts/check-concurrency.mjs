import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { blobToken, fixtureKey, fixturePersonalKey, geminiKey, geminiSecondaryKey, nvidiaChatModel, startBoundary, studyPdf } from "./check-concurrency-fixture.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const boundaryPreload = new URL("./check-concurrency-transport.mjs", import.meta.url).href;
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const port = Number(process.env.FIS_TEST_LOCAL_PORT || 3118);
const origin = `http://127.0.0.1:${port}`;
const runId = randomUUID();
const ipPrefix = parseInt(runId.slice(0, 2), 16);
const includeGemini = process.env.FIS_TEST_GEMINI === "1";
const includeBrowser = process.env.FIS_TEST_BROWSER === "1";
const cleanup = new Set();
let nextClientId = 1;

class RequestFailure extends Error {
  constructor(status, step, code) {
    super(`${step} returned ${status}${code ? ` (${code})` : ""}`);
    this.status = status;
    this.step = step;
    this.code = code;
  }
}

class Student {
  constructor() {
    this.ip = `198.18.${ipPrefix}.${nextClientId++}`;
    this.cookies = new Map();
  }

  async request(path, { method = "GET", data, requestHeaders, signal = AbortSignal.timeout(30_000) } = {}) {
    const headers = new Headers({ Origin: origin, "X-Forwarded-For": this.ip });
    for (const [key, value] of Object.entries(requestHeaders ?? {})) headers.set(key, value);
    if (this.cookies.size) headers.set("Cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    if (data !== undefined && !(data instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(origin + path, {
      method, headers, signal, redirect: "error", body: data instanceof FormData ? data : JSON.stringify(data),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index >= 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }

  async json(path, step, options, status = 200) {
    const response = await this.request(path, options);
    const data = await response.json().catch(() => undefined);
    if (response.status !== status) throw new RequestFailure(response.status, step, data?.code);
    assert(data, `${step} must return JSON.`);
    return data;
  }

  async guest() {
    await this.json("/api/auth/sign-in/anonymous", "guest sign-in", { method: "POST", data: {} });
    cleanup.add(this);
    const session = await this.json("/api/auth/get-session", "guest session");
    assert.equal(session.user.isAnonymous, true);
    return this;
  }

  async course(title) {
    const { course } = await this.json("/api/workspace/courses", "course creation", {
      method: "POST", data: { title, firstTopic: "Spring elasticity" },
    }, 201);
    return course.id;
  }
}

async function readStream(student, prompt, { courseId, model, cutoff, requestHeaders } = {}) {
  const started = performance.now();
  const controller = new AbortController();
  const response = await student.request("/api/learning/chat", {
    method: "POST", data: { messages: [{ role: "user", content: prompt }], courseId, model, language: "en" },
    requestHeaders,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
  });
  const trace = response.headers.get("x-request-id");
  assert(trace, "The public AI route must return a request trace ID.");
  if (!response.ok) {
    const failure = await response.json().catch(() => undefined);
    throw new RequestFailure(response.status, "tutor stream", failure?.code);
  }
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const decoder = new TextDecoder();
  let buffer = "";
  let ttft;
  let message = "";
  let citations;
  let conversationId;
  let done = false;
  assert(response.body, "A tutor event stream must have a body.");
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, separator).trim();
        buffer = buffer.slice(separator + 2);
        if (!event.startsWith("data: ")) continue;
        const payload = event.slice(6);
        if (payload === "[DONE]") { done = true; continue; }
        const data = JSON.parse(payload);
        if (data.error) throw new RequestFailure(200, "interrupted tutor stream", data.code);
        if (data.content?.trim()) ttft ??= performance.now() - started;
        if (data.content) message += data.content;
        citations ??= data.citations;
        conversationId ??= data.conversationId;
        if (cutoff && ttft !== undefined) {
          controller.abort();
          return { ttft, canceled: controller.signal.aborted };
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  assert(done && ttft !== undefined && message && conversationId && Array.isArray(citations), "Tutor stream must finish with a saved conversation and sources.");
  return { ttft, latency: performance.now() - started, message, citations, conversationId };
}

async function materialAndPractice(boundary) {
  const owner = await new Student().guest();
  const courseId = await owner.course("Controlled optics workspace");
  const material = studyPdf();
  const form = new FormData();
  form.set("courseId", courseId);
  form.set("file", new Blob([material], { type: "application/pdf" }), "Elastic materials.pdf");
  const { document } = await owner.json("/api/documents", "private PDF upload", { method: "POST", data: form }, 201);
  const processing = `/api/documents/${document.id}/process`;
  const extracted = await owner.json(processing, "PDF extraction", { method: "POST" });
  assert.equal(extracted.document.status, "EMBEDDING", extracted.document.error || "The controlled PDF must produce selectable text.");
  assert.equal(extracted.job.totalChunks, 6);
  const embedded = await owner.json(processing, "embedding generation", { method: "POST" });
  assert.equal(embedded.document.status, "INDEXING");
  assert.equal(embedded.job.processedChunks, 6);
  const textIndex = await owner.json(processing, "text index verification", { method: "POST" });
  assert.equal(textIndex.document.status, "PREPARING_SUGGESTIONS");
  const indexed = await owner.json(processing, "suggestion preparation", { method: "POST" });
  assert.equal(indexed.document.status, "READY", indexed.document.error || "The uploaded PDF must become ready for retrieval.");
  assert.equal(indexed.job.processedChunks, 6);
  assert(indexed.document.learningOutline.suggestions.length > 0, "Ready PDFs must have cached source-derived suggestions.");

  const turn = await readStream(owner, "spring elasticity", { courseId });
  assert.equal(turn.citations.length, 1);
  const [citation] = turn.citations;
  assert.equal(citation.documentId, document.id);
  assert.equal(citation.page, 1);
  const sourcePath = `/api/documents/${document.id}/chunks/${citation.id}`;
  const { chunk } = await owner.json(sourcePath, "cited chunk");
  assert.equal(chunk.page, 1);
  assert.match(chunk.text, /Spring elasticity:/);
  const privatePath = `/api/documents/${document.id}/file`;
  const original = await owner.request(privatePath);
  assert.equal(original.status, 200);
  assert.equal(original.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), material);
  assert.equal(boundary.stats.reranks, 0, "Interactive retrieval must use hybrid without a neural reranking request.");

  const stranger = await new Student().guest();
  const [fileDenied, citationDenied, sessionDenied] = await Promise.all([
    stranger.request(privatePath), stranger.request(sourcePath), new Student().request(privatePath),
  ]);
  assert.equal(fileDenied.status, 404);
  assert.equal(citationDenied.status, 404);
  assert.equal(sessionDenied.status, 401);

  const credentials = { email: `student-${runId}@example.test`, password: randomBytes(24).toString("hex") };
  await owner.json("/api/auth/sign-up/email", "guest account conversion", {
    method: "POST", data: { ...credentials, name: "Controlled Study User" },
  });
  const subscriber = new Student();
  await subscriber.json("/api/auth/sign-in/email", "member sign-in", { method: "POST", data: credentials });
  cleanup.delete(owner);
  cleanup.add(subscriber);
  const { conversation } = await subscriber.json(`/api/workspace/conversations/${turn.conversationId}`, "saved cited conversation");
  assert.equal(conversation.messages.at(-1).content, turn.message);
  assert.equal(conversation.messages.at(-1).citations[0].id, citation.id);
  const { topics } = await subscriber.json(`/api/workspace/courses/${courseId}`, "migrated course");
  const topicId = topics[0].id;
  const quizRequest = { method: "POST", data: { courseId, topicId, difficulty: "medium", count: 1, type: "MCQ", language: "en" },
    requestHeaders: { "Idempotency-Key": randomUUID() } };
  const { quiz } = await subscriber.json("/api/learning/quiz-generation", "structured quiz generation", quizRequest, 201);
  const beforeReplay = boundary.stats.inferences + boundary.stats.geminiInferences + boundary.stats.embeddings;
  const replayed = await subscriber.json("/api/learning/quiz-generation", "idempotent quiz generation replay", quizRequest, 201);
  assert.equal(replayed.quiz.id, quiz.id);
  assert.equal(boundary.stats.inferences + boundary.stats.geminiInferences + boundary.stats.embeddings, beforeReplay);
  const [question] = quiz.questions;
  assert(!Object.hasOwn(question, "answer"), "Generated quiz cannot expose the answer before submission.");
  const submission = { answers: [{ questionId: question.id, answer: "A spring returns to its original shape" }], submissionKey: randomUUID() };
  const attemptPath = `/api/workspace/quizzes/${quiz.id}/attempts`;
  const attempt = await subscriber.json(attemptPath, "quiz grading", { method: "POST", data: submission }, 201);
  assert.equal(attempt.attempt.score, 1);
  assert.equal(attempt.results[0].correct, true);
  assert.deepEqual(attempt.results[0].sourceIds, [citation.id]);
  const repeated = await subscriber.json(attemptPath, "idempotent quiz retry", { method: "POST", data: submission }, 201);
  assert.equal(repeated.attempt.id, attempt.attempt.id);
  const savedPath = `/api/workspace/quiz-attempts/${attempt.attempt.id}`;
  const savedAttempt = await subscriber.json(savedPath, "reopened quiz result");
  assert.equal(savedAttempt.attempt.id, attempt.attempt.id);
  assert.equal(savedAttempt.results[0].given, submission.answers[0].answer);
  assert.equal((await stranger.request(savedPath)).status, 404);
  const progress = await subscriber.json("/api/workspace/dashboard", "saved learning progress");
  assert.equal(progress.progress.find((entry) => entry.topicId === topicId)?.attempts, 1);
  assert.equal(progress.attempts.find((entry) => entry.id === attempt.attempt.id)?.score, 1);
  return { indexedPages: indexed.document.pageCount, citationPage: citation.page, savedAttemptScore: attempt.attempt.score,
    quizReopened: true, quizReplayedWithoutInference: true, deniedFile: fileDenied.status, deniedCitation: citationDenied.status };
}

async function checkPoolIsolation(boundary) {
  const student = await new Student().guest();
  const requestHeaders = { "X-FIS-OpenRouter-Key": fixturePersonalKey };
  const initialModel = "google/gemma-4-26b-a4b-it:free";
  const result = await readStream(student, "fixture OpenRouter pool quota", { model: initialModel, requestHeaders });
  const { conversation } = await student.json(`/api/workspace/conversations/${result.conversationId}`, "saved free fallback");
  assert.equal(conversation.messages.at(-1).model, nvidiaChatModel);
  const next = await readStream(student, "fixture NVIDIA still available", { model: nvidiaChatModel, requestHeaders });
  assert.match(next.message, /Elasticity/);
  assert.equal(boundary.stats.pool429, 1);
  assert.deepEqual(boundary.stats.poolRoutes, [initialModel, nvidiaChatModel, nvidiaChatModel]);
  assert.equal(boundary.stats.paidAttempts, 0);
  return { scope: "OpenRouter Google AI Studio shared pool", status: 429, fallbackModel: nvidiaChatModel,
    affectedPoolNotRetried: true, independentPoolStillUsable: true, paidAttempts: boundary.stats.paidAttempts };
}

function distribution(values) {
  if (!values.length) return { p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => Math.round(sorted[Math.ceil(sorted.length * fraction) - 1]);
  return { p50: percentile(0.5), p95: percentile(0.95) };
}

async function load(concurrency, boundary) {
  const sessions = [];
  for (let index = 0; index < concurrency; index++) sessions.push(await new Student().guest());
  const baseline429 = boundary.stats.provider429;
  boundary.takePeak();
  const outcomes = await Promise.allSettled(sessions.map(async (student, index) => {
    const start = performance.now();
    const courseId = await student.course(`Concurrent optics ${concurrency}-${index + 1}`);
    const prompt = `Explain elasticity to student ${index + 1}.`;
    const stream = await readStream(student, prompt);
    const [dashboard, saved] = await Promise.all([
      student.json("/api/workspace/dashboard", "database-backed dashboard"),
      student.json(`/api/workspace/conversations/${stream.conversationId}`, "database-backed conversation"),
    ]);
    assert(dashboard.courses.some((course) => course.id === courseId));
    assert.deepEqual(saved.conversation.messages.map(({ content }) => content), [prompt, stream.message]);
    return { journey: performance.now() - start, chat: stream.latency, ttft: stream.ttft };
  }));
  const passed = outcomes.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors = outcomes.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  const aborted = errors.filter((error) => error?.name === "AbortError" || error?.name === "TimeoutError").length;
  return {
    concurrency, success: passed.length, successRate: passed.length / concurrency,
    journeyMs: distribution(passed.map((sample) => sample.journey)), tutorResponseMs: distribution(passed.map((sample) => sample.chat)),
    timeToFirstTokenMs: distribution(passed.map((sample) => sample.ttft)), provider429: boundary.stats.provider429 - baseline429,
    application429: errors.filter((error) => error?.status === 429).length,
    databaseBackedRouteErrors: errors.filter((error) => error?.step?.startsWith("database-backed") || error?.step === "course creation").length,
    failed: errors.length - aborted, aborted, peakConcurrentFixtureStreams: boundary.takePeak(),
    failures: errors.map((error) => error.message),
  };
}

async function waitForNext(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null) {
    const result = await fetch(origin, { signal: AbortSignal.timeout(2000) }).catch(() => undefined);
    if (result?.ok && (await result.text()).includes("FIS Learning")) return;
    await wait(150);
  }
  throw new Error("The isolated Next.js server did not become ready.");
}

async function verifyGemini() {
  const student = await new Student().guest();
  const prompt = "How does an elastic object behave?";
  const stream = await readStream(student, prompt);
  const { conversation } = await student.json(`/api/workspace/conversations/${stream.conversationId}`, "saved Gemini conversation");
  const reply = conversation.messages.at(-1);
  assert.match(reply.model, /^google\/gemini-/);
  assert.equal(reply.content, stream.message);
  assert.equal(conversation.messages[0].content, prompt);
  return { saved: true, model: reply.model };
}

async function runArabicBrowser() {
  const script = fileURLToPath(new URL("./check-concurrency-browser.py", import.meta.url));
  const python = spawn(process.env.FIS_TEST_PYTHON || "python", [script], {
    cwd: project, windowsHide: true, stdio: "inherit",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", FIS_TEST_BROWSER_ORIGIN: origin,
      FIS_TEST_BROWSER_IP: `198.18.${ipPrefix}.250`, FIS_TEST_BROWSER_PDF: studyPdf(1).toString("base64") },
  });
  const [code] = await once(python, "exit");
  assert.equal(code, 0, "The Arabic mobile browser journey failed.");
  return true;
}

async function main() {
  const database = new URL(process.env.FIS_TEST_DATABASE_URL || "postgresql://127.0.0.1/");
  assert(database.protocol === "postgresql:" && database.hostname === "127.0.0.1" && /^\/fis_acceptance_[a-z\d_]+$/.test(database.pathname),
    "Set FIS_TEST_DATABASE_URL to an already-migrated disposable loopback database named fis_acceptance_*." );
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535, "Choose an unoccupied local test port above 1023.");
  assert(existsSync(new URL("../.next/BUILD_ID", import.meta.url)), "Build Next.js before running the controlled journey.");
  const probe = await fetch(origin, { signal: AbortSignal.timeout(1000) }).catch(() => undefined);
  if (probe) { await probe.body?.cancel(); throw new Error("Choose an unused FIS_TEST_LOCAL_PORT."); }
  const boundary = await startBoundary({ includeGemini });
  const child = spawn(process.execPath, ["--import", boundaryPreload, next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: project, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: database.toString(), DIRECT_URL: "",
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"), BETTER_AUTH_URL: origin, APP_URL: origin,
      OPENROUTER_API_KEY: fixtureKey, BLOB_READ_WRITE_TOKEN: blobToken, VERCEL_BLOB_API_URL: "https://vercel.com/api/blob",
      GEMINI_API_KEY_PRIMARY: "", GEMINI_PRIMARY_FREE_TIER_CONFIRMED: String(includeGemini),
      GEMINI_API_KEY_SECONDARY: includeGemini ? geminiSecondaryKey : "", GEMINI_SECONDARY_FREE_TIER_CONFIRMED: String(includeGemini), GEMINI_API_KEY: "",
      GOOGLE_API_KEY: includeGemini ? geminiKey : "", XAI_API_KEY: "", XAI_INFERENCE_MODE: "disabled",
      GROQ_API_KEY: "", GROQ_FREE_PLAN_CONFIRMED: "false", NEXT_TELEMETRY_DISABLED: "1",
      FIS_TEST_BOUNDARY_ORIGIN: boundary.origin, FIS_AI_DAILY_BUDGET: "100",
    },
  });
  let databaseDiagnostics = 0;
  child.stdout.resume();
  child.stderr.setEncoding("utf8").on("data", (output) => {
    databaseDiagnostics += [...output.matchAll(/PrismaClient(?:Known|Unknown)RequestError|Database error|P10\d\d/g)].length;
  });
  try {
    await waitForNext(child);
    const gemini = includeGemini ? await verifyGemini() : null;
    const waves = [await load(5, boundary), await load(10, boundary)];
    console.log(JSON.stringify({ scope: "Local timed phases with a controlled upstream", waves }));
    const product = await materialAndPractice(boundary);
    const unsupported = await new Student().guest();
    const emptyCourse = await unsupported.course("No source fixture");
    const beforeUnsupported = boundary.stats.inferences + boundary.stats.geminiInferences;
    await assert.rejects(() => readStream(unsupported, "Why does a spring recover?", { courseId: emptyCourse }),
      (error) => error instanceof RequestFailure && error.status === 422 && error.code === "no_sources");
    assert.equal(boundary.stats.inferences + boundary.stats.geminiInferences, beforeUnsupported);
    const arabicMobile = includeBrowser ? await runArabicBrowser() : null;
    const recovery = await new Student().guest();
    const providerPool = await checkPoolIsolation(boundary);
    const fallback = await readStream(recovery, "fixture provider outage");
    assert.match(fallback.message, /Elasticity/);
    assert.equal(boundary.stats.routeFailures, 1);
    assert.equal(boundary.stats.openRouterRecoveryCalls, 1);
    const cancellation = await readStream(await new Student().guest(), "fixture streaming cancellation", { cutoff: true });
    assert(cancellation.canceled);
    const timeoutStudent = await new Student().guest();
    await assert.rejects(() => readStream(timeoutStudent, "fixture provider timeout", { requestHeaders: { "X-FIS-OpenRouter-Key": fixturePersonalKey } }),
      (error) => error instanceof RequestFailure && error.status === 504 && error.code === "timeout");
    await assert.rejects(() => readStream(recovery, "fixture provider quota"), (error) => error instanceof RequestFailure && error.status === 429);
    for (const student of cleanup) {
      await student.json("/api/workspace/account", "disposable account cleanup", { method: "DELETE", data: { confirmation: "DELETE" } });
      cleanup.delete(student);
    }
    const result = { scope: "Production Next.js and real local PostgreSQL/pgvector with controlled provider and Blob HTTP transports",
      product, gemini, arabicMobile, waves, providerPool, databaseDiagnostics,
      controlledFailureChecks: { fallback: includeGemini ? "Gemini to free OpenRouter" : "Verified OpenRouter route to alternate verified route", noSources: 422, quota: 429, timeout: 504, canceledStream: true }, boundary: boundary.stats };
    console.log(JSON.stringify(result, null, 2));
    assert.equal(boundary.outstandingFiles(), 0);
    assert.equal(boundary.stats.errors.length, 0, "Unexpected controlled upstream request.");
    assert(waves.every(({ success, concurrency }) => success === concurrency), "At least one controlled load wave failed.");
  } catch (error) {
    if (boundary.stats.errors.length) console.error(JSON.stringify({ controlledUpstreamErrors: boundary.stats.errors }));
    throw error;
  } finally {
    for (const student of cleanup) {
      await student.request("/api/workspace/account", { method: "DELETE", data: { confirmation: "DELETE" } }).catch(() => undefined);
    }
    if (child.exitCode === null) {
      const closed = once(child, "exit");
      child.kill();
      await closed;
    }
    boundary.close();
  }
}

main().catch((error) => {
  console.error(`Controlled product check failed: ${error.message}`);
  process.exitCode = 1;
});
