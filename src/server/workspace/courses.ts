import type { Actor } from "../auth/session";
import { database } from "../db/client";
import { Prisma } from "../db/generated/client";
import { lockOwner } from "../db/ownership";
import { documentFields, removeCourseFiles } from "../documents/storage";
import { assertOwnedCourse } from "../rag/retrieval";
import { buildDocumentOutline, refreshDocumentSuggestions } from "../rag/outline";
import { WorkspaceError } from "./errors";

const courseFields = { id: true, title: true, description: true, createdAt: true, updatedAt: true } as const;
const topicFields = { id: true, title: true, position: true } as const;
const progressFields = { id: true, topicId: true, attempts: true, correct: true, total: true, updatedAt: true, topic: { select: { title: true, courseId: true } } } as const;

export function listCourses(ownerId: string) {
  return database().course.findMany({
    where: { ownerId, deletionPending: false },
    orderBy: { updatedAt: "desc" },
    select: { ...courseFields, _count: { select: { documents: true, conversations: true, quizzes: true, topics: true } } },
  });
}

export async function createCourse(actor: Actor, title: string, description: string, firstTopic?: string) {
  return database().$transaction(async (tx) => {
    await lockOwner(tx, actor.id);
    const count = await tx.course.count({ where: { ownerId: actor.id } });
    if (count >= (actor.isAnonymous ? 3 : 50)) throw new WorkspaceError(429, "Your course limit is full.");
    return tx.course.create({
      data: { ownerId: actor.id, title, description, topics: { create: { title: firstTopic || "Overview" } } },
      select: courseFields,
    });
  });
}

export async function courseRecord(ownerId: string, id: string) {
  const course = await database().course.findFirst({
    where: { id, ownerId, deletionPending: false },
    select: {
      ...courseFields,
      documents: { where: { status: { not: "DELETING" } }, select: documentFields, orderBy: { createdAt: "desc" } },
      topics: { select: topicFields, orderBy: { position: "asc" } },
      conversations: { select: { id: true, title: true, updatedAt: true }, take: 12, orderBy: { updatedAt: "desc" } },
      quizzes: { select: { id: true, title: true, createdAt: true }, take: 20, orderBy: { createdAt: "desc" } },
    },
  });
  if (!course) throw new WorkspaceError(404, "That course is unavailable.");
  const { documents, topics, conversations, quizzes, ...fields } = course;
  const legacy = documents.filter(({ status, learningOutline }) => status === "READY" && !learningOutline);
  const db = database();
  const [progress, openingPassages] = await Promise.all([
    db.topicProgress.findMany({ where: { ownerId, topic: { courseId: id, course: { ownerId } } }, select: progressFields }),
    legacy.length ? db.$queryRaw<{ documentId: string; page: number; text: string }[]>`
      SELECT DISTINCT ON (c."documentId") c."documentId", c."page", c."text"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d.id = c."documentId"
      JOIN "Course" p ON p.id = d."courseId"
      WHERE p.id = ${id} AND p."ownerId" = ${ownerId} AND p."deletionPending" = false AND d.status = 'READY'
        AND c."documentId" IN (${Prisma.join(legacy.map((document) => document.id))})
      ORDER BY c."documentId", c."processingVersion" DESC, c."ordinal"
    ` : [],
  ]);
  const passages = new Map(openingPassages.map((passage) => [passage.documentId, passage]));
  const courseDocuments = documents.map((document) => {
    const passage = passages.get(document.id);
    if (passage) return { ...document, learningOutline: buildDocumentOutline({ title: document.title, chunks: [passage] }) };
    const outline = document.learningOutline;
    if (document.status === "READY" && outline && typeof outline === "object" && !Array.isArray(outline)) {
      const suggestions = refreshDocumentSuggestions(outline);
      if (suggestions) return { ...document, learningOutline: { ...outline, suggestions } };
    }
    return document;
  });
  return { course: fields, documents: courseDocuments, topics, conversations, quizzes, progress: progress.map(flatProgress) };
}

function flatProgress<T extends { topic: { title: string; courseId: string } }>(value: T) {
  const { topic, ...fields } = value;
  return { ...fields, title: topic.title, courseId: topic.courseId };
}

export async function addTopic(ownerId: string, courseId: string, title: string) {
  await assertOwnedCourse(ownerId, courseId);
  return database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    if (!await tx.course.findFirst({ where: { id: courseId, ownerId, deletionPending: false }, select: { id: true } })) {
      throw new WorkspaceError(404, "That course is unavailable.");
    }
    const prev = await tx.topic.findMany({
      where: { courseId, course: { ownerId } }, take: 100, select: { position: true }, orderBy: { position: "desc" },
    });
    if (prev.length >= 100) throw new WorkspaceError(429, "This course already has 100 topics.");
    return tx.topic.create({ data: { courseId, title, position: (prev[0]?.position ?? -1) + 1 }, select: topicFields });
  });
}

export async function dashboardRecord(ownerId: string) {
  const db = database();
  const [courses, progress, conversations, attempts, revision, completedTutorSessions, attemptTotals, practicedTopics, uploadedDocument] = await Promise.all([
    listCourses(ownerId),
    db.topicProgress.findMany({ where: { ownerId }, select: progressFields, orderBy: { updatedAt: "desc" }, take: 100 }),
    db.conversation.findMany({
      where: { ownerId }, select: { id: true, title: true, courseId: true, updatedAt: true },
      orderBy: { updatedAt: "desc" }, take: 20,
    }),
    db.quizAttempt.findMany({
      where: { ownerId }, select: { id: true, score: true, total: true, createdAt: true, quiz: { select: { id: true, title: true, courseId: true } } },
      orderBy: { createdAt: "desc" }, take: 40,
    }),
    db.revisionItem.findMany({
      where: { ownerId }, select: { id: true, topicId: true, dueAt: true, completedAt: true, topic: { select: { title: true, courseId: true } } },
      orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }], take: 40,
    }),
    db.conversation.count({ where: { ownerId, messages: { some: { role: "assistant" } } } }),
    db.quizAttempt.aggregate({ where: { ownerId }, _count: { _all: true }, _sum: { score: true, total: true } }),
    db.topicProgress.count({ where: { ownerId, total: { gt: 0 } } }),
    db.document.findFirst({ where: { course: { ownerId, deletionPending: false }, status: { notIn: ["UPLOADING", "DELETING"] } }, select: { id: true } }),
  ]);
  return {
    courses, progress: progress.map(flatProgress), conversations, attempts, revision: revision.map(flatProgress),
    completedSessions: completedTutorSessions + attemptTotals._count._all, completedTutorSessions, hasUploadedDocument: Boolean(uploadedDocument),
    practiceTotals: { attempts: attemptTotals._count._all, correct: attemptTotals._sum.score ?? 0, graded: attemptTotals._sum.total ?? 0, practicedTopics },
  };
}

export async function removeCourse(ownerId: string, id: string) {
  await database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const marked = await tx.course.updateMany({ where: { id, ownerId }, data: { deletionPending: true } });
    if (!marked.count) throw new WorkspaceError(404, "That course is unavailable.");
  });
  await removeCourseFiles(ownerId, id);
  const result = await database().course.deleteMany({ where: { id, ownerId } });
  if (!result.count) throw new WorkspaceError(404, "That course is unavailable.");
}

export async function exportWorkspace(ownerId: string) {
  const db = database();
  const [account, courses, conversations, assessments, progress, revision] = await Promise.all([
    db.user.findUnique({ where: { id: ownerId }, select: { name: true, email: true, isAnonymous: true, createdAt: true } }),
    db.course.findMany({
      where: { ownerId },
      select: {
        ...courseFields,
        topics: { select: topicFields },
        documents: { select: {
          ...documentFields,
          chunks: { select: { id: true, page: true, ordinal: true, text: true }, orderBy: { ordinal: "asc" } },
        } },
      },
    }),
    db.conversation.findMany({
      where: { ownerId },
      select: { id: true, title: true, courseId: true, createdAt: true, updatedAt: true, messages: true },
    }),
    db.quizAttempt.findMany({
      where: { ownerId },
      select: {
        id: true, score: true, total: true, createdAt: true, quiz: { select: { title: true, courseId: true } },
        answers: { select: {
          answer: true, assessment: true,
          question: { select: { prompt: true, type: true, explanation: true, sourceIds: true } },
        } },
      },
    }),
    db.topicProgress.findMany({ where: { ownerId }, select: progressFields }),
    db.revisionItem.findMany({ where: { ownerId }, select: { topicId: true, dueAt: true, completedAt: true } }),
  ]);
  if (!account) throw new WorkspaceError(404, "That account is unavailable.");
  return { exportedAt: new Date(), account, courses, conversations, assessments, progress, revision };
}

export async function removeWorkspace(ownerId: string) {
  await database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId, true);
    await tx.user.update({ where: { id: ownerId }, data: { deletionPending: true } });
    await tx.course.updateMany({ where: { ownerId }, data: { deletionPending: true } });
  });
  await removeCourseFiles(ownerId);
  await database().user.deleteMany({ where: { id: ownerId } });
}
