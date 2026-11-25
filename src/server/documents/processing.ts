import { randomUUID } from "node:crypto";
import { AiError, publicAiError } from "../ai/errors";
import { embedLearningTexts } from "../ai/services";
import type { Actor } from "../auth/session";
import { studyUsage } from "../ai/usage";
import { database } from "../db/client";
import { lockOwner } from "../db/ownership";
import { Prisma } from "../db/generated/client";
import type { DocumentStatus } from "../db/generated/enums";
import { CHUNK_STRATEGY, MAX_CHUNKS, PROCESSING_VERSION, serializeVector, splitPageText } from "../rag/chunks";
import { buildDocumentOutline } from "../rag/outline";
import { WorkspaceError } from "../workspace/errors";
import { extractPdfPages } from "./pdf";
import { documentFields, ownedDocument, readPrivatePdf } from "./storage";

const LEASE_MS = 120_000;
const BATCH_SIZE = 16;

function leaseExpiry(now = new Date()) { return new Date(now.getTime() + LEASE_MS); }

export async function documentProcessingView(ownerId: string, id: string) {
  const record = await database().document.findFirst({
    where: { id, course: { ownerId, deletionPending: false } },
    select: documentFields,
  });
  if (!record) throw new WorkspaceError(404, "That document is unavailable.");
  return { document: record, job: record.job };
}

async function withLease(
  id: string, token: string, ownerId: string,
  work: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  await database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const owner = await tx.document.findFirst({
      where: { id, status: { not: "DELETING" }, course: { ownerId, deletionPending: false } }, select: { id: true },
    });
    if (!owner) throw new WorkspaceError(409, "This document is no longer available for processing.");
    const now = new Date();
    const held = await tx.documentProcessingJob.updateMany({
      where: { documentId: id, leaseToken: token, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: leaseExpiry(now) },
    });
    if (!held.count) throw new WorkspaceError(409, "The processing checkpoint changed. Refresh and continue.");
    await work(tx);
  });
}

async function setStage(id: string, token: string, ownerId: string, state: DocumentStatus, pageCount?: number) {
  await withLease(id, token, ownerId, async (tx) => {
    await tx.documentProcessingJob.update({ where: { documentId: id }, data: { state } });
    await tx.document.update({ where: { id }, data: { status: state, pageCount, error: null } });
  });
}

async function indexExtractedPageText(actor: Actor, id: string, pathname: string, token: string, signal?: AbortSignal) {
  const stream = await readPrivatePdf(pathname, signal);
  const pages = await extractPdfPages(new Uint8Array(await new Response(stream).arrayBuffer()), { signal });
  signal?.throwIfAborted();
  await setStage(id, token, actor.id, "CHUNKING", pages.length);
  const chunks = splitPageText(pages);
  if (chunks.length > MAX_CHUNKS) throw new WorkspaceError(422, "This PDF exceeds the index limit. Split it into smaller documents.");
  await withLease(id, token, actor.id, async (tx) => {
    const state = chunks.length ? "EMBEDDING" : "OCR_REQUIRED";
    if (chunks.length) {
      await tx.documentChunk.createMany({
        data: chunks.map((chunk) => ({ ...chunk, documentId: id, processingVersion: PROCESSING_VERSION, chunkStrategy: CHUNK_STRATEGY })),
        skipDuplicates: true,
      });
    }
    await tx.documentProcessingJob.update({
      where: { documentId: id }, data: {
        state, totalChunks: chunks.length, processedChunks: 0, extractedTitle: pages.find(({ title }) => title)?.title,
      },
    });
    await tx.document.update({
      where: { id },
      data: { status: state, pageCount: pages.length, error: chunks.length ? null : "No selectable text was found. Run OCR on the PDF, then upload it again." },
    });
  });
}

async function chunkScope(id: string) {
  const version = await database().documentChunk.findFirst({
    where: { documentId: id }, orderBy: { processingVersion: "desc" },
    select: { processingVersion: true, chunkStrategy: true },
  });
  if (!version) throw new WorkspaceError(409, "No passages were saved for this document. Retry the last checkpoint.");
  return { documentId: id, ...version };
}

async function indexEmbeddings(actor: Actor, doc: { id: string; courseId: string }, token: string, signal?: AbortSignal, resolveKey?: () => string | undefined, request?: Request) {
  const db = database();
  const scope = await chunkScope(doc.id);
  const [pending, ownSpace] = await Promise.all([
    db.documentChunk.findMany({
      where: { ...scope, embeddingModel: null },
      orderBy: { ordinal: "asc" }, take: BATCH_SIZE, select: { id: true, text: true, contentHash: true },
    }),
    db.documentChunk.findFirst({
      where: { ...scope, embeddingModel: { not: null } },
      select: { embeddingModel: true, embeddingDimension: true },
    }),
  ]);
  // An unindexed upload can adopt an existing space only if the entire version is cached.
  // Partial matches must not pin a new document to an old model before its first embedding.
  const [reusableSpace] = !ownSpace && pending.length ? await db.$queryRaw<{ embeddingModel: string; embeddingDimension: number }[]>`
    WITH target AS (
      SELECT DISTINCT "contentHash" FROM "DocumentChunk"
      WHERE "documentId" = ${doc.id} AND "processingVersion" = ${scope.processingVersion} AND "chunkStrategy" = ${scope.chunkStrategy}
    )
    SELECT c."embeddingModel", c."embeddingDimension"
    FROM target JOIN "DocumentChunk" c ON c."contentHash" = target."contentHash"
    JOIN "Document" d ON d."id" = c."documentId"
    JOIN "Course" p ON p."id" = d."courseId"
    WHERE p."id" = ${doc.courseId} AND p."ownerId" = ${actor.id} AND p."deletionPending" = false AND d."status" = 'READY'
      AND c."embedding" IS NOT NULL AND c."embeddingModel" IS NOT NULL AND c."embeddingDimension" IS NOT NULL
      AND c."processingVersion" = ${scope.processingVersion} AND c."chunkStrategy" = ${scope.chunkStrategy}
    GROUP BY c."embeddingModel", c."embeddingDimension"
    HAVING count(DISTINCT c."contentHash") = (SELECT count(*) FROM target)
    ORDER BY c."embeddingModel", c."embeddingDimension" LIMIT 1
  ` : [];
  const space = ownSpace ?? reusableSpace;
  const vectors = new Map<string, string>();
  if (space?.embeddingModel && space.embeddingDimension && pending.length) {
    const cached = await db.$queryRaw<{ contentHash: string; vector: string }[]>`
      SELECT DISTINCT ON (c."contentHash") c."contentHash", c."embedding"::text AS vector
      FROM "DocumentChunk" c JOIN "Document" d ON d."id" = c."documentId"
      JOIN "Course" p ON p."id" = d."courseId"
      WHERE p."id" = ${doc.courseId} AND p."ownerId" = ${actor.id} AND p."deletionPending" = false AND d."status" = 'READY'
        AND c."embeddingModel" = ${space.embeddingModel} AND c."embeddingDimension" = ${space.embeddingDimension}
        AND c."embedding" IS NOT NULL AND c."processingVersion" = ${scope.processingVersion} AND c."chunkStrategy" = ${scope.chunkStrategy}
        AND c."contentHash" IN (${Prisma.join(pending.map((chunk) => chunk.contentHash))})
    `;
    for (const { contentHash, vector } of cached) vectors.set(contentHash, vector);
  }
  const missing = pending.filter(({ contentHash }) => !vectors.has(contentHash));
  let model = space?.embeddingModel ?? null;
  let dimension = space?.embeddingDimension ?? null;
  let useTextIndex = false;
  if (missing.length) {
    const usage = studyUsage(actor, request, doc.id);
    const embedded = await embedLearningTexts(missing.map(({ text }) => text),
      usage.authorizeAttempt, signal, model || undefined, resolveKey?.(), { ...usage, openRouterOnly: request?.headers.has("x-fis-openrouter-key") }).catch((error: unknown) => {
        if (signal?.aborted) throw error;
        if (error instanceof WorkspaceError && error.status === 429 || error instanceof AiError && [
          "no_free_route", "not_configured", "invalid_credentials", "rate_limited", "provider_budget", "unavailable", "timeout", "billing_unavailable", "provider_busy",
        ].includes(error.code)) return null;
        throw error;
      });
    if (!embedded) useTextIndex = true;
    else {
      if (embedded.vectors.length !== missing.length || (model && embedded.model !== model)) {
        throw new WorkspaceError(503, "A compatible free embedding model is unavailable. Continue when it returns.");
      }
      model = embedded.model;
      dimension ??= embedded.vectors[0]?.length ?? null;
      for (const [index, chunk] of missing.entries()) {
        const vector = embedded.vectors[index];
        if (vector.length !== dimension) throw new WorkspaceError(503, "The embedding dimensions did not match this document index.");
        vectors.set(chunk.contentHash, serializeVector(vector));
      }
    }
  }
  signal?.throwIfAborted();
  await withLease(doc.id, token, actor.id, async (tx) => {
    for (const chunk of pending) {
      const vector = vectors.get(chunk.contentHash);
      if (!vector && useTextIndex) continue;
      if (!vector || !model || !dimension) throw new WorkspaceError(503, "The vector batch was incomplete.");
      await tx.$executeRaw`
        UPDATE "DocumentChunk"
        SET "embedding" = ${vector}::vector, "embeddingModel" = ${model}, "embeddingDimension" = ${dimension}, "updatedAt" = now()
        WHERE "id" = ${chunk.id} AND "documentId" = ${doc.id} AND "embeddingModel" IS NULL
      `;
    }
    const [processedChunks, totalChunks] = await Promise.all([
      tx.documentChunk.count({ where: { ...scope, embeddingModel: { not: null } } }),
      tx.documentChunk.count({ where: scope }),
    ]);
    const state = useTextIndex || processedChunks === totalChunks ? "INDEXING" : "EMBEDDING";
    await tx.documentProcessingJob.update({
      where: { documentId: doc.id }, data: { processedChunks, totalChunks, state },
    });
    await tx.document.update({ where: { id: doc.id }, data: { status: state, error: null } });
  });
}

async function verifyTextIndex(actor: Actor, id: string, token: string, totalChunks: number) {
  const scope = await chunkScope(id);
  await withLease(id, token, actor.id, async (tx) => {
    const [result] = await tx.$queryRaw<{ indexed: boolean }[]>`
      SELECT count(*) = ${totalChunks} AND bool_and("searchVector" IS NOT NULL) AS indexed
      FROM "DocumentChunk" WHERE "documentId" = ${id}
        AND "processingVersion" = ${scope.processingVersion} AND "chunkStrategy" = ${scope.chunkStrategy}
    `;
    if (!result?.indexed) throw new WorkspaceError(503, "The saved text index could not be verified. Retry the last checkpoint.");
    await tx.documentProcessingJob.update({ where: { documentId: id }, data: { state: "PREPARING_SUGGESTIONS" } });
    await tx.document.update({ where: { id }, data: { status: "PREPARING_SUGGESTIONS" } });
  });
}

async function prepareSuggestions(actor: Actor, doc: { id: string; title: string }, token: string, signal?: AbortSignal) {
  const chunks = await database().documentChunk.findMany({
    where: await chunkScope(doc.id), orderBy: { ordinal: "asc" }, select: { text: true, page: true, contentHash: true },
  });
  const learningOutline = buildDocumentOutline({ title: doc.title, chunks });
  signal?.throwIfAborted();
  await withLease(doc.id, token, actor.id, async (tx) => {
    await tx.documentProcessingJob.update({ where: { documentId: doc.id }, data: { state: "READY" } });
    await tx.document.update({ where: { id: doc.id }, data: { status: "READY", learningOutline, error: null } });
  });
}

export async function continueDocumentProcessing(
  actor: Actor, id: string, signal?: AbortSignal, resolveKey?: () => string | undefined, language: "en" | "ar" = "en", request?: Request,
) {
  const document = await ownedDocument(actor.id, id);
  if (["READY", "OCR_REQUIRED"].includes(document.status)) return documentProcessingView(actor.id, id);
  if (["UPLOADING", "DELETING"].includes(document.status)) {
    throw new WorkspaceError(409, "Finish the PDF upload before continuing with processing.");
  }
  const db = database();
  const job = await db.documentProcessingJob.findUnique({ where: { documentId: id } });
  if (!job) throw new WorkspaceError(409, "This document has no upload checkpoint yet.");
  if (signal?.aborted) throw new WorkspaceError(503, "Processing was interrupted. Retry to continue from the last checkpoint.");
  const now = new Date();
  const token = randomUUID();
  const step = job.state === "INDEXING" || job.state === "PREPARING_SUGGESTIONS" ? job.state
    : !job.totalChunks ? "EXTRACTING" : job.processedChunks === job.totalChunks ? "INDEXING" : "EMBEDDING";
  const claimed = await db.documentProcessingJob.updateMany({
    where: {
      documentId: id, state: job.state, processedChunks: job.processedChunks,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: { leaseToken: token, leaseExpiresAt: leaseExpiry(now), state: step },
  });
  if (!claimed.count) {
    throw new WorkspaceError(409, "Another request is processing this PDF. Checking its saved status.", 2);
  }
  try {
    await withLease(id, token, actor.id, async (tx) => {
      await tx.document.update({ where: { id }, data: { status: step, error: null } });
    });
    if (step === "EXTRACTING") await indexExtractedPageText(actor, id, document.pathname, token, signal);
    else if (step === "EMBEDDING") await indexEmbeddings(actor, document, token, signal, resolveKey, request);
    else if (step === "INDEXING") await verifyTextIndex(actor, id, token, job.totalChunks);
    else await prepareSuggestions(actor, { id, title: job.extractedTitle || document.title }, token, signal);
    return await documentProcessingView(actor.id, id);
  } catch (error) {
    if (signal?.aborted) throw new WorkspaceError(503, "Processing was interrupted. Retry to continue from the last checkpoint.");
    if (error instanceof WorkspaceError && (error.status === 409 || error.status === 429)) throw error;
    if (error instanceof AiError && error.code === "rate_limited") {
      throw new WorkspaceError(429, publicAiError(error, language).error, error.retryAfter);
    }
    const message = error instanceof WorkspaceError ? error.message : error instanceof AiError
      ? publicAiError(error, language).error : "Processing paused. Continue to retry the last checkpoint.";
    await withLease(id, token, actor.id, async (tx) => {
      await tx.document.update({ where: { id }, data: { status: "FAILED", error: message } });
    }).catch(() => undefined);
    return documentProcessingView(actor.id, id);
  } finally {
    await db.documentProcessingJob.updateMany({
      where: { documentId: id, leaseToken: token }, data: { leaseToken: null, leaseExpiresAt: null },
    }).catch(() => undefined);
  }
}
