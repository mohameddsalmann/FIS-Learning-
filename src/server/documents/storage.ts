import { randomUUID } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";
import { database } from "../db/client";
import { lockOwner } from "../db/ownership";
import type { Actor } from "../auth/session";
import { WorkspaceError } from "../workspace/errors";
import { actionIdentity, beginStudyAction } from "../ai/usage";

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024;
const PDF = "application/pdf";
const PDF_SIGNATURE = Buffer.from("%PDF-");
export const documentFields = {
  id: true, title: true, sizeBytes: true, pageCount: true, status: true, error: true, learningOutline: true, updatedAt: true,
  job: { select: { state: true, processedChunks: true, totalChunks: true, createdAt: true, updatedAt: true } },
} as const;

export function blobOptions() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new WorkspaceError(503, "Private document storage is not configured.");
  return { token };
}

export function validatePdfBytes(bytes: Uint8Array) {
  if (!Buffer.from(bytes.subarray(0, PDF_SIGNATURE.length)).equals(PDF_SIGNATURE)) {
    throw new WorkspaceError(422, "This upload is not a valid PDF file.");
  }
}

export async function ownedDocument(ownerId: string, id: string) {
  const item = await database().document.findFirst({ where: { id, course: { ownerId, deletionPending: false } } });
  if (!item) throw new WorkspaceError(404, "That document is unavailable.");
  return item;
}

export async function reserveDocument(actor: Actor, courseId: string, name: string, sizeBytes: number, request?: Request) {
  blobOptions();
  if (!/\.pdf$/i.test(name) || sizeBytes > MAX_DOCUMENT_BYTES || sizeBytes < PDF_SIGNATURE.length) {
    throw new WorkspaceError(400, "Choose a PDF between 5 bytes and 20 MB.");
  }
  const pathname = `fis-documents/${randomUUID()}.pdf`;
  const title = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "-").slice(0, 150);
  return database().$transaction(async (tx) => {
    await lockOwner(tx, actor.id);
    const course = await tx.course.findFirst({ where: { id: courseId, ownerId: actor.id, deletionPending: false }, select: { id: true } });
    if (!course) throw new WorkspaceError(404, "That course is unavailable.");
    const state = await beginStudyAction(tx, actor, "upload", actionIdentity(request, { courseId, name, sizeBytes }));
    if (state.replay) {
      const document = await tx.document.findFirst({ where: { id: state.record.resultRef!, courseId, status: { not: "DELETING" } }, select: { ...documentFields, pathname: true } });
      if (!document) throw new WorkspaceError(404, "That upload reservation is no longer available.");
      const { pathname: reservedPath, ...fields } = document;
      return { document: fields, pathname: reservedPath };
    }
    const used = await tx.document.aggregate({
      where: { course: { ownerId: actor.id } },
      _count: true,
      _sum: { sizeBytes: true },
    });
    const totalBytes = actor.isAnonymous ? 40 * 1024 * 1024 : 200 * 1024 * 1024;
    if (used._count >= (actor.isAnonymous ? 5 : 30) || (used._sum.sizeBytes ?? 0) + sizeBytes > totalBytes) {
      throw new WorkspaceError(429, "Your private file quota is full. Delete material before uploading another PDF.");
    }
    const document = await tx.document.create({ data: { courseId, pathname, title, sizeBytes }, select: documentFields });
    await tx.aiAction.update({ where: { id: state.action.id }, data: { resultRef: document.id } });
    return { document, pathname };
  });
}

export async function readPrivatePdf(pathname: string, abortSignal?: AbortSignal) {
  const result = await get(pathname, { access: "private", abortSignal, ...blobOptions() });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new WorkspaceError(404, "The private PDF is unavailable.");
  }
  return result.stream;
}

async function validateBlobSignature(pathname: string) {
  const stream = await readPrivatePdf(pathname);
  const reader = stream.getReader();
  const signature = new Uint8Array(PDF_SIGNATURE.length);
  let size = 0;
  try {
    while (size < signature.length) {
      const result = await reader.read();
      if (result.done) break;
      const bytes = result.value.subarray(0, signature.length - size);
      signature.set(bytes, size);
      size += bytes.length;
    }
    validatePdfBytes(signature.subarray(0, size));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function finalizeDocument(ownerId: string, id: string) {
  const doc = await ownedDocument(ownerId, id);
  if (doc.status === "DELETING") throw new WorkspaceError(409, "This document is being deleted.");
  if (doc.status === "UPLOADING") {
    const metadata = await head(doc.pathname, blobOptions()).catch(() => {
      throw new WorkspaceError(409, "The file has not reached private storage. Upload it before continuing.");
    });
    if (metadata.size !== doc.sizeBytes || metadata.contentType !== PDF) {
      throw new WorkspaceError(422, "The uploaded file does not match the PDF reservation. Remove it and try again.");
    }
    await validateBlobSignature(doc.pathname);
    await database().$transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      const changed = await tx.document.updateMany({
        where: { id, status: "UPLOADING", course: { ownerId, deletionPending: false } }, data: { status: "PENDING", error: null },
      });
      if (changed.count) {
        await tx.documentProcessingJob.create({ data: { documentId: id } });
        await tx.aiAction.updateMany({ where: { ownerId, kind: "upload", resultRef: id, status: "running" },
          data: { status: "completed", completedAt: new Date(), lease: null, leaseUntil: null } });
      }
    });
  }
  const document = await database().document.findFirst({ where: { id, course: { ownerId, deletionPending: false } }, select: documentFields });
  if (!document || document.status === "DELETING") throw new WorkspaceError(404, "That document is unavailable.");
  return document;
}

export async function uploadDocument(actor: Actor, courseId: string, file: File, uploadId?: string) {
  if (file.size > MAX_SERVER_UPLOAD_BYTES) throw new WorkspaceError(413, "Use the direct upload route for PDFs larger than 4 MB.");
  if (file.type !== PDF) throw new WorkspaceError(400, "Choose a PDF file.");
  validatePdfBytes(new Uint8Array(await file.slice(0, PDF_SIGNATURE.length).arrayBuffer()));
  const reserved = uploadId && await ownedDocument(actor.id, uploadId);
  if (reserved && (reserved.courseId !== courseId || reserved.sizeBytes !== file.size)) {
    throw new WorkspaceError(422, "The selected PDF does not match this upload reservation.");
  }
  const reservation = reserved ? { document: reserved, pathname: reserved.pathname }
    : await reserveDocument(actor, courseId, file.name, file.size);
  if (reservation.document.status !== "UPLOADING") return finalizeDocument(actor.id, reservation.document.id);
  try {
    await put(reservation.pathname, file, {
      access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: PDF, ...blobOptions(),
    });
    return await finalizeDocument(actor.id, reservation.document.id);
  } catch (error) {
    if (reserved) {
      // A disconnected response or concurrent retry may have stored the same reserved file.
      try { return await finalizeDocument(actor.id, reserved.id); }
      catch {
        const saved = await database().document.findFirst({ where: { id: reserved.id, course: { ownerId: actor.id } }, select: { status: true } });
        if (!saved || saved.status === "DELETING") await del(reserved.pathname, blobOptions());
        throw error;
      }
    }
    try {
      const retained = await database().document.findUnique({ where: { id: reservation.document.id }, select: { id: true } });
      if (retained) await removeDocument(actor.id, reservation.document.id);
      else await del(reservation.pathname, blobOptions());
    } catch {
      // Keep the ownership record so a later deletion can retry cleanup.
    }
    throw error;
  }
}

export async function discardDocumentUpload(ownerId: string, id: string) {
  const doc = await database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const record = await tx.document.findFirst({ where: { id, course: { ownerId, deletionPending: false } }, select: { pathname: true, status: true } });
    if (!record) throw new WorkspaceError(404, "That document is unavailable.");
    if (record.status !== "UPLOADING" && record.status !== "DELETING") {
      throw new WorkspaceError(409, "This upload is already saved in your course.");
    }
    await tx.document.update({ where: { id }, data: { status: "DELETING" } });
    await tx.aiAction.updateMany({ where: { ownerId, kind: "upload", resultRef: id, status: "running" }, data: { status: "failed", lease: null, leaseUntil: null } });
    return record;
  });
  await del(doc.pathname, blobOptions());
  await database().document.deleteMany({ where: { id, status: "DELETING", course: { ownerId } } });
}

export async function removeDocument(ownerId: string, id: string) {
  const doc = await database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId, true);
    const record = await tx.document.findFirst({ where: { id, course: { ownerId } }, select: { pathname: true } });
    if (!record) throw new WorkspaceError(404, "That document is unavailable.");
    await tx.document.update({ where: { id }, data: { status: "DELETING" } });
    await tx.aiAction.updateMany({ where: { ownerId, kind: "upload", resultRef: id, status: "running" }, data: { status: "failed", lease: null, leaseUntil: null } });
    return record;
  });
  await del(doc.pathname, blobOptions());
  await database().document.deleteMany({ where: { id, course: { ownerId } } });
}

export async function removeCourseFiles(ownerId: string, courseId?: string) {
  const documents = await database().document.findMany({
    where: { course: { ownerId, ...(courseId ? { id: courseId } : {}) } }, select: { id: true },
  });
  for (const { id } of documents) await removeDocument(ownerId, id);
}
