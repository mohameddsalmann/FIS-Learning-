import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "../src/server/auth/config";
import { requireActor } from "../src/server/auth/session";
import { database } from "../src/server/db/client";
import { createCourse, courseRecord, removeWorkspace } from "../src/server/workspace/courses";

const isolation = process.env.FIS_INTEGRATION_DATABASE === "isolated" && (() => {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL || "").hostname); }
  catch { return false; }
})();

describe.runIf(Boolean(isolation))("database-backed Better Auth guest ownership", () => {
  const origin = "http://localhost:3000";
  const ids: string[] = [];
  const authEmail = `${randomUUID()}@test.invalid`;
  const password = `Word-${randomUUID()}`;

  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
    process.env.BETTER_AUTH_URL = origin;
  });
  afterAll(async () => {
    await database().user.deleteMany({ where: { OR: [{ id: { in: ids } }, { email: authEmail }] } });
  });

  function authPost(path: string, data: unknown, session?: string) {
    return getAuth().handler(new Request(origin + "/api/auth" + path, {
      method: "POST",
      headers: {
        Origin: origin, "Content-Type": "application/json", ...(session ? { Cookie: session } : {}),
        "x-forwarded-for": `192.0.2.${Number.parseInt(randomBytes(1).toString("hex"), 16) % 190 + 1}`,
      },
      body: JSON.stringify(data),
    }));
  }
  function cookie(response: Response) {
    return response.headers.getSetCookie().find((part) => part.startsWith("better-auth.session_token="))?.split(";")[0];
  }
  function actorFor(token?: string) {
    return requireActor(new Request(origin + "/api/workspace/courses", { headers: token ? { Cookie: token } : {} }));
  }

  it("creates a signed guest, migrates its course when signing up, and revokes the old guest session", async () => {
    await expect(actorFor()).rejects.toMatchObject({ status: 401 });
    const guestResponse = await authPost("/sign-in/anonymous", {});
    expect(guestResponse.status).toBe(200);
    const guestCookie = cookie(guestResponse);
    expect(guestCookie).toBeTruthy();
    const guest = await actorFor(guestCookie);
    ids.push(guest.id);
    expect(guest.isAnonymous).toBe(true);
    const oldCourse = await createCourse(guest, "Guest workspace", "");
    const signup = await authPost("/sign-up/email", { name: "Verified test", email: authEmail, password }, guestCookie);
    expect(signup.status).toBe(200);
    const member = await actorFor(cookie(signup));
    ids.push(member.id);
    expect(member).toMatchObject({ isAnonymous: false });
    expect(member.id).not.toBe(guest.id);
    const migrated = await courseRecord(member.id, oldCourse.id);
    expect(migrated.course.title).toBe("Guest workspace");
    await expect(actorFor(guestCookie)).rejects.toMatchObject({ status: 401 });
    await removeWorkspace(member.id);
    await expect(actorFor(cookie(signup))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an expired guest session while preserving its saved course", async () => {
    const response = await authPost("/sign-in/anonymous", {});
    expect(response.status).toBe(200);
    const token = cookie(response);
    const guest = await actorFor(token);
    ids.push(guest.id);
    const course = await createCourse(guest, "Session expiry fixture", "");
    await database().session.updateMany({ where: { userId: guest.id }, data: { expiresAt: new Date(0) } });
    await expect(actorFor(token)).rejects.toMatchObject({ status: 401 });
    await expect(courseRecord(guest.id, course.id)).resolves.toMatchObject({ course: { id: course.id } });
  });
});
