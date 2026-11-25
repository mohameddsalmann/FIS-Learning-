import { z } from "zod";
import { authorizedAi, jsonBody, languageSchema, modelSchema, validate } from "@/server/ai/requests";
import { synthesizeSpeech } from "@/server/ai/services";
import { finishStudyAction } from "@/server/ai/usage";
import { database } from "@/server/db/client";
import { WorkspaceError } from "@/server/workspace/errors";

export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({ text: z.string().trim().min(1).max(4000), model: modelSchema, language: languageSchema.optional() }).strict();

export const POST = authorizedAi(async (request, _actor, options, setLanguage, usage) => {
  const input = validate(schema, await jsonBody(request));
  setLanguage(input.language);
  const state = await usage.begin("speech", input);
  let audio: { bytes: Uint8Array<ArrayBuffer>; type: string };
  if (state.replay) {
    const { replayBytes, replayType, replayUntil } = state.record;
    if (!replayBytes || !replayType || !replayUntil || replayUntil <= new Date()) throw new WorkspaceError(409, "This audio replay expired. Start a new Listen request.");
    audio = { bytes: Uint8Array.from(replayBytes), type: replayType };
  } else {
    const { result } = await synthesizeSpeech(input.text, { ...options, model: input.model });
    audio = { bytes: Uint8Array.from(result.bytes), type: result.format };
    await finishStudyAction(database(), state.action, null, audio);
  }
  return new Response(audio.bytes, {
    headers: { "Content-Type": audio.type, "Cache-Control": "no-store" },
  });
});
