import { z } from "zod";
import { authorizedAi, jsonBody, languageSchema, modelSchema, validate } from "@/server/ai/requests";
import { generateImage } from "@/server/ai/services";

export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({ prompt: z.string().trim().min(1).max(2000), model: modelSchema, language: languageSchema.optional() }).strict();

export const POST = authorizedAi(async (request, _actor, options, setLanguage) => {
  const input = validate(schema, await jsonBody(request));
  setLanguage(input.language);
  const { result } = await generateImage(input.prompt, { ...options, model: input.model });
  return new Response(Uint8Array.from(result.bytes), {
    headers: { "Content-Type": result.format, "Cache-Control": "no-store" },
  });
});
