import { isContextualTutorPrompt } from "@/lib/teaching-modes";
import { authorizeConversation, contextualTutorSources, saveTutorTurn, tutorReplyRecord } from "@/server/workspace/learning";
import { retrieveCourseSources } from "@/server/rag/retrieval";
import { AiError } from "@/server/ai/errors";
import { aiErrorDetails, attachmentParts, authorizedAi, chatBody, chatSchema, requestLanguage, validate } from "@/server/ai/requests";
import { embedLearningTexts, openTutorStream, sourceContext } from "@/server/ai/services";
import { prepareTeachingAnswer, sourceMeasurementAnswer } from "@/server/ai/teaching";
import { digestBytes } from "@/server/ai/usage";

export const runtime = "nodejs";
export const maxDuration = 60;
const encoder = new TextEncoder();
const eventStream = (body: BodyInit) => new Response(body, { headers: {
  "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
} });

function eventData(payload: string | object) {
  return "data: " + (typeof payload === "string" ? payload : JSON.stringify(payload)) + "\n\n";
}

export const POST = authorizedAi(async (request, actor, options, setLanguage, usage) => {
  const { data, files } = await chatBody(request);
  const input = validate(chatSchema, data);
  setLanguage(input.language);
  const { messages, courseId, conversationId, language } = input;
  const latest = messages.at(-1)!;
  const contextual = isContextualTutorPrompt(latest.content);
  const previous = messages.slice(0, -1).findLast((entry) => entry.role === "user" && !isContextualTutorPrompt(entry.content));
  const query = (contextual && previous ? previous.content : latest.content.length < 120 && previous
    ? latest.content + "\n" + previous.content : latest.content).slice(0, 3500);
  if (conversationId) await authorizeConversation(actor.id, conversationId, courseId);
  const parts = await attachmentParts(files);
  const attachments = await Promise.all(files.map(async (file) => [file.name, file.type, digestBytes(await file.arrayBuffer())]));
  const state = await usage.begin("chat", { input, attachments });
  if (state.replay) {
    const reply = await tutorReplyRecord(actor.id, state.record.resultRef!);
    return eventStream(eventData({ content: reply.content }) + eventData({ conversationId: reply.conversationId, citations: reply.citations ?? [] }) + eventData("[DONE]"));
  }
  const priorReply = messages.at(-2);
  const reused = contextual && courseId && conversationId && !parts.length && priorReply?.role === "assistant"
    ? await contextualTutorSources(actor.id, courseId, conversationId, priorReply.content) : [];
  if (courseId) await usage.local(reused.length ? "source_reuse" : "retrieval");
  const sources = reused.length ? reused : courseId ? await retrieveCourseSources(
    actor.id, courseId, query,
    (chunks, model) => embedLearningTexts(chunks, options.authorizeAttempt, options.signal, model, options.apiKey, options),
  ) : [];
  if (courseId && !sources.length && !parts.length) throw new AiError("no_sources");

  const replyLanguage = language ?? requestLanguage(request);
  if (contextual && input.mode === "visual" && (reused.length || previous) && !parts.length) {
    const measured = sourceMeasurementAnswer(sourceContext(sources).sourceByLabel, replyLanguage);
    if (measured) {
      const { conversationId: saved } = await saveTutorTurn(actor.id, { courseId, conversationId, prompt: latest.content, ...measured }, state.action);
      return eventStream(eventData({ content: measured.answer }) + eventData({ citations: measured.citations, conversationId: saved }) + eventData("[DONE]"));
    }
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal ?? request.signal, controller.signal]);
  const { result, model, sourceByLabel, mode } = await openTutorStream(messages, parts, sources, {
    mode: input.mode, language, grounded: Boolean(courseId),
    temperature: input.temperature, maxTokens: input.maxTokens,
  }, { ...options, model: input.model, signal });

  async function* output() {
    let answer = "";
    let complete = false;
    const checkSources = Boolean(courseId && !parts.length);
    try {
      for await (const content of (async function* () { yield result.first; yield* result.tokens; })()) {
        if (signal.aborted) throw signal.reason;
        answer += content;
        if (answer.length > 42_000) throw new AiError("invalid_response");
        if (!checkSources) yield { content };
      }
      if (signal.aborted) throw signal.reason;
      if (!answer.trim()) throw new AiError("invalid_response");
      const candidate = prepareTeachingAnswer(answer, sourceByLabel, replyLanguage, mode === "visual", latest.content);
      const prepared = checkSources && !candidate.citations.length ? {
        citations: [], answer: replyLanguage === "ar"
          ? "ملقتش في المحاضرة دليل كافي يجاوب على السؤال. جرّب تسأل عن نقطة محددة في النص أو أضف مصدر يغطّيها."
          : "I couldn't verify an answer from the course material. Try a more specific question about the text or add a source that covers it.",
      } : candidate;
      const persisted = await saveTutorTurn(actor.id, {
        courseId, conversationId, prompt: latest.content, answer: prepared.answer, model: model.id, citations: prepared.citations,
      }, state.action);
      complete = true;
      if (signal.aborted) throw signal.reason;
      if (checkSources) yield { content: prepared.answer };
      yield {
        citations: prepared.citations, conversationId: persisted.conversationId,
        ...(!checkSources && prepared.answer !== answer ? { answer: prepared.answer } : {}),
      };
      yield "[DONE]";
    } catch (error) {
      if (request.signal.aborted || controller.signal.aborted) return;
      const result = aiErrorDetails(error, replyLanguage);
      yield { error: result.error, code: result.code, retryAfter: result.retryAfter, category: result.category };
    } finally {
      if (!complete) await usage.fail().catch(() => undefined);
      await result.tokens.return(undefined).catch(() => undefined);
    }
  }

  const iterator = output();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      const item = await iterator.next();
      if (item.done) stream.close();
      else stream.enqueue(encoder.encode(eventData(item.value)));
    },
    async cancel() {
      controller.abort();
      await iterator.return(undefined);
      await usage.fail().catch(() => undefined);
    },
  });
  return eventStream(body);
});
