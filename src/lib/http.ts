export class RequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly retryAfter?: number, readonly category?: string) { super(message); }
}

function errorFromBody(response: Response, body: unknown, fallback: string) {
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const details = payload.error;
  const message = typeof details === "string" ? details
    : details && typeof details === "object" && "message" in details && typeof details.message === "string" ? details.message
    : typeof payload.message === "string" ? payload.message : fallback;
  const seconds = Number(response.headers.get("Retry-After") ?? payload.retryAfter);
  return new RequestError(response.status, message, typeof payload.code === "string" ? payload.code : undefined,
    Number.isFinite(seconds) && seconds > 0 ? seconds : undefined, typeof payload.category === "string" ? payload.category : undefined);
}

export async function readRequestError(response: Response, fallback: string) {
  return errorFromBody(response, await response.json().catch(() => null), fallback);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFromBody(response, body, "The request could not be completed.");
  return body as T;
}

export function jsonBody(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
