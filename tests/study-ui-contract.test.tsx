import { describe, expect, it } from "vitest";
import { routeAvailability, statusFromError } from "../src/lib/ai-status";
import { readRequestError } from "../src/lib/http";
import { CHAT_BYTE_LIMIT, chatHistory, readChatStream, sourceHref, validateFiles, type StudyMessage } from "../src/components/study/client";
import { pdfMatches } from "../src/components/study/pdf-text";

function stream(...parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encode = new TextEncoder();
      parts.forEach((part) => controller.enqueue(encode.encode(part)));
      controller.close();
    },
  });
}

describe("study chat browser contract", () => {
  it("decodes split SSE records, citations and conversation IDs", async () => {
    const received: unknown[] = [];
    const source = { id: "chunk", documentId: "doc", page: 4, text: "Elasticity", title: "Physics notes" };
    await readChatStream(stream('data: {"con', 'tent":"Let’s reason."}\r\n\r\n', `data: ${JSON.stringify({ citations: [source], conversationId: "conversation" })}\n`, "\ndata: [DONE]\n\n"), (event) => received.push(event));
    expect(received).toEqual([{ content: "Let’s reason." }, { citations: [source], conversationId: "conversation" }]);
  });

  it("reports midstream failure and rejects a disconnected partial reply", async () => {
    await expect(readChatStream(stream('data: {"error":{"message":"Quota exceeded"}}\n\n'), () => {})).rejects.toThrow("Quota exceeded");
    await expect(readChatStream(stream('data: {"content":"partial"}\n\n'), () => {})).rejects.toThrow("closed before");
    await expect(readChatStream(stream('data: {"content":"جزء"}\n\n'), () => {}, "ar")).rejects.toThrow("انقطع اتصال المعلّم");
  });

  it("distinguishes daily exhaustion from a temporary provider cooldown in JSON and streamed errors", async () => {
    const exhausted = await readRequestError(Response.json({ error: "Free capacity was used", code: "rate_limited", category: "openrouter_daily" },
      { status: 429, headers: { "Retry-After": "42" } }), "Unavailable");
    expect(statusFromError(exhausted)).toEqual({ state: "daily_exhausted", retryAfter: 42 });
    try {
      await readChatStream(stream('data: {"error":"Shared pool busy","code":"rate_limited","category":"openrouter_upstream_pool","retryAfter":60}\n\n'), () => {});
      throw new Error("Expected the stream to fail");
    } catch (error) {
      expect(statusFromError(error)).toEqual({ state: "busy", retryAfter: 60 });
    }
  });

  it("keeps a feature available when an eligible fallback can serve it", () => {
    const limited = { availability: "degraded", category: "openrouter_daily", retryAfter: 42 };
    expect(routeAvailability([limited, { availability: "available" }])).toEqual({ state: "available" });
    expect(routeAvailability([limited])).toEqual({ state: "daily_exhausted", retryAfter: 42 });
    expect(routeAvailability([limited, { availability: "degraded", category: "timeout" }])).toEqual({ state: "busy", retryAfter: undefined });
    expect(routeAvailability([{ availability: "degraded", category: "credentials" }])).toEqual({ state: "unavailable" });
  });

  it("preserves the latest question within the gateway limits after long replies", () => {
    const previous: StudyMessage[] = Array.from({ length: 28 }, (_, index) => ({ id: String(index), role: index % 2 ? "assistant" : "user", content: "ଅ".repeat(42_000) }));
    const latest = { id: "latest", role: "user", content: "Explain this example." } as const;
    const history = chatHistory([...previous, latest]);
    expect(history.at(-1)).toEqual({ role: "user", content: latest.content });
    expect(history.at(-2)?.content).toHaveLength(16_000);
    expect(history.reduce((sum, entry) => sum + entry.content.length, 0)).toBeLessThanOrEqual(75_000);
    expect(new TextEncoder().encode(JSON.stringify(history)).length).toBeLessThan(256 * 1024);
  });

  it("keeps private title and excerpts out of citation links", () => {
    const source = { id: "chunk/1 #", documentId: "doc/2", page: 3, title: "private name", text: "private excerpt" };
    expect(sourceHref(source))
      .toEqual("/documents/doc%2F2?page=3&citation=chunk%2F1+%23");
  });

  it("applies the upload count, MIME and aggregate payload rules", () => {
    const pdf = { type: "application/pdf", size: 100 };
    expect(validateFiles(Array.from({ length: 5 }, () => pdf))).toBeNull();
    expect(validateFiles(Array.from({ length: 6 }, () => pdf))).toBe("count");
    expect(validateFiles([{ type: "image/svg+xml", size: 10 }])).toBe("type");
    expect(validateFiles([pdf, { type: "video/mp4", size: CHAT_BYTE_LIMIT }])).toBe("size");
    expect(validateFiles([{ ...pdf, size: 0 }])).toBe("size");
  });
});

describe("source viewer search", () => {
  it("marks a normalized match that spans neighboring PDF text runs", () => {
    expect(pdfMatches([{ str: "The" }, { str: "free  body" }, { str: "diagram" }], "FREE BODY   diagram")).toEqual([1, 2]);
    expect(pdfMatches([{ str: "حلقة" }, { str: "التغذية الراجعة" }], "حلقة التغذية")).toEqual([0, 1]);
    expect(pdfMatches([{ str: "No" }, { str: "match" }], "missing")).toEqual([]);
  });
});
