import { z } from "zod";
import { getCourseSources, retrieveCourseSources } from "@/server/rag/retrieval";
import { authorizeTopic, quizRecord, saveGeneratedQuiz } from "@/server/workspace/learning";
import { authorizedAi, identifier, jsonBody, languageSchema, modelSchema, validate } from "@/server/ai/requests";
import { embedLearningTexts, generateStudyQuiz } from "@/server/ai/services";

export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({
  courseId: identifier, topicId: identifier.optional(), topic: z.string().trim().min(1).max(180).optional(),
  difficulty: z.string().trim().toLowerCase().pipe(z.enum(["easy", "medium", "hard"])),
  count: z.number().int().min(1).max(10), type: z.enum(["MCQ", "TRUE_FALSE", "SHORT", "MIXED"]).optional(),
  language: languageSchema.optional(), model: modelSchema,
}).strict();

export const POST = authorizedAi(async (request, actor, options, setLanguage, usage) => {
  const input = validate(schema, await jsonBody(request));
  setLanguage(input.language);
  const { courseId, topicId, language } = input;
  const topic = topicId ? (await authorizeTopic(actor.id, courseId, topicId)).title : input.topic;
  const state = await usage.begin("quiz", input);
  if (state.replay) return Response.json({ quiz: await quizRecord(actor.id, state.record.resultRef!) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  await usage.local("retrieval");
  const sources = topic ? await retrieveCourseSources(actor.id, courseId, topic,
    (texts, model) => embedLearningTexts(texts, options.authorizeAttempt, options.signal, model, options.apiKey, options))
    : await getCourseSources(actor.id, courseId);
  const questions = await generateStudyQuiz({ ...input, topic }, sources, { ...options, model: input.model });
  const title = topic || (language === "ar" ? "اختبار تدريبي" : "Practice quiz");
  const quiz = await saveGeneratedQuiz(actor.id, { courseId, topicId, title, questions }, state.action);
  return Response.json({ quiz }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
