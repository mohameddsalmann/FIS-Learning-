import { database } from "../db/client";
import { WorkspaceError, requireSameOrigin } from "../workspace/errors";
import { getAuth } from "./config";

export interface Actor {
  id: string;
  isAnonymous: boolean;
}

export async function getActor(headers: Headers): Promise<Actor | null> {
  const session = await getAuth().api.getSession({ headers });
  return session?.user ? { id: session.user.id, isAnonymous: Boolean(session.user.isAnonymous) } : null;
}

export async function requireActor(request: Request, allowDeleting = false): Promise<Actor> {
  requireSameOrigin(request);
  const actor = await getActor(request.headers);
  if (!actor) throw new WorkspaceError(401, "Start a guest session or sign in to use your study workspace.");
  const user = await database().user.findUnique({ where: { id: actor.id }, select: { deletionPending: true } });
  if (!user) throw new WorkspaceError(401, "This workspace session is unavailable.");
  if (user.deletionPending && !allowDeleting) throw new WorkspaceError(409, "Account deletion is in progress.");
  return actor;
}

export async function recordModelHealth(input: { modelId: string; status: string; latencyMs?: number }) {
  try {
    await database().modelHealthRecord.create({ data: {
      modelId: input.modelId.slice(0, 255),
      status: input.status.slice(0, 64),
      latencyMs: Number.isFinite(input.latencyMs) ? Math.min(2_147_483_647, Math.max(0, Math.round(input.latencyMs!))) : null,
    } });
  } catch {
    // Provider results must survive a transient observability write failure.
  }
}
