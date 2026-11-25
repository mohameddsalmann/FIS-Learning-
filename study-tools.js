const { FREE_ROUTING, selectFreeModel } = require("./free-models");

function textField(value, label, limit, inputError) {
    if (typeof value !== "string" || !value.trim() || value.length > limit) {
        throw inputError(label + " must contain 1 to " + limit.toLocaleString("en-US") + " characters.");
    }
    return value.trim();
}

function cosine(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) {
        throw new Error("Invalid embedding");
    }
    let dot = 0;
    let ll = 0;
    let rr = 0;
    for (let i = 0; i < left.length; i++) {
        dot += left[i] * right[i];
        ll += left[i] ** 2;
        rr += right[i] ** 2;
    }
    const magnitude = Math.sqrt(ll * rr);
    if (!Number.isFinite(dot) || !Number.isFinite(magnitude) || magnitude === 0) throw new Error("Invalid embedding");
    return dot / magnitude;
}

function notePassages(notes) {
    return notes.split(/\r?\n+/).flatMap((line) => line.trim().match(/.{1,1200}(?:\s|$)|.{1,1200}/gu) || [])
        .map((passage) => passage.trim()).filter(Boolean);
}

function mountStudyTools(app, { apiKey, inputError, publicError }) {
    function tool(path, work) {
        app.post("/api/study/" + path, async (req, res) => {
            const controller = new AbortController();
            res.once("close", () => controller.abort());
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]);
            const choose = (kind, id) => {
                const model = selectFreeModel(kind, id);
                if (!model) throw inputError("Choose an available free model for this tool.");
                return model.id;
            };
            const call = async (endpoint, body) => {
                if (!apiKey) throw inputError("Set OPENROUTER_API_KEY and restart the server to use this tool.", 503);
                const upstream = await fetch("https://openrouter.ai/api/" + endpoint, {
                    method: "POST",
                    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                    signal,
                });
                if (!upstream.ok) {
                    await upstream.body?.cancel().catch(() => {});
                    throw Object.assign(new Error("OpenRouter request failed"), { status: upstream.status });
                }
                return upstream.json().catch(() => { throw new Error("Invalid OpenRouter response"); });
            };
            try {
                await work(req.body || {}, res, choose, call);
            } catch (error) {
                if (controller.signal.aborted || res.headersSent) return;
                const response = publicError(error);
                res.status(response.status).json({ error: response.error });
            }
        });
    }

    tool("image", async (body, res, choose, call) => {
        const model = choose("image", body.model);
        const prompt = textField(body.prompt, "Image prompt", 2000, inputError);
        const result = await call("v1/images", { model, prompt, n: 1, aspect_ratio: "1:1" });
        const image = result.data?.[0];
        if (typeof image?.b64_json !== "string" || !image.b64_json.length || image.b64_json.length > 15 * 1024 * 1024) {
            throw new Error("Missing image data");
        }
        const bytes = Buffer.from(image.b64_json, "base64");
        const format = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "image/png"
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
            : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
        if (!format) throw new Error("Invalid generated image");
        res.set("Cache-Control", "no-store").type(format).send(bytes);
    });

    tool("check", async (body, res, choose, call) => {
        const model = choose("decision", body.model);
        const question = textField(body.question, "Question", 2000, inputError);
        const answer = textField(body.answer, "Your answer", 4000, inputError);
        const reference = body.reference ? textField(body.reference, "Reference answer", 4000, inputError) : "";
        const criteria = {
            addresses_prompt: {
                type: "noul",
                instructions: "Does the student's answer directly and substantially address what the question asks?",
                criteria: { true: "It addresses the question directly.", false: "It misses or substantially sidesteps the question." },
            },
        };
        if (reference) criteria.agrees_with_reference = {
            type: "noul",
            instructions: "Does the student's answer agree with the essential facts in the reference answer?",
            criteria: { true: "The important facts agree.", false: "Important facts are missing or contradictory." },
        };
        const result = await call("alpha/decisions", {
            model, state: { question, answer, reference }, questions: criteria, provider: FREE_ROUTING,
        });
        const checks = Object.keys(criteria).map((id) => {
            const answer = result.answers?.[id];
            if (answer?.type === "refusal") return { id, probability: null };
            if (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
                throw new Error("Invalid answer check");
            }
            return { id, probability: answer.noul };
        });
        res.json({ checks });
    });

    tool("notes", async (body, res, choose, call) => {
        const model = choose("embedding", body.model);
        const reranker = body.rerank === true ? choose("rerank", body.reranker) : null;
        const query = textField(body.query, "Search query", 1000, inputError);
        const notes = textField(body.notes, "Study notes", 16000, inputError);
        const passages = notePassages(notes);
        if (passages.length > 64) throw inputError("Use up to 64 note passages per search.");
        const result = await call("v1/embeddings", {
            model, input: [query, ...passages], encoding_format: "float", provider: FREE_ROUTING,
        });
        const vectors = new Map(result.data?.map((item) => [item.index, item.embedding]));
        const matches = passages.map((text, index) => ({ text, score: cosine(vectors.get(0), vectors.get(index + 1)) }))
            .sort((left, right) => right.score - left.score).slice(0, 8);
        if (!reranker) return res.json({ passages: matches.slice(0, 5).map(({ text }) => text) });
        const ranked = await call("v1/rerank", {
            model: reranker, query, documents: matches.map(({ text }) => text),
            top_n: Math.min(matches.length, 5), provider: FREE_ROUTING,
        });
        const ordered = ranked.results?.map(({ index }) => matches[index]?.text);
        if (!ordered?.length || ordered.some((text) => !text)) throw new Error("Invalid rerank results");
        res.json({ passages: ordered });
    });
}

module.exports = { mountStudyTools };
