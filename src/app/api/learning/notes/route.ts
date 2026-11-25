import { z } from "zod";
import { authorizedAi, jsonBody, languageSchema, modelSchema, validate } from "@/server/ai/requests";
import { searchNotes } from "@/server/ai/services";

export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({
  query: z.string().trim().min(1).max(1000), notes: z.string().trim().min(1).max(16_000), model: modelSchema,
  rerank: z.boolean().default(false), reranker: modelSchema, language: languageSchema.optional(),
}).strict();

export const POST = authorizedAi(async (request, _actor, options, setLanguage) => {
  const input = validate(schema, await jsonBody(request));
  setLanguage(input.language);
  return Response.json(await searchNotes(input.query, input.notes, {
    ...options, model: input.model, rerank: input.rerank, reranker: input.reranker,
  }), { headers: { "Cache-Control": "no-store" } });
});
