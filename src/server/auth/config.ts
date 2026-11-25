import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { anonymous } from "better-auth/plugins";
import { database } from "../db/client";
import { lockOwner } from "../db/ownership";
import { WorkspaceError } from "../workspace/errors";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new WorkspaceError(503, "Workspace authentication is not configured.");
  const baseURL = process.env.BETTER_AUTH_URL || process.env.APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return betterAuth({
    appName: "FIS Learning",
    baseURL,
    secret,
    database: prismaAdapter(database(), { provider: "postgresql" }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 40,
      customRules: { "/sign-in/anonymous": { window: 3600, max: 8 } },
    },
    plugins: [anonymous({
      emailDomainName: "guests.fis.invalid",
      disableDeleteAnonymousUser: true,
      async onLinkAccount({ anonymousUser, newUser }) {
        const guestId = anonymousUser.user.id;
        const targetId = newUser.user.id;
        if (guestId === targetId) return;
        await database().$transaction(async (tx) => {
          for (const id of [guestId, targetId].sort()) await lockOwner(tx, id);
          await tx.course.updateMany({ where: { ownerId: guestId }, data: { ownerId: targetId } });
          await tx.conversation.updateMany({ where: { ownerId: guestId }, data: { ownerId: targetId } });
          // Idempotency keys were scoped to the guest account before linking.
          await tx.quizAttempt.updateMany({ where: { ownerId: guestId }, data: { ownerId: targetId, submissionKey: null } });
          await tx.topicProgress.updateMany({ where: { ownerId: guestId }, data: { ownerId: targetId } });
          await tx.revisionItem.updateMany({ where: { ownerId: guestId }, data: { ownerId: targetId } });
          await tx.usageRecord.updateMany({ where: { ownerId: guestId }, data: { ownerId: targetId } });
          await tx.user.deleteMany({ where: { id: guestId, isAnonymous: true } });
        });
      },
    })],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth();
  return auth;
}
