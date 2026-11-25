import { database } from "../db/client";
import { lockOwner } from "../db/ownership";
import { Prisma } from "../db/generated/client";
import { assertOwnedCourse, type CourseSource } from "../rag/retrieval";
import { WorkspaceError } from "./errors";
import { assessAnswer, revisionDue } from "./scoring";
import { randomUUID } from "node:crypto";
import { finishStudyAction, type StudyAction } from "../ai/usage";

const publicQuestions = {
  select: { id: true, prompt: true, type: true, options: true },
  orderBy: { position: "asc" },
} as const;

const publicQuiz = { id: true, title: true, courseId: true, questions: publicQuestions } as const;

export async function authorizeConversation(ownerId: string, id: string, courseId?: string) {
  const item = await database().conversation.findFirst({
    where: { id, ownerId, ...(courseId !== undefined ? { courseId, course: { deletionPending: false } } : {}) },
    select: { id: true, courseId: true },
  });
  if (!item || (courseId === undefined && item.courseId !== null)) {
    throw new WorkspaceError(404, "That conversation is unavailable for this workspace.");
  }
  return item;
}

export async function contextualTutorSources(ownerId: string, courseId: string, conversationId: string, priorReply: string): Promise<CourseSource[]> {
  const db = database();
  const message = await db.message.findFirst({
    where: { conversationId, role: "assistant", conversation: { ownerId, courseId, course: { deletionPending: false } } },
    select: { content: true, citations: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!message || message.content.slice(0, 16_000).trim() !== priorReply || !Array.isArray(message.citations)) return [];
  const ids = [...new Set(message.citations.flatMap((citation) => citation && typeof citation === "object" && "id" in citation
    && typeof citation.id === "string" ? [citation.id] : []))].slice(0, 6);
  if (!ids.length) return [];
  const chunks = await db.documentChunk.findMany({
    where: { id: { in: ids }, document: { courseId, status: "READY", course: { ownerId, deletionPending: false } } },
    select: { id: true, documentId: true, page: true, text: true, document: { select: { title: true } } },
  });
  if (chunks.length !== ids.length) return [];
  const byId = new Map(chunks.map(({ document, ...chunk }) => [chunk.id, { ...chunk, title: document.title }]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export async function authorizeTopic(ownerId: string, courseId: string, topicId: string) {
  const topic = await database().topic.findFirst({
    where: { id: topicId, courseId, course: { ownerId, deletionPending: false } }, select: { id: true, title: true, courseId: true },
  });
  if (!topic) throw new WorkspaceError(404, "That topic is unavailable.");
  return topic;
}

export async function saveTutorTurn(ownerId: string, input: {
  courseId?: string; conversationId?: string; prompt: string; answer: string; model?: string; citations?: CourseSource[];
}, action?: StudyAction) {
  const { courseId, conversationId, prompt, answer, model, citations } = input;
  if (courseId) await assertOwnedCourse(ownerId, courseId);
  if (conversationId) await authorizeConversation(ownerId, conversationId, courseId);
  const assistantId = randomUUID();
  const messages: Prisma.MessageCreateWithoutConversationInput[] = [
    { role: "user", content: prompt },
    { id: assistantId, role: "assistant", content: answer, model, citations: citations?.map((source) => ({ ...source })) },
  ];
  return database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    if (courseId && !await tx.course.findFirst({ where: { id: courseId, ownerId, deletionPending: false }, select: { id: true } })) {
      throw new WorkspaceError(404, "That course is unavailable.");
    }
    if (citations?.length) {
      if (!courseId) throw new WorkspaceError(422, "Course sources are unavailable for this conversation.");
      const sourceIds = [...new Set(citations.map(({ id }) => id))];
      const available = await tx.documentChunk.count({
        where: { id: { in: sourceIds }, document: { courseId, status: "READY", course: { ownerId, deletionPending: false } } },
      });
      if (available !== sourceIds.length) throw new WorkspaceError(422, "One or more tutor sources are unavailable.");
    }
    const conversation = conversationId
      ? await tx.conversation.update({
          where: { id: conversationId, ownerId, courseId: courseId ?? null },
          data: { updatedAt: new Date(), messages: { create: messages } },
          select: { id: true },
        })
      : await tx.conversation.create({
          data: {
            ownerId, courseId, title: prompt.replace(/\s+/gu, " ").slice(0, 95),
            messages: { create: messages },
          },
          select: { id: true },
        });
    if (action) await finishStudyAction(tx, action, assistantId);
    return { conversationId: conversation.id };
  });
}

export async function tutorReplyRecord(ownerId: string, id: string) {
  const message = await database().message.findFirst({ where: { id, role: "assistant",
    conversation: { ownerId, OR: [{ courseId: null }, { course: { deletionPending: false } }] } },
  select: { conversationId: true, content: true, citations: true } });
  if (!message) throw new WorkspaceError(404, "That tutor reply is unavailable.");
  return message;
}

export async function conversationRecord(ownerId: string, id: string) {
  const conversation = await database().conversation.findFirst({
    where: { id, ownerId, OR: [{ courseId: null }, { course: { deletionPending: false } }] },
    select: {
      id: true, title: true, courseId: true, updatedAt: true,
      messages: {
        select: { id: true, role: true, content: true, model: true, citations: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { role: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!conversation) throw new WorkspaceError(404, "That conversation is unavailable.");
  return conversation;
}

type QuizInput = {
  courseId: string; topicId?: string; title: string;
  questions: { prompt: string; type: "MCQ" | "TRUE_FALSE" | "SHORT"; options: string[]; answer: string; explanation: string; sourceIds: string[] }[];
};

export async function saveGeneratedQuiz(ownerId: string, input: QuizInput, action?: StudyAction) {
  const { courseId, topicId, title, questions } = input;
  await assertOwnedCourse(ownerId, courseId);
  if (!questions.length || questions.length > 15) throw new WorkspaceError(422, "The generated quiz did not meet the question limit.");
  const sourceIds = [...new Set(questions.flatMap((item) => item.sourceIds))];
  if (!sourceIds.length || questions.some((q) => !q.sourceIds.length)) {
    throw new WorkspaceError(422, "Each quiz question needs a verified source from this course.");
  }
  return database().$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const citations = await tx.documentChunk.count({
      where: { id: { in: sourceIds }, document: { courseId, status: "READY", course: { ownerId, deletionPending: false } } },
    });
    if (citations !== sourceIds.length) throw new WorkspaceError(422, "One or more quiz sources are unavailable.");
    const topic = topicId
      ? await tx.topic.findFirst({ where: { id: topicId, courseId } })
      : await tx.topic.findFirst({ where: { courseId }, orderBy: { position: "asc" } });
    if (topicId && !topic) throw new WorkspaceError(404, "That topic is unavailable.");
    const quiz = await tx.quiz.create({
      data: { courseId, topicId: topic?.id, title, questions: { create: questions.map((question, position) => ({ ...question, position })) } },
      select: publicQuiz,
    });
    if (action) await finishStudyAction(tx, action, quiz.id);
    return quiz;
  });
}

export async function quizRecord(ownerId: string, id: string) {
  const result = await database().quiz.findFirst({ where: { id, course: { ownerId, deletionPending: false } }, select: publicQuiz });
  if (!result) throw new WorkspaceError(404, "That quiz is unavailable.");
  return result;
}

function assessmentPayload(question: {
  id: string; answer: string; explanation: string; sourceIds: string[];
}, assessment: {
  correct: boolean | null; reviewRequired: boolean; correctConcepts: string[]; missingConcepts: string[]; incorrectStatements: string[];
}) {
  return { questionId: question.id, ideal: question.answer, explanation: question.explanation, sourceIds: question.sourceIds, ...assessment };
}

export async function quizAttemptRecord(ownerId: string, id: string) {
  const db = database();
  const row = await db.quizAttempt.findFirst({
    where: { id, ownerId, quiz: { course: { ownerId, deletionPending: false } } },
    include: { quiz: { include: { questions: { orderBy: { position: "asc" } } } }, answers: { include: { assessment: true } } },
  });
  if (!row) throw new WorkspaceError(404, "That quiz attempt is unavailable.");
  const sourceIds = [...new Set(row.quiz.questions.flatMap((question) => question.sourceIds))];
  const rows = sourceIds.length ? await db.documentChunk.findMany({
    where: { id: { in: sourceIds }, document: { courseId: row.quiz.courseId, status: "READY", course: { ownerId, deletionPending: false } } },
    select: { id: true, page: true, documentId: true, document: { select: { title: true } } },
  }) : [];
  const bySource = new Map(rows.map(({ document, ...chunk }) => [chunk.id, { ...chunk, title: document.title }]));
  const byQuestion = new Map(row.answers.map((answer) => [answer.questionId, answer]));
  return {
    attempt: { id: row.id, quizId: row.quizId, score: row.score, total: row.total, createdAt: row.createdAt },
    results: row.quiz.questions.map((question) => {
      const recorded = byQuestion.get(question.id);
      if (!recorded?.assessment) throw new WorkspaceError(503, "The saved assessment could not be read.");
      const { correct, reviewRequired, correctConcepts, missingConcepts, incorrectStatements } = recorded.assessment;
      return { ...assessmentPayload(question, { correct, reviewRequired, correctConcepts, missingConcepts, incorrectStatements }),
        given: recorded.answer, sources: question.sourceIds.flatMap((sourceId) => bySource.get(sourceId) ?? []) };
    }),
  };
}

export async function submitQuizAttempt(ownerId: string, quizId: string, responses: { questionId: string; answer: string }[], submissionKey?: string) {
  const db = database();
  const quiz = await db.quiz.findFirst({
    where: { id: quizId, course: { ownerId, deletionPending: false } },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  if (!quiz) throw new WorkspaceError(404, "That quiz is unavailable.");
  const submitted = new Map(responses.map((response) => [response.questionId, response.answer]));
  if (responses.length !== quiz.questions.length || submitted.size !== responses.length
      || quiz.questions.some(({ id }) => !submitted.has(id))) {
    throw new WorkspaceError(400, "Submit one answer for each quiz question.");
  }
  for (const question of quiz.questions) {
    if (question.type !== "SHORT" && !question.options.includes(submitted.get(question.id)!)) {
      throw new WorkspaceError(400, "Select one of the given options for each choice question.");
    }
  }
  const sourceIds = [...new Set(quiz.questions.flatMap((question) => question.sourceIds))];
  const sourceRows = sourceIds.length ? await db.documentChunk.findMany({
    where: { id: { in: sourceIds }, document: { courseId: quiz.courseId, status: "READY", course: { ownerId, deletionPending: false } } },
    select: { id: true, page: true, documentId: true, document: { select: { title: true } } },
  }) : [];
  const sourceById = new Map(sourceRows.map(({ document, ...source }) => [source.id, { ...source, title: document.title }]));
  const sourcesFor = (ids: string[]) => ids.flatMap((id) => sourceById.get(id) ?? []);
  const result = quiz.questions.map((question) => assessAnswer(question, submitted.get(question.id)!));
  const score = result.filter(({ correct }) => correct === true).length;
  const total = result.filter(({ reviewRequired }) => !reviewRequired).length;
  const due = revisionDue(score, total, new Date());
  const existing = async () => {
    if (!submissionKey) return null;
    const previous = await db.quizAttempt.findUnique({
      where: { ownerId_submissionKey: { ownerId, submissionKey } },
      include: { answers: { include: { assessment: true } } },
    });
    if (!previous) return null;
    if (previous.quizId !== quizId || previous.answers.some((row) => submitted.get(row.questionId) !== row.answer)) {
      throw new WorkspaceError(409, "This submission key has already been used for a different attempt.");
    }
    const { id, quizId: savedQuizId, score, total, createdAt, answers } = previous;
    const attempt = { id, quizId: savedQuizId, score, total, createdAt };
    const byQuestion = new Map(answers.map((row) => [row.questionId, row.assessment]));
    return {
      attempt,
      results: quiz.questions.map((question) => {
        const assessment = byQuestion.get(question.id);
        if (!assessment) throw new WorkspaceError(503, "The previous assessment could not be read.");
        const { correct, reviewRequired, correctConcepts, missingConcepts, incorrectStatements } = assessment;
        return { ...assessmentPayload(question, { correct, reviewRequired, correctConcepts, missingConcepts, incorrectStatements }), sources: sourcesFor(question.sourceIds) };
      }),
    };
  };
  const previous = await existing();
  if (previous) return previous;
  try {
    const attempt = await db.$transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      if (!await tx.quiz.findFirst({ where: { id: quizId, course: { ownerId, deletionPending: false } }, select: { id: true } })) {
        throw new WorkspaceError(404, "That quiz is unavailable.");
      }
      const record = await tx.quizAttempt.create({
        data: {
          ownerId, quizId, score, total, submissionKey,
          answers: { create: result.map(({ questionId, correct, reviewRequired, correctConcepts, missingConcepts, incorrectStatements }) => ({
            questionId, answer: submitted.get(questionId)!,
            assessment: { create: { correct, reviewRequired, correctConcepts, missingConcepts, incorrectStatements } },
          })) },
        },
        select: { id: true, quizId: true, score: true, total: true, createdAt: true },
      });
      if (quiz.topicId) {
        const key = { ownerId, topicId: quiz.topicId };
        await tx.topicProgress.upsert({
          where: { ownerId_topicId: key },
          create: { ...key, attempts: 1, correct: score, total },
          update: { attempts: { increment: 1 }, correct: { increment: score }, total: { increment: total } },
        });
        if (due) {
          await tx.revisionItem.upsert({
            where: { ownerId_topicId: key }, create: { ...key, dueAt: due },
            update: { dueAt: due, completedAt: null },
          });
        }
      }
      return record;
    });
    return { attempt, results: result.map((entry) => ({ ...entry, sources: sourcesFor(entry.sourceIds) })) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await existing();
      if (retry) return retry;
    }
    throw error;
  }
}
