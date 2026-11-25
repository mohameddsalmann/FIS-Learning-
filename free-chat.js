const multer = require("multer");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { FREE_ROUTING, availableModels, selectFreeModel } = require("./free-models");
const { mountStudyTools } = require("./study-tools");

const MAX_ATTACHMENTS = 5;
const MEDIA_LIMIT = 6 * 1024 * 1024;
const TOTAL_MEDIA_LIMIT = 20 * 1024 * 1024;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MEDIA_LIMIT, files: MAX_ATTACHMENTS, fields: 1, fieldSize: 1024 * 1024, parts: MAX_ATTACHMENTS + 2 },
});

const mediaTypes = {
    "image/jpeg": (bytes) => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
    "image/png": (bytes) => bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    "image/webp": (bytes) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
    "video/mp4": (bytes) => bytes.toString("ascii", 4, 8) === "ftyp",
    "application/pdf": (bytes) => bytes.toString("ascii", 0, 5) === "%PDF-",
};

function inputError(message, status = 400) {
    return Object.assign(new Error(message), { status, public: true });
}

function getChatInput(req, containsInsults, buildEducationPrompt) {
    const body = req.is("multipart/form-data") ? JSON.parse(req.body.chat || "null") : req.body;
    const { messages, model, temperature, top_p, max_tokens } = body || {};
    const files = req.files || [];
    if (files.reduce((size, file) => size + file.size, 0) > TOTAL_MEDIA_LIMIT) {
        throw inputError("Attachments must be 20 MB or less in total.", 413);
    }
    const attachmentKinds = new Set(files.filter((file) => file.mimetype !== "application/pdf")
        .map((file) => file.mimetype === "video/mp4" ? "video" : "image"));
    const selected = selectFreeModel("chat", model, (entry) => [...attachmentKinds].every((kind) => entry.media.includes(kind)));
    if (!selected) throw inputError("Choose an available OpenRouter free chat model that supports every attachment.");
    if (!Array.isArray(messages) || !messages.length || messages.length > 24) {
        throw inputError("Send between 1 and 24 conversation messages.");
    }
    const history = messages.map((message) => {
        if (!["user", "assistant"].includes(message?.role) || typeof message.content !== "string"
            || message.content.length > 16000 || !message.content.trim()) {
            throw inputError("Chat history must contain valid text messages.");
        }
        return { role: message.role, content: message.content.trim() };
    });
    if (history.at(-1).role !== "user") throw inputError("The last message must be from the student.");
    if (containsInsults(history.at(-1).content)) throw inputError("Please keep the conversation respectful.");

    const bounded = (value, fallback, min, max) => Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    return {
        selected, history, files, system: buildEducationPrompt(selected.name),
        settings: {
            temperature: bounded(temperature, 0.7, 0, 2),
            top_p: bounded(top_p, 1, 0.01, 1),
            max_tokens: Math.floor(bounded(max_tokens, 2048, 256, 4096)),
        },
    };
}

async function attachmentParts(file) {
    const { mimetype, buffer, originalname } = file;
    if (!Object.hasOwn(mediaTypes, mimetype) || !mediaTypes[mimetype](buffer)) {
        throw inputError("Choose a valid MP4, PNG, JPEG, WebP, or PDF file.", 415);
    }
    if (mimetype === "application/pdf") {
        const parsed = await pdfParse(Uint8Array.from(buffer), { max: 20 }).catch(() => null);
        const text = parsed?.text?.trim();
        if (!text) throw inputError("This PDF has no readable text. Choose a text-based, unlocked PDF.", 422);
        return [{ type: "text", text: `Extracted PDF text from ${originalname} (reference material):\n${text.slice(0, 20000)}` }];
    }
    const partType = mimetype === "video/mp4" ? "video_url" : "image_url";
    return [
        { type: "text", text: "Attachment: " + originalname },
        { type: partType, [partType]: { url: `data:${mimetype};base64,${buffer.toString("base64")}` } },
    ];
}

function publicError(error) {
    if (error.public) return { status: error.status, error: error.message };
    if (error instanceof SyntaxError) return { status: 400, error: "The request contains invalid JSON." };
    if (error instanceof multer.MulterError || error.type === "entity.too.large") {
        return { status: 413, error: "Send up to five attachments, 6 MB each and 20 MB total, with a valid chat request." };
    }
    if ([401, 403].includes(error.status)) {
        return { status: 503, error: "OpenRouter rejected the configured API key or account access. Check the key and restart the server." };
    }
    if (error.status === 429) return { status: 429, error: "The free OpenRouter quota is busy or exhausted. Try again later." };
    return { status: 502, error: "The free OpenRouter request did not complete. Try again in a moment." };
}

function sendEvent(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function wavHeader(size) {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(size + 36, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(44100, 24);
    header.writeUInt32LE(88200, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(size, 40);
    return header;
}

function mountFreeChat(app, { client, apiKey, containsInsults, buildEducationPrompt }) {
    app.get("/api/models", (_req, res) => res.json(availableModels()));

    app.post("/api/chat", upload.array("attachment", MAX_ATTACHMENTS), async (req, res) => {
        const controller = new AbortController();
        res.once("close", () => controller.abort());
        try {
            const { selected, history, files, system, settings } = getChatInput(req, containsInsults, buildEducationPrompt);
            const latest = history.at(-1);
            if (files.length) {
                const parts = await Promise.all(files.map(attachmentParts));
                if (files.every((file) => file.mimetype === "application/pdf")) {
                    latest.content += "\n\n" + parts.flat().map((part) => part.text).join("\n\n");
                } else {
                    latest.content = [{ type: "text", text: latest.content }, ...parts.flat()];
                }
            }
            if (!client) throw inputError("Set OPENROUTER_API_KEY and restart the server to send a message.", 503);
            const stream = await client.chat.completions.create({
                model: selected.id,
                messages: [system, ...history],
                stream: true,
                provider: FREE_ROUTING,
                ...settings,
            }, { signal: controller.signal });

            res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
            res.flushHeaders();
            let hasContent = false;
            for await (const chunk of stream) {
                const choice = chunk.choices?.[0];
                if (chunk.error || choice?.finish_reason === "error") throw new Error("Inference interrupted");
                if (choice?.delta?.content) {
                    hasContent = true;
                    sendEvent(res, { content: choice.delta.content });
                }
            }
            if (!hasContent) throw new Error("Empty model response");
            res.end("data: [DONE]\n\n");
        } catch (error) {
            if (controller.signal.aborted) return;
            const response = publicError(error);
            if (res.headersSent) {
                sendEvent(res, { error: response.error });
                res.end();
            } else {
                res.status(response.status).json({ error: response.error });
            }
        }
    });

    app.post("/api/tts", async (req, res) => {
        const { text, model } = req.body || {};
        const selected = selectFreeModel("speech", model);
        if (!selected || typeof text !== "string"
            || !text.trim() || text.length > 4000) {
            return res.status(400).json({ error: "Read-aloud requires up to 4,000 characters and the free speech model." });
        }
        if (!apiKey) return res.status(503).json({ error: "Set OPENROUTER_API_KEY and restart the server to use read-aloud." });

        const controller = new AbortController();
        res.once("close", () => controller.abort());
        try {
            const pcm = selected.id === "heygen/heygen-voice-1-turbo:free";
            const upstream = await fetch("https://openrouter.ai/api/v1/audio/speech", {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: selected.id, input: text.trim(), response_format: pcm ? "pcm" : "mp3",
                    ...(pcm ? { voice: "nadine" } : {}),
                }),
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
            });
            const contentType = upstream.headers.get("content-type") || "";
            if (!upstream.ok || !upstream.body || !(contentType.startsWith("audio/") || contentType.startsWith("application/octet-stream"))) {
                await upstream.body?.cancel();
                throw Object.assign(new Error("Speech unavailable"), { status: upstream.status });
            }
            if (pcm) {
                const samples = Buffer.from(await upstream.arrayBuffer());
                if (!samples.length || samples.length % 2 !== 0 || samples.length > 20 * 1024 * 1024) throw new Error("Invalid speech audio");
                res.set("Cache-Control", "no-store").type("audio/wav").send(Buffer.concat([wavHeader(samples.length), samples]));
                return;
            }
            res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
            await pipeline(Readable.fromWeb(upstream.body), res);
        } catch (error) {
            if (controller.signal.aborted || res.headersSent) return;
            const response = publicError(error);
            res.status(response.status).json({ error: response.error });
        }
    });

    mountStudyTools(app, { apiKey, inputError, publicError });

    app.use("/api", (error, _req, res, _next) => {
        const response = publicError(error);
        res.status(response.status).json({ error: response.error });
    });
}

module.exports = { mountFreeChat };
