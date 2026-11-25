import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { optionalOpenRouterKey } from "@/server/ai/gateway";
import { requestLanguage } from "@/server/ai/requests";
import { requireActor } from "@/server/auth/session";
import { database } from "@/server/db/client";
import { continueDocumentProcessing, documentProcessingView } from "@/server/documents/processing";
import {
  blobOptions, discardDocumentUpload, finalizeDocument, MAX_DOCUMENT_BYTES, MAX_SERVER_UPLOAD_BYTES,
  ownedDocument, readPrivatePdf, removeDocument, reserveDocument, uploadDocument,
} from "@/server/documents/storage";
import { apiError, apiJson, WorkspaceError } from "@/server/workspace/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ segments?: string[] }> };
const identifier = z.string().min(1).max(128);
const reservation = z.object({
  courseId: identifier,
  name: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().min(5).max(MAX_DOCUMENT_BYTES),
});

async function smallMultipart(request: Request) {
  const maximum = MAX_SERVER_UPLOAD_BYTES + 65_536;
  if (Number(request.headers.get("Content-Length")) > maximum) {
    throw new WorkspaceError(413, "Use direct upload for files larger than 4 MB.");
  }
  const contentType = request.headers.get("Content-Type");
  if (!contentType?.startsWith("multipart/form-data;") || !request.body) {
    throw new WorkspaceError(400, "Choose a PDF and a course.");
  }
  const reader = request.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.length;
      if (total > maximum) throw new WorkspaceError(413, "Use direct upload for files larger than 4 MB.");
      chunks.push(result.value);
    }
    const parsed = new Response(Buffer.concat(chunks, total), { headers: { "Content-Type": contentType } });
    return await parsed.formData().catch(() => { throw new WorkspaceError(400, "This multipart upload was not valid."); });
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function uploadToken(request: Request) {
  const body = await request.json() as HandleUploadBody;
  return apiJson(await handleUpload({
    body, request, ...blobOptions(),
    async onBeforeGenerateToken(pathname, clientPayload) {
      const actor = await requireActor(request);
      const document = await ownedDocument(actor.id, identifier.parse(clientPayload));
      if (document.pathname !== pathname || document.status !== "UPLOADING"
          || Date.now() - document.createdAt.getTime() > 60 * 60_000) {
        throw new WorkspaceError(403, "This upload reservation has expired or is unavailable.");
      }
      return {
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: document.sizeBytes,
        addRandomSuffix: false,
        allowOverwrite: false,
        validUntil: Date.now() + 5 * 60_000,
        tokenPayload: document.id,
      };
    },
    async onUploadCompleted({ blob, tokenPayload }) {
      const id = identifier.parse(tokenPayload);
      const doc = await database().document.findUnique({ where: { id }, select: {
        pathname: true, status: true, course: { select: { ownerId: true, deletionPending: true } },
      } });
      if (!doc || doc.status === "DELETING" || doc.course.deletionPending) await del(blob.pathname, blobOptions());
      else if (doc.pathname === blob.pathname && doc.status === "UPLOADING") await finalizeDocument(doc.course.ownerId, id);
    },
  }));
}

export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireActor(request);
    const [id, action, chunkId, extra] = (await params).segments ?? [];
    if (!id || extra) throw new WorkspaceError(404, "That document is unavailable.");
    if (!action) return apiJson(await documentProcessingView(actor.id, identifier.parse(id)));
    if (id === "uploads" && !chunkId) {
      const uploadId = identifier.parse(action);
      const reservation = await ownedDocument(actor.id, uploadId);
      if (reservation.status === "DELETING") throw new WorkspaceError(404, "That upload is unavailable.");
      const { document } = await documentProcessingView(actor.id, uploadId);
      return apiJson({ document, pathname: reservation.status === "UPLOADING" ? reservation.pathname : "" });
    }
    const record = await ownedDocument(actor.id, identifier.parse(id));
    if (action === "chunks" && chunkId) {
      const chunk = await database().documentChunk.findFirst({
        where: { id: identifier.parse(chunkId), documentId: id, document: { status: "READY", course: { ownerId: actor.id } } },
        select: { text: true, page: true },
      });
      if (!chunk) throw new WorkspaceError(404, "That source is unavailable.");
      return apiJson({ chunk, document: { id, title: record.title } });
    }
    if (action !== "file" || chunkId || ["UPLOADING", "DELETING"].includes(record.status)) {
      throw new WorkspaceError(404, "That private file is unavailable.");
    }
    return new Response(await readPrivatePdf(record.pathname), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(record.title).replace(/[()'*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
        "Cache-Control": "private, no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const [id, action, extra] = (await params).segments ?? [];
    if (extra) throw new WorkspaceError(404, "That document operation is unavailable.");
    if (id === "uploads" && action === "token") return await uploadToken(request);
    const actor = await requireActor(request);
    if (id === "uploads" && !action) {
      const input = reservation.parse(await request.json());
      return apiJson(await reserveDocument(actor, input.courseId, input.name, input.sizeBytes, request), 201);
    }
    if (!id) {
      const form = await smallMultipart(request);
      const file = form.get("file");
      if (!(file instanceof File) || form.getAll("file").length !== 1) throw new WorkspaceError(400, "Choose one PDF file.");
      const courseId = identifier.parse(form.get("courseId"));
      const uploadId = identifier.nullable().parse(form.get("uploadId"));
      return apiJson({ document: await uploadDocument(actor, courseId, file, uploadId ?? undefined) }, 201);
    }
    if (action === "finalize") return apiJson({ document: await finalizeDocument(actor.id, identifier.parse(id)) });
    if (action === "process") {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]);
      return apiJson(await continueDocumentProcessing(actor, identifier.parse(id), signal,
        () => optionalOpenRouterKey(request), requestLanguage(request), request));
    }
    throw new WorkspaceError(404, "That document operation is unavailable.");
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const actor = await requireActor(request);
    const [id, action, ...extra] = (await params).segments ?? [];
    if (extra.length || action && id !== "uploads") throw new WorkspaceError(404, "That document is unavailable.");
    if (id === "uploads") await discardDocumentUpload(actor.id, identifier.parse(action));
    else await removeDocument(actor.id, identifier.parse(id));
    return apiJson({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
