import { ZodError } from "zod";

export class WorkspaceError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfter?: number, public readonly category?: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export function apiJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiError(error: unknown) {
  if (error instanceof WorkspaceError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return apiJson({ error: "Check the required fields and try again." }, 400);
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") return apiJson({ error: "This item already exists." }, 409);
    if (error.code === "P2025") return apiJson({ error: "That item is unavailable." }, 404);
  }
  return apiJson({ error: "The workspace could not complete this request. Try again." }, 503);
}

export function requireSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  const allowed = [new URL(request.url).origin];
  for (const url of [process.env.BETTER_AUTH_URL, process.env.APP_URL]) {
    if (url) allowed.push(new URL(url).origin);
  }
  if (origin && !allowed.includes(origin)) throw new WorkspaceError(403, "This request origin is not allowed.");
}
