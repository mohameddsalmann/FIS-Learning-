import type { Prisma } from "./generated/client";
import { WorkspaceError } from "../workspace/errors";

export async function lockOwner(tx: Prisma.TransactionClient, id: string, allowDeleting = false) {
  const rows = await tx.$queryRaw<{ deletionPending: boolean }[]>`
    SELECT "deletionPending" FROM "user" WHERE "id" = ${id} FOR UPDATE
  `;
  if (!rows.length) throw new WorkspaceError(401, "This workspace session is unavailable.");
  if (rows[0].deletionPending && !allowDeleting) {
    throw new WorkspaceError(409, "Account deletion is in progress.");
  }
}
