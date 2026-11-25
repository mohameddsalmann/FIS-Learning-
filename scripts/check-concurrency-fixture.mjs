import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";

export const fixtureKey = "controlled-product-key";
export const fixturePersonalKey = `sk-or-v1-${"a".repeat(64)}`;
export const geminiKey = "fixture-google-key";
export const geminiSecondaryKey = "fixture-google-secondary-key";
export const blobToken = "vercel_blob_rw_fisfixture_controlled";
const blobOrigin = "https://fisfixture.private.blob.vercel-storage.com";
const firstAnswer = "A spring returns to its original shape";
const primaryModel = "google/gemma-4-26b-a4b-it:free";
const secondaryModel = "google/gemma-4-31b-it:free";
export const nvidiaChatModel = "nvidia/nemotron-3.5-super-vl:free";
const embedModel = "nvidia/nemotron-3.5-embed-1b:free";
const rerankModel = "nvidia/nemotron-3.5-rerank-8b:free";
const geminiModels = new Set(["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-embedding-2"]);
const pricing = { prompt: "0", completion: "0", request: "0" };
const catalog = [
  [primaryModel, "text", "/api/v1/chat/completions"],
  [secondaryModel, "text", "/api/v1/chat/completions"],
  [nvidiaChatModel, "text", "/api/v1/chat/completions"],
  [embedModel, "embeddings", "/api/v1/embeddings"],
  [rerankModel, "rerank", "/api/v1/rerank"],
].map(([id, modality, endpoint]) => ({
  id, name: id, pricing, endpoints: [endpoint], context_length: 64000,
  architecture: { input_modalities: ["text"], output_modalities: [modality] },
  supported_parameters: ["response_format"],
}));

function json(response, status, data) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(data));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    assert(size < 1024 * 1024, "Fixture transport request exceeds its limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function vector(text, dimensions = 3) {
  const prefix = text.includes("Spring elasticity:") ? [0.8, 0.6, 0]
    : text.includes("light load") || text === "spring elasticity" ? [1, 0, 0] : [0.9, 0.1, 0];
  return [...prefix, ...Array(dimensions - prefix.length).fill(0)];
}

function createQuiz(prompt, arabic = false) {
  const quiz = JSON.parse(prompt);
  const source = quiz.excerpts.find(({ page }) => page === 1);
  assert(source.excerpt.includes("Spring elasticity:"));
  const options = arabic ? ["يعود النابض إلى شكله الأصلي", "يبقى مشوّهاً", "يفقد وزنه"]
    : [firstAnswer, "It remains deformed", "It becomes weightless"];
  return JSON.stringify({ questions: [{
    prompt: arabic ? "ماذا يحدث للنابض بعد إزالة القوة؟" : "What does a spring do after a small force is removed?",
    type: "MCQ", options, answer: options[0], sourceIds: [source.id],
    explanation: arabic ? "يعود النابض إلى شكله طالما بقي ضمن حد المرونة."
      : "The material returns to its original shape within its elastic limit.",
  }] });
}

function tutorReply(prompt) {
  const cited = prompt.startsWith("Untrusted course excerpts:");
  if (cited) {
    const excerpts = JSON.parse(prompt.split("\n")[1]);
    assert.equal(excerpts[0].page, 1);
    assert(excerpts[0].excerpt.includes("Spring elasticity:"));
  }
  if (!cited) return ["Elasticity describes reversible deformation.", " A small force is a useful example."];
  if (/Explain the previous topic visually|اشرح الموضوع السابق بصري/u.test(prompt)) {
    const arabic = /[\u0600-\u06ff]/u.test(prompt);
    const diagram = {
      blocks: [{
        type: "diagram", title: arabic ? "دورة مرونة النابض" : "Spring elasticity cycle",
        description: arabic ? "يعود النابض إلى شكله عند إزالة القوة." : "Removing a small force lets the spring recover its shape.",
        grounding: { kind: "illustrative" },
        nodes: [{ id: "loaded", label: arabic ? "قوة صغيرة" : "Small force" }, { id: "released", label: arabic ? "استعادة الشكل" : "Shape restored" }],
        edges: [{ from: "loaded", to: "released" }],
      }, { type: "document_excerpt", source: "S1" }],
    };
    return [arabic ? "يعود النابض إلى شكله الأصلي [S1]." : "A spring recovers its shape [S1].", `\n\n\`\`\`fis-teaching\n${JSON.stringify(diagram)}\n\`\`\``];
  }
  return [/[\u0600-\u06ff]/u.test(prompt) ? "يعود النابض إلى شكله الأصلي عند إزالة القوة" : firstAnswer, " [S1]."];
}

export function studyPdf(pageCount = 6) {
  const pages = [
    "Spring elasticity: a spring returns to its original shape when a small force is removed.",
    "A coil under a light load shortens slightly before the load is removed.",
    "Deformation is a change in the shape of a solid object.",
    "An elastic limit is the threshold beyond which a material is permanently changed.",
    "A ruler bends under a small force and returns when the force is removed.",
    "A gentle force can stretch rubber without permanently changing the material.",
  ];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageIds = [];
  for (const text of pages.slice(0, pageCount)) {
    const id = objects.length + 1;
    const stream = `BT /F1 12 Tf 30 350 Td (${text}) Tj ET`;
    pageIds.push(`${id} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 400] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.join(" ")}] /Count ${pages.length} >>`;
  let file = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const position = file.length;
    file += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(position).padStart(10, "0") + " 00000 n \n";
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file);
}

export async function startBoundary({ includeGemini }) {
  const stats = { uploads: 0, reads: 0, deletes: 0, embeddings: 0, reranks: 0, inferences: 0, geminiInferences: 0,
    openRouterRecoveryCalls: 0, provider429: 0, routeFailures: 0, pool429: 0, poolRoutes: [], paidAttempts: 0, errors: [] };
  const items = new Map();
  let inFlight = 0;
  let peakInFlight = 0;
  async function stream(response, replies, envelope, terminator) {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      await wait(40);
      response.write(`data: ${JSON.stringify(envelope(replies[0]))}\n\n`);
      await wait(30);
      response.end(`data: ${JSON.stringify(envelope(replies[1], true))}\n\n${terminator}`);
    } finally {
      inFlight--;
    }
  }

  async function gemini(request, response, path) {
    assert(includeGemini);
    assert.equal(request.headers["x-goog-api-key"], geminiKey, "The Gemini fixture expects no secondary key rotation after outage or quota.");
    const [name, method] = path.slice("/gemini/v1beta/models/".length).split(":");
    assert(geminiModels.has(name), "Unexpected Gemini model discovery or inference.");
    if (!method) return json(response, 200, {
      name: `models/${name}`, displayName: name, inputTokenLimit: 1048576, outputTokenLimit: 65536,
      supportedGenerationMethods: name === "gemini-embedding-2" ? ["embedContent", "batchEmbedContents"] : ["generateContent"],
    });
    const input = JSON.parse(await body(request));
    const text = (content) => content.parts.map(({ text }) => text).join("\n");
    if (method === "embedContent" || method === "batchEmbedContents") {
      stats.embeddings++;
      const item = ({ content, outputDimensionality }) => ({ values: vector(text(content), outputDimensionality ?? 2048) });
      return json(response, 200, method === "embedContent" ? { embedding: item(input) } : { embeddings: input.requests.map(item) });
    }
    assert(method === "generateContent" || method === "streamGenerateContent");
    stats.geminiInferences++;
    const prompt = text(input.contents.at(-1));
    if (prompt === "fixture provider outage") {
      stats.routeFailures++;
      return json(response, 503, { error: { code: 503, message: "Controlled Gemini outage", status: "UNAVAILABLE" } });
    }
    if (prompt === "fixture provider quota") {
      stats.provider429++;
      return json(response, 429, { error: { code: 429, message: "Controlled Gemini quota", status: "RESOURCE_EXHAUSTED" } });
    }
    if (prompt === "fixture provider timeout") return json(response, 504, { error: { code: 504, message: "Controlled Gemini timeout", status: "DEADLINE_EXCEEDED" } });
    const output = (text, done) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, ...(done ? { finishReason: "STOP" } : {}) }] });
    if (method === "generateContent") return json(response, 200, output(createQuiz(prompt, JSON.stringify(input.systemInstruction ?? "").includes("Respond in Arabic.")), true));
    return stream(response, tutorReply(prompt), output, "");
  }

  async function handle(request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    const path = url.pathname;
    if (path.startsWith("/gemini/v1beta/models/")) return gemini(request, response, path);
    if (path.startsWith("/private-blob/") || path.startsWith("/vercel/api/blob")) {
      assert.equal(request.headers.authorization, `Bearer ${blobToken}`, "A private Blob request requires the fixture storage credential.");
      if (path.startsWith("/private-blob/")) {
        const bytes = items.get(path.slice("/private-blob/".length));
        if (!bytes) return json(response, 404, { error: "Missing fixture PDF" });
        stats.reads++;
        response.writeHead(200, { "content-type": "application/pdf", "content-length": bytes.length });
        return response.end(bytes);
      }
      if (path === "/vercel/api/blob/delete") {
        const { urls } = JSON.parse(await body(request));
        for (const pathname of urls) if (items.delete(pathname)) stats.deletes++;
        return json(response, 200, {});
      }
      const pathname = url.searchParams.get("pathname") ?? url.searchParams.get("url");
      assert.match(pathname ?? "", /^fis-documents\/[a-f\d-]+\.pdf$/);
      if (request.method === "PUT") {
        assert.equal(request.headers["x-vercel-blob-access"], "private");
        assert.equal(items.has(pathname), false);
        items.set(pathname, await body(request));
        stats.uploads++;
      }
      const bytes = items.get(pathname);
      if (!bytes) return json(response, 404, { error: "Missing fixture PDF" });
      return json(response, 200, {
        pathname, size: bytes.length, contentType: "application/pdf", contentDisposition: "inline",
        url: `${blobOrigin}/${pathname}`, downloadUrl: `${blobOrigin}/${pathname}?download=1`, uploadedAt: new Date().toISOString(),
      });
    }
    if (path === "/openrouter/api/v1/models") {
      const modality = url.searchParams.get("output_modalities") ?? "text";
      return json(response, 200, { data: catalog.filter((model) => model.architecture.output_modalities.includes(modality)) });
    }
    if (path.endsWith("/endpoints") && path.startsWith("/openrouter/api/v1/models/")) {
      const id = path.slice("/openrouter/api/v1/models/".length, -"/endpoints".length);
      assert(catalog.some((model) => model.id === id), "Unexpected model verification request.");
      const provider = id.startsWith("google/") ? "Google AI Studio" : "NVIDIA";
      return json(response, 200, { data: { id, endpoints: [{ model_id: id, provider_name: provider, pricing, status: 0 }] } });
    }
    assert([fixtureKey, fixturePersonalKey].some((key) => request.headers.authorization === `Bearer ${key}`), "The fixture only accepts controlled credentials.");
    const input = JSON.parse(await body(request));
    const model = catalog.find((entry) => entry.id === input.model);
    if (!model || Object.values(model.pricing).some((price) => Number(price) !== 0)) stats.paidAttempts++;
    assert(model && stats.paidAttempts === 0, "Expected an allowlisted zero-price model.");
    assert.equal(input.provider?.max_price?.prompt, 0, "Expected zero-cost price ceiling.");
    assert.equal(input.provider?.max_price?.completion, 0, "Expected zero-cost completion ceiling.");
    if (path === "/openrouter/api/v1/embeddings") {
      stats.embeddings++;
      return json(response, 200, { data: input.input.map((text, index) => ({
        index, embedding: vector(text),
      })) });
    }
    if (path === "/openrouter/api/v1/rerank") {
      stats.reranks++;
      const primary = input.documents.findIndex((text) => text.includes("Spring elasticity:"));
      assert(primary >= 0, "The retrieved PDF source must reach the reranker.");
      const rank = [primary, ...input.documents.map((_, index) => index).filter((index) => index !== primary)];
      return json(response, 200, { results: rank.map((index) => ({ index })) });
    }
    assert.equal(path, "/openrouter/api/v1/chat/completions");
    stats.inferences++;
    const prompt = input.messages.at(-1).content;
    if (prompt === "fixture OpenRouter pool quota" || prompt === "fixture NVIDIA still available") {
      stats.poolRoutes.push(input.model);
      if (input.model === primaryModel || input.model === secondaryModel) {
        stats.pool429++;
        stats.provider429++;
        return json(response, 429, { error: { code: 429, message: "Controlled Google shared-pool quota", metadata: {
          limit_source: "upstream_provider_shared_pool", provider_name: "Google AI Studio", headers: { "retry-after": "60" },
        } } });
      }
      assert.equal(input.model, nvidiaChatModel, "NVIDIA is the only eligible route outside the Google pool.");
    }
    if (prompt === "fixture provider quota") {
      stats.provider429++;
      return json(response, 429, { error: { message: "Controlled upstream quota" } });
    }
    if (prompt === "fixture provider timeout") return json(response, 504, { error: { message: "Controlled upstream timeout" } });
    if (prompt === "fixture provider outage") {
      if (!includeGemini && input.model === primaryModel) {
        stats.routeFailures++;
        return json(response, 503, { error: { message: "Controlled upstream outage" } });
      }
      stats.openRouterRecoveryCalls++;
    }
    if (!input.stream) {
      const arabic = input.messages[0].content.includes("Respond in Arabic.");
      return json(response, 200, { choices: [{ message: { content: createQuiz(prompt, arabic) } }] });
    }
    return stream(response, tutorReply(prompt), (content) => ({ choices: [{ delta: { content } }] }), "data: [DONE]\n\n");
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      stats.errors.push(error.name + ": " + error.message.split("\n")[0]);
      if (!response.headersSent) json(response, 400, { error: "Controlled fixture rejected the request." });
      else response.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    origin: `http://127.0.0.1:${server.address().port}`, stats, outstandingFiles: () => items.size,
    takePeak: () => { const peak = peakInFlight; peakInFlight = 0; return peak; },
    close: () => { server.close(); server.closeAllConnections(); },
  };
}
