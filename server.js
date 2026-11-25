require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const path = require("node:path");
const { mountFreeChat } = require("./free-chat");

const app = express();
const PORT = process.env.PORT || 3000;
const apiKey = process.env.OPENROUTER_API_KEY?.trim();

const BANNED_TERMS = [
    /\b(fuck|shit|bitch|asshole|bastard|dumbass|idiot|moron|jerk)\b/i,
    /(احا|كسم|قحب|شرموط|خرا|زب|منيك|يلعن|تفوو|وسخ)/i,
];
function containsInsults(content) {
    const texts = [];
    if (typeof content === "string") {
        texts.push(content);
    } else if (Array.isArray(content)) {
        content.forEach((part) => {
            if (part?.type === "text" && typeof part.text === "string") {
                texts.push(part.text);
            }
        });
    }
    return texts.some((text) => BANNED_TERMS.some((regex) => regex.test(text)));
}

const buildEducationPrompt = (modelName) => ({
    role: "system",
    content: [
        "You are the FIS learning assistant, a patient tutor for school and university students.",
        "Match the student's language, including Arabic or English. Explain with examples and build from what the student knows.",
        "For problems, show the steps and explain why they work. For writing help, guide the structure and give constructive feedback.",
        "Protect academic integrity, be honest when unsure, and keep the conversation respectful.",
        "Use short paragraphs, structure longer answers with headings or lists, and end with one brief check for understanding where appropriate.",
        "Use attachments as reference material. Describe only what you can infer from the file, and explain limits or uncertainty plainly.",
        "You are answering through " + modelName + " in FIS Chatbot.",
    ].join(" "),
});

const client = apiKey ? new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    maxRetries: 0,
    timeout: 60000,
    defaultHeaders: { "HTTP-Referer": "http://localhost:" + PORT, "X-Title": "FIS Chatbot" },
}) : null;

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            imgSrc: ["'self'", "blob:", "data:"],
            mediaSrc: ["'self'", "blob:"],
            upgradeInsecureRequests: null,
        },
    },
}));
app.use("/api", rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: Number(process.env.RATE_LIMIT_MAX) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Wait a moment and try again." },
}));
app.use("/api", express.json({ limit: "1mb" }));
mountFreeChat(app, { client, apiKey, containsInsults, buildEducationPrompt });

app.all(["/api/realtime-provider", "/api/realtime-session", "/api/speech-to-speech", "/api/doc-to-video", "/api/video-status/:jobId"], (_req, res) => {
    res.status(410).json({ error: "This legacy provider route has been retired. Use the free chat workspace." });
});
app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown API route." }));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
    console.log("FIS Chatbot server running at http://localhost:" + PORT);
});
