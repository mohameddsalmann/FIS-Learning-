import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../src/server/db/client";
import { extractPdfPages } from "../src/server/documents/pdf";
import { CHUNK_STRATEGY, LEGACY_CHUNK_STRATEGY, LEGACY_PROCESSING_VERSION, PROCESSING_VERSION, serializeVector } from "../src/server/rag/chunks";
import { buildDocumentOutline } from "../src/server/rag/outline";
import { retrieveCourseSources } from "../src/server/rag/retrieval";

function makePdf() {
  const stream = [
    "BT /F1 18 Tf 40 720 Td (Lens Measurements) Tj ET",
    "BT /F1 10 Tf 40 685 Td (Blue) Tj ET",
    "BT /F1 10 Tf 190 685 Td (4 cm) Tj ET",
    "BT /F1 10 Tf 40 670 Td (Red) Tj ET",
    "BT /F1 10 Tf 190 670 Td (7 cm) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Title (Color and Focus) >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

it("reads the actual PDF title, heading boundary and two table rows", async () => {
  const [page] = await extractPdfPages(makePdf());
  expect(page).toMatchObject({ page: 1, title: "Color and Focus" });
  expect(page.text).toMatch(/Lens Measurements\s*\n\s*Blue\s*\|\s*4 cm\s*\n\s*Red\s*\|\s*7 cm/u);
});

const isolated = process.env.FIS_INTEGRATION_DATABASE === "isolated" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(URL.parse(process.env.DATABASE_URL || "")?.hostname ?? "");

describe.runIf(isolated)("version-compatible course retrieval", () => {
  const ownerId = randomUUID();
  const model = "fixture/rag-current-v1";
  let courseId: string;
  let primaryId: string;
  let neighborId: string;
  let legacyId: string;

  beforeAll(async () => {
    const db = database();
    await db.user.create({ data: { id: ownerId, name: "Fixture learner", email: `${ownerId}@test.invalid`, isAnonymous: true } });
    const course = await db.course.create({ data: { ownerId, title: "Versioned optics" } });
    courseId = course.id;
    const modern = await db.document.create({ data: {
      courseId, title: "Modern", status: "READY", sizeBytes: 1, pathname: `test/${ownerId}/modern`, pageCount: 2,
    } });
    const old = await db.document.create({ data: {
      courseId, title: "Legacy", status: "READY", sizeBytes: 1, pathname: `test/${ownerId}/legacy`, pageCount: 1,
    } });
    const primary = await db.documentChunk.create({ data: {
      documentId: modern.id, page: 1, ordinal: 0, text: "Conical lenses focus incoming light.",
      contentHash: randomUUID(), processingVersion: PROCESSING_VERSION, chunkStrategy: CHUNK_STRATEGY,
    } });
    primaryId = primary.id;
    const neighbor = await db.documentChunk.create({ data: {
      documentId: modern.id, page: 1, ordinal: 1, text: "The measurements were performed in water.",
      contentHash: randomUUID(), processingVersion: PROCESSING_VERSION, chunkStrategy: CHUNK_STRATEGY,
    } });
    neighborId = neighbor.id;
    const legacy = await db.documentChunk.create({ data: {
      documentId: old.id, page: 1, ordinal: 0, text: "Diffraction is the spreading of waves.",
      contentHash: randomUUID(), processingVersion: LEGACY_PROCESSING_VERSION, chunkStrategy: LEGACY_CHUNK_STRATEGY,
    } });
    legacyId = legacy.id;
    await db.documentChunk.create({ data: {
      documentId: old.id, page: 1, ordinal: 1, text: primary.text,
      contentHash: primary.contentHash, processingVersion: LEGACY_PROCESSING_VERSION, chunkStrategy: LEGACY_CHUNK_STRATEGY,
    } });
    await db.$executeRaw`
      UPDATE "DocumentChunk" SET "embedding" = ${serializeVector([1, 0, 0])}::vector, "embeddingModel" = ${model}, "embeddingDimension" = 3
      WHERE "id" = ${primaryId}
    `;
    await db.$executeRaw`
      UPDATE "DocumentChunk" SET "embedding" = ${serializeVector([0, 1, 0, 0])}::vector, "embeddingModel" = 'fixture/different-space', "embeddingDimension" = 4
      WHERE "id" = ${legacyId}
    `;
  });

  afterAll(async () => {
    if (isolated) await database().user.deleteMany({ where: { id: ownerId } });
  });

  it("retrieves legacy keyword evidence without mixing model vectors", async () => {
    let calls = 0;
    const found = await retrieveCourseSources(ownerId, courseId, "What is diffraction?", async () => {
      calls++;
      throw new Error("Fixture provider unavailable");
    });
    expect(found.map(({ id }) => id)).toEqual([legacyId]);
    expect(calls).toBe(1);
  });

  it("expands adjacent same-page evidence and deduplicates the same content in another document", async () => {
    const found = await retrieveCourseSources(ownerId, courseId, "Conical lenses focus", async (_texts, selectedModel) => ({
      model: selectedModel ?? "", vectors: [selectedModel === model ? [1, 0, 0] : [0, 0, 1, 0]],
    }));
    expect(found.map(({ id }) => id)).toEqual([primaryId, neighborId]);
  });

  it("keeps a canonical search entry for an identical indexed document", async () => {
    const db = database();
    const primary = await db.documentChunk.findUniqueOrThrow({ where: { id: primaryId } });
    const chunks = await db.documentChunk.findMany({ where: { documentId: primary.documentId }, orderBy: { ordinal: "asc" } });
    await db.document.update({ where: { id: primary.documentId }, data: {
      learningOutline: buildDocumentOutline({ title: "Modern", chunks }),
    } });
    const duplicate = await db.document.create({ data: {
      courseId, title: "Duplicate", status: "READY", sizeBytes: 1, pathname: `test/${ownerId}/duplicate`, pageCount: 2,
      learningOutline: buildDocumentOutline({ title: "Duplicate", chunks }),
    } });
    await db.documentChunk.createMany({ data: chunks.map(({ contentHash, page, ordinal, text }) => ({
      id: `a-duplicate-${ownerId}-${ordinal}`, documentId: duplicate.id, contentHash, page, ordinal, text,
      chunkStrategy: CHUNK_STRATEGY, processingVersion: PROCESSING_VERSION,
    })) });
    const found = await retrieveCourseSources(ownerId, courseId, "Conical lenses focus", async (_texts, selectedModel) => ({
      model: selectedModel ?? "", vectors: [selectedModel === model ? [-1, 0, 0] : [-1, -1, -1, -1]],
    }));
    expect(found.map(({ id }) => id)).toEqual([primaryId, neighborId]);
  });

  it("keeps the fused sources when a selected reranker is unavailable", async () => {
    const db = database();
    const course = await db.course.create({ data: { ownerId, title: "Controlled elasticity" } });
    const document = await db.document.create({ data: {
      courseId: course.id, title: "Elasticity", status: "READY", sizeBytes: 1, pathname: `test/${ownerId}/elasticity`, pageCount: 6,
    } });
    const passages = ["Spring elasticity restores its shape.", "A coil can shorten under load.", "Glass is brittle.",
      "Some rods bend when pushed.", "A ruler can flex at the edge.", "Rubber stretches under force."];
    for (const [index, text] of passages.entries()) {
      const chunk = await db.documentChunk.create({ data: {
        documentId: document.id, page: index + 1, ordinal: index, text, contentHash: randomUUID(),
        chunkStrategy: CHUNK_STRATEGY, processingVersion: PROCESSING_VERSION,
      } });
      const vector = serializeVector(index === 0 ? [0.8, 0.6, 0] : index === 1 ? [1, 0, 0] : [0.9, 0.1, 0]);
      await db.$executeRaw`UPDATE "DocumentChunk" SET "embedding" = ${vector}::vector, "embeddingModel" = ${model}, "embeddingDimension" = 3 WHERE "id" = ${chunk.id}`;
    }
    const embedding = async () => ({ model, vectors: [[1, 0, 0]] });
    const fused = await retrieveCourseSources(ownerId, course.id, "spring elasticity", embedding);
    let failures = 0;
    const fallback = await retrieveCourseSources(ownerId, course.id, "spring elasticity", embedding, { evaluationRerank: async () => {
      failures++;
      throw new Error("Controlled reranker unavailable");
    } });
    expect(failures).toBe(1);
    expect(fallback).toEqual(fused);
    expect(fallback[0]?.page).toBe(1);
  });
});
