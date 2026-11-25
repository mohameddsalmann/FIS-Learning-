import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../src/server/ai/errors";
import { database } from "../src/server/db/client";
import { authorizeTopic } from "../src/server/workspace/learning";
import { createCourse } from "../src/server/workspace/courses";
import { continueDocumentProcessing } from "../src/server/documents/processing";
import { discardDocumentUpload, finalizeDocument, ownedDocument, readPrivatePdf, removeDocument, reserveDocument, uploadDocument } from "../src/server/documents/storage";

const storage = vi.hoisted(() => new Map<string, File>());
const provider = vi.hoisted(() => ({ calls: 0, beforeEmbedding: undefined as (() => void) | undefined }));

vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, file: File, options: Record<string, unknown>) => {
    if (options.access !== "private" || options.allowOverwrite !== false) throw new Error("Unsafe Blob write.");
    storage.set(pathname, file);
  },
  head: async (pathname: string) => {
    const file = storage.get(pathname);
    if (!file) throw new Error("Missing file.");
    return { size: file.size, contentType: file.type };
  },
  get: async (pathname: string, options: Record<string, unknown>) => {
    if (options.access !== "private") throw new Error("Unsafe Blob read.");
    const file = storage.get(pathname);
    return file ? { statusCode: 200, stream: file.stream() } : null;
  },
  del: async (pathname: string) => { storage.delete(pathname); },
}));

vi.mock("../src/server/ai/services", () => ({
  embedLearningTexts: async (texts: string[], authorize: (capability: string) => Promise<void>, signal?: AbortSignal) => {
    provider.beforeEmbedding?.();
    signal?.throwIfAborted();
    await authorize("embeddings");
    provider.calls++;
    return { model: "fixture/embedded-source:free", vectors: texts.map(() => [1, 0.1, 0.01]) };
  },
}));

const isolation = process.env.FIS_INTEGRATION_DATABASE === "isolated" && (() => {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL || "").hostname); }
  catch { return false; }
})();

function samplePdf(text: boolean) {
  const graphics = text ? "BT /F1 20 Tf 40 720 Td (Plants use light for photosynthesis.) Tj ET" : "40 45 50 50 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${graphics.length} >>\nstream\n${graphics}\nendstream`,
    "<< /Title (Botany lab) >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = pdf.length;
  pdf += "xref\n0 7\n0000000000 65535 f \n"
    + offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
    + `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new File([pdf], text ? "reading.pdf" : "scan.pdf", { type: "application/pdf" });
}

describe.runIf(Boolean(isolation))("private PDF and durable processing checkpoints", () => {
  const actor = { id: "", isAnonymous: true };
  const stranger = { id: "", isAnonymous: true };
  let courseId: string;
  let previousToken: string | undefined;
  beforeEach(async () => {
    actor.id = randomUUID();
    stranger.id = randomUUID();
    provider.calls = 0;
    provider.beforeEmbedding = undefined;
    previousToken = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "isolated-fixture";
    await database().user.createMany({ data: [actor, stranger].map((owner) => ({
      id: owner.id, name: "PDF fixture learner", email: `${owner.id}@test.invalid`, isAnonymous: true,
    })) });
    courseId = (await createCourse(actor, "Private course", "Controlled PDF ingestion test")).id;
  });
  afterEach(async () => {
    if (previousToken) process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    else delete process.env.BLOB_READ_WRITE_TOKEN;
    await database().user.deleteMany({ where: { id: { in: [actor.id, stranger.id] } } });
    storage.clear();
  });
  it("validates, stores privately, extracts actual PDF.js text, and embeds on a bounded repeat-safe step", async () => {
    const doc = await uploadDocument(actor, courseId, samplePdf(true));
    expect(doc.status).toBe("PENDING");
    await expect(ownedDocument(stranger.id, doc.id)).rejects.toMatchObject({ status: 404 });
    await expect(continueDocumentProcessing(stranger, doc.id)).rejects.toMatchObject({ status: 404 });
    const stored = await ownedDocument(actor.id, doc.id);
    const bytes = await new Response(await readPrivatePdf(stored.pathname)).text();
    expect(bytes).toMatch(/^%PDF/);
    const extraction = await continueDocumentProcessing(actor, doc.id);
    expect(extraction.document).toMatchObject({ status: "EMBEDDING", pageCount: 1, error: null });
    expect(extraction.job).toMatchObject({ processedChunks: 0, totalChunks: 1 });
    expect(provider.calls).toBe(0);
    const indexing = await continueDocumentProcessing(actor, doc.id);
    expect(indexing.document.status).toBe("INDEXING");
    expect(indexing.job).toMatchObject({ processedChunks: 1, totalChunks: 1 });
    expect((await continueDocumentProcessing(actor, doc.id)).document.status).toBe("PREPARING_SUGGESTIONS");
    const ready = await continueDocumentProcessing(actor, doc.id);
    expect(ready.document).toMatchObject({ status: "READY", learningOutline: {
      title: "Botany lab", suggestions: expect.arrayContaining([expect.objectContaining({ kind: "explain", page: 1 })]),
    } });
    expect(provider.calls).toBe(1);
    expect((await continueDocumentProcessing(actor, doc.id)).document.status).toBe("READY");
    expect(provider.calls).toBe(1);
    expect(await database().documentChunk.findFirst({ where: { documentId: doc.id }, select: { text: true, page: true, embeddingDimension: true } }))
      .toEqual({ text: "Plants use light for photosynthesis.", page: 1, embeddingDimension: 3 });
    await removeDocument(actor.id, doc.id);
    expect(storage.has(stored.pathname)).toBe(false);
    expect(await database().documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
  });

  it("reports OCR-required and rejects cross-owner uploads before storing a file", async () => {
    await expect(uploadDocument(stranger, courseId, samplePdf(false))).rejects.toMatchObject({ status: 404 });
    const document = await uploadDocument(actor, courseId, samplePdf(false));
    const result = await continueDocumentProcessing(actor, document.id);
    expect(result.document.status).toBe("OCR_REQUIRED");
    expect(result.document.error).toContain("OCR");
    expect(result.job?.totalChunks).toBe(0);
    expect(provider.calls).toBe(0);
    await removeDocument(actor.id, document.id);
  });

  it("recovers a reserved private upload by id and protects a saved PDF from draft deletion", async () => {
    const file = samplePdf(true);
    const request = new Request("http://localhost", { headers: { "Idempotency-Key": randomUUID() } });
    const [draft, replayed] = await Promise.all([
      reserveDocument(actor, courseId, file.name, file.size, request),
      reserveDocument(actor, courseId, file.name, file.size, request),
    ]);
    expect(replayed.document.id).toBe(draft.document.id);
    expect(draft.document.status).toBe("UPLOADING");
    await expect(discardDocumentUpload(stranger.id, draft.document.id)).rejects.toMatchObject({ status: 404 });
    await expect(finalizeDocument(actor.id, draft.document.id)).rejects.toMatchObject({ status: 409 });
    const saved = await uploadDocument(actor, courseId, file, draft.document.id);
    expect(saved).toMatchObject({ id: draft.document.id, status: "PENDING" });
    expect((await uploadDocument(actor, courseId, file, draft.document.id)).id).toBe(saved.id);
    expect(await database().documentProcessingJob.count({ where: { documentId: saved.id } })).toBe(1);
    await expect(discardDocumentUpload(actor.id, saved.id)).rejects.toMatchObject({ status: 409 });
    expect(storage.has(draft.pathname)).toBe(true);
    await removeDocument(actor.id, saved.id);
  });

  it("persists distinct invalid-PDF guidance when PDF.js cannot extract a signature-valid file", async () => {
    const file = new File(["%PDF-1.4\ninvalid body\n"], "broken.pdf", { type: "application/pdf" });
    const document = await uploadDocument(actor, courseId, file);
    const result = await continueDocumentProcessing(actor, document.id);
    expect(result.document).toMatchObject({ status: "FAILED", error: expect.stringContaining("unlocked PDF") });
    expect(result.job).toMatchObject({ state: "EXTRACTING", totalChunks: 0 });
    await removeDocument(actor.id, document.id);
  });

  it("verifies a searchable text index and prepares grounded prompts when the free embedding route is unavailable", async () => {
    const { id } = await uploadDocument(actor, courseId, samplePdf(true));
    await continueDocumentProcessing(actor, id);
    provider.beforeEmbedding = () => { throw new AiError("no_free_route"); };
    try {
      expect(await continueDocumentProcessing(actor, id)).toMatchObject({
        document: { status: "INDEXING" }, job: { processedChunks: 0, totalChunks: 1 },
      });
    } finally {
      provider.beforeEmbedding = undefined;
    }
    expect((await continueDocumentProcessing(actor, id)).document.status).toBe("PREPARING_SUGGESTIONS");
    expect(await continueDocumentProcessing(actor, id)).toMatchObject({
      document: { status: "READY", learningOutline: { title: "Botany lab" } }, job: { processedChunks: 0, totalChunks: 1 },
    });
    await removeDocument(actor.id, id);
  });

  it("releases the checkpoint lease after cancellation and resumes without re-extracting", async () => {
    const { id } = await uploadDocument(actor, courseId, samplePdf(true));
    await continueDocumentProcessing(actor, id);
    const chunk = await database().documentChunk.findFirstOrThrow({ where: { documentId: id }, select: { id: true } });
    const controller = new AbortController();
    provider.beforeEmbedding = () => controller.abort();
    try {
      await expect(continueDocumentProcessing(actor, id, controller.signal)).rejects.toMatchObject({ status: 503 });
    } finally {
      provider.beforeEmbedding = undefined;
    }
    expect(await database().documentProcessingJob.findUniqueOrThrow({ where: { documentId: id } })).toMatchObject({
      state: "EMBEDDING", processedChunks: 0, leaseToken: null, leaseExpiresAt: null,
    });
    expect((await continueDocumentProcessing(actor, id)).document.status).toBe("INDEXING");
    expect(await database().documentChunk.findUnique({ where: { id: chunk.id } })).not.toBeNull();
    await removeDocument(actor.id, id);
  });

  it("rejects a topic ID scoped to a different course or owner", async () => {
    const topic = await database().topic.findFirstOrThrow({ where: { courseId }, select: { id: true } });
    await expect(authorizeTopic(stranger.id, courseId, topic.id)).rejects.toMatchObject({ status: 404 });
  });

  it("reuses a complete same-course version from the first batch without another embedding call", async () => {
    const before = provider.calls;
    const uploaded: string[] = [];
    try {
      for (const expectedCalls of [before + 1, before + 1]) {
        const document = await uploadDocument(actor, courseId, samplePdf(true));
        uploaded.push(document.id);
        await continueDocumentProcessing(actor, document.id);
        expect(await continueDocumentProcessing(actor, document.id)).toMatchObject({
          document: { status: "INDEXING" }, job: { processedChunks: 1, totalChunks: 1 },
        });
        await continueDocumentProcessing(actor, document.id);
        expect(await continueDocumentProcessing(actor, document.id)).toMatchObject({
          document: { status: "READY", learningOutline: { title: "Botany lab" } },
        });
        expect(provider.calls).toBe(expectedCalls);
      }
    } finally {
      for (const id of uploaded) await removeDocument(actor.id, id);
    }
  });
});
