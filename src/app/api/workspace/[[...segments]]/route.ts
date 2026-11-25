import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { database } from "@/server/db/client";
import {
  addTopic, courseRecord, createCourse, dashboardRecord, exportWorkspace, listCourses, removeCourse, removeWorkspace,
} from "@/server/workspace/courses";
import { apiError, apiJson, WorkspaceError } from "@/server/workspace/errors";
import { conversationRecord, quizAttemptRecord, quizRecord, submitQuizAttempt } from "@/server/workspace/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ segments?: string[] }> };
const routeIds = z.array(z.string().min(1).max(128)).max(4);
const courseInput = z.object({
  title: z.string().trim().min(1).max(110),
  description: z.string().trim().max(1500).default(""),
  firstTopic: z.string().trim().min(1).max(100).optional(),
});
const attemptInput = z.object({
  answers: z.array(z.object({ questionId: z.string().min(1).max(128), answer: z.string().trim().min(1).max(2400) })).min(1).max(15),
  submissionKey: z.string().uuid().optional(),
});

export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireActor(request);
    const [part, id, action] = routeIds.parse((await params).segments ?? []);
    if (action) throw new WorkspaceError(404, "That workspace view is unavailable.");
    if (part === "dashboard" && !id) return apiJson(await dashboardRecord(actor.id));
    if (part === "courses") return apiJson(id ? await courseRecord(actor.id, id) : { courses: await listCourses(actor.id) });
    if (part === "conversations" && id) return apiJson({ conversation: await conversationRecord(actor.id, id) });
    if (part === "quizzes" && id) return apiJson({ quiz: await quizRecord(actor.id, id) });
    if (part === "quiz-attempts" && id) return apiJson(await quizAttemptRecord(actor.id, id));
    if (part === "export" && !id) {
      return Response.json(await exportWorkspace(actor.id), {
        headers: { "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="fis-learning-export.json"' },
      });
    }
    throw new WorkspaceError(404, "That workspace view is unavailable.");
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireActor(request);
    const [part, id, action, extra] = routeIds.parse((await params).segments ?? []);
    if (extra) throw new WorkspaceError(404, "That workspace action is unavailable.");
    if (part === "courses" && !id) {
      const { title, description, firstTopic } = courseInput.parse(await request.json());
      return apiJson({ course: await createCourse(actor, title, description, firstTopic) }, 201);
    }
    if (part === "courses" && id && action === "topics") {
      const { title } = z.object({ title: z.string().trim().min(1).max(100) }).parse(await request.json());
      return apiJson({ topic: await addTopic(actor.id, id, title) }, 201);
    }
    if (part === "quizzes" && id && action === "attempts") {
      const { answers, submissionKey } = attemptInput.parse(await request.json());
      return apiJson(await submitQuizAttempt(actor.id, id, answers, submissionKey), 201);
    }
    throw new WorkspaceError(404, "That workspace action is unavailable.");
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await requireActor(request);
    const [part, id, action] = routeIds.parse((await params).segments ?? []);
    if (!id || action) throw new WorkspaceError(404, "That workspace action is unavailable.");
    if (part === "courses") {
      const input = courseInput.omit({ firstTopic: true }).partial().refine(({ title, description }) => title !== undefined || description !== undefined)
        .parse(await request.json());
      const course = await database().course.update({ where: { id, ownerId: actor.id, deletionPending: false }, data: input,
        select: { id: true, title: true, description: true } });
      return apiJson({ course });
    }
    if (part === "revision") {
      const { completed } = z.object({ completed: z.boolean() }).parse(await request.json());
      const record = await database().revisionItem.update({ where: { id, ownerId: actor.id }, data: {
        completedAt: completed ? new Date() : null,
      }, select: { id: true, completedAt: true, dueAt: true, topicId: true } });
      return apiJson({ revision: record });
    }
    throw new WorkspaceError(404, "That workspace action is unavailable.");
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const [part, id, action] = routeIds.parse((await params).segments ?? []);
    const actor = await requireActor(request, part === "account" && !id);
    if (action) throw new WorkspaceError(404, "That workspace action is unavailable.");
    if (part === "courses" && id) await removeCourse(actor.id, id);
    else if (part === "conversations" && id) {
      const result = await database().conversation.deleteMany({ where: { id, ownerId: actor.id } });
      if (!result.count) throw new WorkspaceError(404, "That conversation is unavailable.");
    } else if (part === "account" && !id) {
      z.object({ confirmation: z.literal("DELETE") }).parse(await request.json());
      await removeWorkspace(actor.id);
    } else throw new WorkspaceError(404, "That workspace action is unavailable.");
    return apiJson({ deleted: true });
  } catch (error) { return apiError(error); }
}
