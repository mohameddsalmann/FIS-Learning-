import { z } from "zod";
import { authorizedAi, jsonBody, languageSchema, modelSchema, validate } from "@/server/ai/requests";
import { assessAnswer } from "@/server/ai/services";

export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({
  question: z.string().trim().min(1).max(2000), answer: z.string().trim().min(1).max(4000),
  reference: z.string().trim().max(4000).default(""), model: modelSchema, language: languageSchema.optional(),
}).strict();

export const POST = authorizedAi(async (request, _actor, options, setLanguage) => {
  const input = validate(schema, await jsonBody(request));
  setLanguage(input.language);
  return Response.json(await assessAnswer(input.question, input.answer, input.reference, { ...options, model: input.model }), {
    headers: { "Cache-Control": "no-store" },
  });
});
