const definitions = [
    ["google/gemma-4-26b-a4b-it", "Gemma 4 26B", "chat", "Text, images and video", ["image", "video"]],
    ["google/gemma-4-31b-it", "Gemma 4 31B", "chat", "Text, images and video", ["image", "video"]],
    ["inclusionai/ling-3.2-flash", "Ling 3.2 Flash", "chat", "Long context and image analysis", ["image"]],
    ["baidu/ernie-5.5-flash-preview", "ERNIE 5.5 Flash Preview", "chat", "Long context and coding"],
    ["thinkingmachines/inkling-2-small", "Inkling 2 Small", "chat", "Reasoning with text and images", ["image"], "2026-11-19"],
    ["liquid/lfm-3-1.7b", "LFM3 1.7B", "chat", "Compact text model. Prompts may be used for training."],
    ["particle-ai/particle-1", "Particle-1", "chat", "Coding and images", ["image"]],
    ["recursive/flint-v1.0", "Flint", "chat", "Coding and debugging"],
    ["nvidia/nemotron-3.5-super-vl", "Nemotron 3.5 Super VL", "chat", "Text, images and video", ["image", "video"]],
    ["dots-studio/dots-3-note-preview", "Dots3 Note Preview", "chat", "Reasoning, coding and images", ["image"], "2026-12-31"],
    ["nvidia/nemotron-3.5-lightning", "Nemotron 3.5 Lightning", "chat", "Fast text responses"],
    ["cohere/north-mini-code", "North Mini Code", "chat", "Coding and long context"],
    ["nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra", "chat", "Detailed reasoning and long context"],
    ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "Nemotron 3 Nano Omni", "chat", "Text, images and video. Avoid private content, voices and faces.", ["image", "video"]],
    ["recraft/recraft-v4.1-flash-v2", "Recraft V4.1 Flash V2", "image", "Generate a study illustration from text", [], "2026-11-28"],
    ["fish-audio/s2.1-pro-free", "Fish Audio S2.1 Pro", "speech", "Read tutor replies aloud"],
    ["heygen/heygen-voice-1-turbo", "HeyGen Voice Turbo", "speech", "Read tutor replies aloud", [], "2026-11-30"],
    ["perplexity/pplx-decider-flash-v1.3", "Decider Flash V1.3", "decision", "Quick answer checks"],
    ["perplexity/pplx-decider-v1.3", "Decider V1.3", "decision", "Answer checks against a reference"],
    ["respan/span-01-lite", "Span-01 Lite", "decision", "Check whether your answer addresses the prompt"],
    ["nvidia/nemotron-3.5-embed-1b", "Nemotron 3.5 Embed 1B", "embedding", "Fast semantic note search"],
    ["nvidia/nemotron-3.5-embed-8b", "Nemotron 3.5 Embed 8B", "embedding", "Semantic note search"],
    ["nvidia/nemotron-3-embed-1b", "Nemotron 3 Embed 1B", "embedding", "Text-based semantic note search"],
    ["nvidia/nemotron-3.5-rerank-8b", "Nemotron 3.5 Rerank 8B", "rerank", "Refine the ranking of note matches"],
];

const MODELS = definitions.map(([id, name, kind, detail, media = [], expires]) => ({
    id: id + ":free", name, kind, detail, media, expires, cost: "free",
}));
const FREE_ROUTING = { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } };

function availableModels(kind) {
    const today = new Date().toISOString().slice(0, 10);
    return MODELS.filter((model) => (!kind || model.kind === kind) && (!model.expires || model.expires > today));
}

function selectFreeModel(kind, id, compatible = () => true) {
    return availableModels(kind).find((model) => (id === undefined || model.id === id) && compatible(model));
}

module.exports = { FREE_ROUTING, availableModels, selectFreeModel };
