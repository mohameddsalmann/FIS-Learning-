const $ = (selector) => document.querySelector(selector);
const thread = $("#thread");
const messagesContainer = $("#messagesContainer");
const chatInput = $("#chatInput");
const sendBtn = $("#sendBtn");
const modelCombo = new SearchCombobox("chatModel", (id) => {
    setPreference("fis_model", id);
    updateComposer();
});
const speechCombo = new SearchCombobox("speechModel", (id) => setPreference("fis_speech_model", id));
const retryModels = $("#retryModels");
const storageKey = "fis_conversations";
const mediaFiles = new Map();
const drafts = new Map();
const requests = new Map();
const mobile = matchMedia("(max-width: 800px)");
const attachmentsByType = {
    "image/jpeg": "Image", "image/png": "Image", "image/webp": "Image",
    "application/pdf": "PDF", "video/mp4": "Video",
};
let conversations = readConversations();
let activeId = null;
let pendingAttachments = [];
let editIndex = null;
let loadingAttachment = false;
let models = [];

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function icon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const use = document.createElementNS(ns, "use");
    svg.setAttribute("aria-hidden", "true");
    use.setAttribute("href", "#i-" + name);
    svg.append(use);
    return svg;
}

function getPreference(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function setPreference(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Settings apply for this session. */ }
}

function readConversations() {
    try {
        const saved = JSON.parse(getPreference(storageKey) || "[]");
        return Array.isArray(saved) ? saved.filter((entry) =>
            entry && typeof entry.id === "string" && typeof entry.title === "string" && Array.isArray(entry.messages)) : [];
    } catch {
        return [];
    }
}

function saveConversations() {
    try {
        localStorage.setItem(storageKey, JSON.stringify(conversations));
    } catch {
        announce("Chat history could not be saved on this device.");
    }
}

function announce(text, error = false) {
    const status = $("#composerStatus");
    status.textContent = text;
    status.hidden = !text;
    status.toggleAttribute("data-error", error);
}

function activeConversation() {
    return conversations.find((conversation) => conversation.id === activeId);
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("#themeToggle").setAttribute("aria-pressed", String(theme === "dark"));
}
setTheme(getPreference("fis_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("#themeToggle").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(theme);
    setPreference("fis_theme", theme);
});

function setNavigation(open, focus = true) {
    const show = mobile.matches && open;
    $("#sidebar").classList.toggle("open", show);
    $("#sidebarScrim").hidden = !show;
    $("#main").inert = show;
    $("#sidebarToggle").setAttribute("aria-expanded", String(show));
    if (show) $("#newChatBtn").focus();
    else if (focus && mobile.matches) $("#sidebarToggle").focus();
}
$("#sidebarToggle").addEventListener("click", () => setNavigation(true));
$("#sidebarScrim").addEventListener("click", () => setNavigation(false));
mobile.addEventListener("change", () => setNavigation(false, false));
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#sidebar").classList.contains("open") && !document.querySelector("dialog[open]")) {
        setNavigation(false);
    }
});

const settings = $("#settingsPanel");
$("#settingsToggle").addEventListener("click", () => {
    setNavigation(false, false);
    settings.showModal();
});
settings.addEventListener("close", () => {
    (mobile.matches ? $("#sidebarToggle") : $("#settingsToggle")).focus();
});
document.querySelectorAll("dialog [data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
});
for (const [input, output] of [["temperatureSlider", "tempVal"], ["topPSlider", "topPVal"], ["maxTokensSlider", "maxTokensVal"]]) {
    $("#" + input).addEventListener("input", (event) => { $("#" + output).value = event.target.value; });
}

async function loadModels() {
    modelCombo.setOptions([], "", "Loading models…");
    retryModels.hidden = true;
    try {
        const response = await fetch("/api/models");
        if (!response.ok) throw new Error("Could not load models");
        const list = await response.json();
        models = Array.isArray(list) ? list.filter((entry) => entry.cost === "free" && entry.id?.endsWith(":free")) : [];
        if (!models.some((model) => model.kind === "chat")) throw new Error("No free chat models available");
        syncChatModels();
        speechCombo.setOptions(models.filter((model) => model.kind === "speech"), getPreference("fis_speech_model"));
        announce("");
    } catch {
        models = [];
        modelCombo.setOptions([], "", "Models unavailable");
        speechCombo.setOptions([]);
        retryModels.hidden = false;
        announce("Could not load the free OpenRouter models. Retry to reconnect.", true);
    } finally {
        syncStudyModels();
        updateComposer();
    }
}
retryModels.addEventListener("click", loadModels);

function createConversation(focus = true) {
    const conversation = { id: crypto.randomUUID(), title: "New chat", messages: [], createdAt: Date.now() };
    conversations.unshift(conversation);
    saveConversations();
    switchConversation(conversation.id, focus);
}

function switchConversation(id, focus = false) {
    if (activeId && activeId !== id) {
        stopPlayback();
        drafts.set(activeId, { text: chatInput.value, attachments: pendingAttachments, editIndex });
    }
    if (activeId !== id) {
        const draft = drafts.get(id);
        drafts.delete(id);
        activeId = id;
        chatInput.value = draft?.text || "";
        editIndex = draft?.editIndex ?? null;
        pendingAttachments = draft?.attachments || [];
        renderAttachments();
        if (models.length) syncChatModels();
        announce("");
    }
    setNavigation(false, false);
    renderHistory();
    renderThread();
    updateComposer();
    if (focus) chatInput.focus();
}

function deleteConversation(id) {
    requests.get(id)?.controller.abort();
    const removed = conversations.find((conversation) => conversation.id === id);
    const draft = id === activeId ? pendingAttachments : drafts.get(id)?.attachments || [];
    drafts.delete(id);
    conversations = conversations.filter((conversation) => conversation.id !== id);
    if (id === activeId) pendingAttachments = [];
    pruneMedia();
    for (const attachment of draft) releaseDraftFile(attachment);
    saveConversations();
    if (id === activeId) {
        activeId = null;
        if (conversations.length) switchConversation(conversations[0].id, true);
        else createConversation();
    } else {
        renderHistory();
        $("#newChatBtn").focus();
    }
}

function renderHistory() {
    const recent = conversations.filter((conversation) => conversation.messages.length > 0);
    $("#conversationList").replaceChildren(...recent.map((conversation) => {
        const current = conversation.id === activeId;
        const row = element("div", "history-row" + (current ? " active" : ""));
        const open = element("button", "history-open");
        open.type = "button";
        if (current) open.setAttribute("aria-current", "true");
        open.append(icon("chat"), element("span", "", conversation.title));
        open.addEventListener("click", () => switchConversation(conversation.id, true));
        const remove = element("button", "history-delete");
        remove.type = "button";
        remove.setAttribute("aria-label", "Delete " + conversation.title);
        remove.append(icon("close"));
        remove.addEventListener("click", () => deleteConversation(conversation.id));
        row.append(open, remove);
        return row;
    }));
    if (!recent.length) $("#conversationList").append(element("p", "history-empty", "Your chats will appear here."));
}

$("#newChatBtn").addEventListener("click", () => {
    if (!activeConversation()?.messages.length && activeId) switchConversation(activeId, true);
    else createConversation();
});

function messageText(message) {
    if (typeof message.content === "string") return message.content;
    return Array.isArray(message.content)
        ? message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n")
        : "";
}

function legacyImage(message) {
    const url = Array.isArray(message.content) && message.content.find((part) => part?.type === "image_url")?.image_url?.url;
    return typeof url === "string" && /^data:image\/(jpeg|png|webp);base64,[a-z\d+/=]+$/i.test(url) ? url : null;
}

function storedAttachments(message) {
    return message.attachments || (message.attachment ? [message.attachment] : []);
}

function pruneMedia() {
    const retained = new Set(conversations.flatMap((conversation) =>
        conversation.messages.flatMap((message) => storedAttachments(message).map((attachment) => attachment.id))));
    for (const attachment of [...pendingAttachments, ...[...drafts.values()].flatMap((draft) => draft.attachments)]) {
        retained.add(attachment.id);
    }
    for (const [id, attachment] of mediaFiles) {
        if (!retained.has(id)) {
            URL.revokeObjectURL(attachment.url);
            mediaFiles.delete(id);
        }
    }
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderThread() {
    const conversation = activeConversation();
    if (!conversation) return;
    thread.replaceChildren();
    if (!conversation.messages.length) {
        thread.append($("#welcomeTemplate").content.cloneNode(true));
        return;
    }
    conversation.messages.forEach((message, index) => thread.append(renderMessage(message, index)));
    const request = requests.get(conversation.id);
    if (request) thread.append(renderPending(request));
    scrollToBottom();
}

function action(label, callback) {
    const button = element("button", "message-action", label);
    button.type = "button";
    button.addEventListener("click", callback);
    return button;
}

function renderMessage(message, index) {
    const user = message.role === "user";
    const text = messageText(message);
    const row = element("article", "message " + (user ? "user" : "assistant"));
    const mark = element("span", "message-mark", user ? "Y" : "FIS");
    mark.setAttribute("aria-hidden", "true");
    const body = element("div");
    const heading = element("div", "message-heading");
    heading.append(element("h2", "", user ? "You" : "FIS Tutor"));
    if (message.model) heading.append(element("span", "", message.model));
    const bubble = element("div", "message-bubble" + (message.isError ? " response-error" : ""));
    bubble.dir = "auto";
    if (user || message.isError) bubble.textContent = text;
    else renderMarkdown(bubble, text);
    body.append(heading, bubble);

    for (const attachment of storedAttachments(message)) body.append(renderMessageMedia(attachment));
    const oldImage = legacyImage(message);
    if (oldImage) body.append(renderMessageMedia(null, oldImage));
    const actions = element("div", "message-actions");
    if (text && !message.isError) actions.append(action("Copy", async () => {
        try {
            await navigator.clipboard.writeText(text);
            announce("Copied to clipboard.");
        } catch {
            announce("Clipboard access is unavailable.", true);
        }
    }));

    const conversation = activeConversation();
    const busy = requests.has(conversation.id);
    if (user) {
        const edit = action("Edit", () => editMessage(message, index));
        edit.disabled = busy;
        actions.append(edit);
    } else {
        if (!message.isError && text) {
            const listen = action("Listen", () => playResponse(text, listen));
            actions.append(listen);
        }
        const regenerate = action(message.isError ? "Retry" : "Regenerate", () => regenerateMessage(index));
        regenerate.disabled = busy;
        actions.append(regenerate);
    }
    body.append(actions);
    row.append(mark, body);
    return row;
}

function renderPending(request) {
    const row = element("article", "message assistant streaming");
    const mark = element("span", "message-mark", "FIS");
    mark.setAttribute("aria-hidden", "true");
    const body = element("div");
    const header = element("div", "message-heading");
    header.append(element("h2", "", "FIS Tutor"), element("span", "", request.model.name));
    const bubble = element("div", "message-bubble", request.text || "Waiting for a reply…");
    bubble.dir = "auto";
    if (!request.text) {
        bubble.classList.add("reply-state");
        bubble.setAttribute("role", "status");
    }
    body.append(header, bubble);
    row.append(mark, body);
    return row;
}

function appendInline(parent, text) {
    const tokens = /\x60([^\x60]+)\x60|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
    let offset = 0;
    for (const match of text.matchAll(tokens)) {
        parent.append(text.slice(offset, match.index));
        if (match[1]) parent.append(element("code", "", match[1]));
        else if (match[2]) parent.append(element("strong", "", match[2]));
        else if (match[3]) parent.append(element("em", "", match[3]));
        else {
            let url;
            try { url = new URL(match[5]); } catch { /* Render invalid links as text. */ }
            if (url && ["https:", "http:"].includes(url.protocol)) {
                const link = element("a", "", match[4]);
                link.href = url.href;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                parent.append(link);
            } else parent.append(match[4]);
        }
        offset = match.index + match[0].length;
    }
    parent.append(text.slice(offset));
}

function renderMarkdown(parent, text) {
    const sections = text.replace(/\r\n/g, "\n").split(/(\x60{3}[^\n]*\n[\s\S]*?\x60{3})/);
    for (const section of sections) {
        if (!section.trim()) continue;
        const code = section.match(/^\x60{3}[^\n]*\n([\s\S]*?)\x60{3}$/);
        if (code) {
            const pre = element("pre");
            pre.append(element("code", "", code[1].trimEnd()));
            parent.append(pre);
            continue;
        }
        for (const paragraph of section.trim().split(/\n{2,}/)) {
            const lines = paragraph.split("\n");
            const listPattern = /^\s*(?:[-*•]\s+|\d+\.\s+)/;
            const isList = lines.every((line) => listPattern.test(line));
            const isTable = lines.length >= 2 && lines[0].startsWith("|") && /^\|[\s:|-]+\|?$/.test(lines[1]);
            if (isList) {
                const list = element(/^\s*\d/.test(lines[0]) ? "ol" : "ul");
                for (const line of lines) {
                    const item = element("li");
                    appendInline(item, line.replace(listPattern, ""));
                    list.append(item);
                }
                parent.append(list);
            } else if (isTable) {
                const wrap = element("div", "table-wrap");
                const table = element("table");
                const header = table.createTHead();
                const body = table.createTBody();
                for (const [index, line] of [lines[0], ...lines.slice(2)].entries()) {
                    const row = (index ? body : header).insertRow();
                    for (const cell of line.replace(/^\||\|$/g, "").split("|")) {
                        const entry = element(index ? "td" : "th");
                        if (!index) entry.scope = "col";
                        appendInline(entry, cell.trim());
                        row.append(entry);
                    }
                }
                wrap.append(table);
                parent.append(wrap);
            } else {
                let currentParagraph;
                for (const line of lines) {
                    if (/^#{1,6}\s/.test(line)) {
                        const heading = element("h3");
                        appendInline(heading, line.replace(/^#{1,6}\s+/, ""));
                        parent.append(heading);
                        currentParagraph = null;
                        continue;
                    }
                    if (!currentParagraph) {
                        currentParagraph = element("p");
                        parent.append(currentParagraph);
                    } else currentParagraph.append(element("br"));
                    appendInline(currentParagraph, line);
                }
            }
        }
    }
}

function editMessage(message, index) {
    chatInput.value = messageText(message);
    editIndex = index;
    const previousFiles = storedAttachments(message);
    const files = previousFiles.map((file) => mediaFiles.get(file.id)).filter(Boolean);
    const legacy = recoverLegacyImage(message);
    if (legacy) files.push(legacy);
    setAttachments(files);
    announce(previousFiles.length > files.length
        ? "Reattach any missing files. Sending replaces replies after this message."
        : "Editing a previous message. Sending replaces the replies after it.");
    chatInput.focus();
    updateComposer();
}

function regenerateMessage(index) {
    const conversation = activeConversation();
    if (requests.has(conversation.id) || !models.length) return;
    const previous = conversation.messages[index - 1];
    if (previous?.role !== "user") return;
    const original = storedAttachments(previous);
    const files = original.map((entry) => mediaFiles.get(entry.id)).filter(Boolean);
    if (files.length !== original.length) {
        announce("Edit the previous message and reattach its files before retrying.", true);
        return;
    }
    const legacy = recoverLegacyImage(previous);
    if (legacy) files.push(legacy);
    const model = selectModelFor(files);
    if (!model) {
        if (legacy) releaseDraftFile(legacy);
        return;
    }
    conversation.messages = conversation.messages.slice(0, index);
    pruneMedia();
    saveConversations();
    requestReply(conversation, model, files).finally(() => { if (legacy) releaseDraftFile(legacy); });
}

function updateComposer() {
    const request = requests.get(activeId);
    sendBtn.querySelector("span").textContent = request ? "Stop" : "Send";
    sendBtn.disabled = !request && (!modelCombo.value || loadingAttachment || (!chatInput.value.trim() && !pendingAttachments.length));
    $("#composer").setAttribute("aria-busy", String(loadingAttachment));
    $("#attachBtn").disabled = loadingAttachment || pendingAttachments.length >= maxAttachments;
    $("#videoBtn").disabled = loadingAttachment || pendingAttachments.length >= maxAttachments;
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + "px";
}

function compatibleModels(files) {
    const media = new Set(files.filter(({ file }) => file.type !== "application/pdf")
        .map(({ file }) => file.type === "video/mp4" ? "video" : "image"));
    return models.filter((model) => model.kind === "chat" && [...media].every((kind) => model.media?.includes(kind)));
}

function syncChatModels() {
    modelCombo.setOptions(compatibleModels(pendingAttachments), getPreference("fis_model"), "No compatible models");
}

function selectModelFor(files) {
    const compatible = compatibleModels(files);
    const model = compatible.find((entry) => entry.id === modelCombo.value) || compatible[0];
    if (!model) announce("A compatible free model is unavailable. Reload the model list and try again.", true);
    return model;
}

$("#composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const conversation = activeConversation();
    const inProgress = requests.get(activeId);
    if (inProgress) {
        inProgress.controller.abort();
        return;
    }
    const text = chatInput.value.trim();
    const attachments = pendingAttachments;
    if (!conversation || loadingAttachment || !modelCombo.value || (!text && !attachments.length)) return;
    const model = selectModelFor(attachments);
    if (!model) return;
    if (editIndex !== null) conversation.messages = conversation.messages.slice(0, editIndex);
    const entry = { role: "user", content: text };
    if (attachments.length) {
        entry.attachments = attachments.map((attachment) => {
            mediaFiles.set(attachment.id, attachment);
            return { id: attachment.id, name: attachment.file.name, type: attachment.file.type, duration: attachment.duration };
        });
    }
    conversation.messages.push(entry);
    if (conversation.messages.length === 1) {
        conversation.title = (text || attachments[0].file.name).replace(/\s+/g, " ").slice(0, 60);
    }
    chatInput.value = "";
    editIndex = null;
    drafts.delete(conversation.id);
    setAttachments([]);
    pruneMedia();
    announce("");
    saveConversations();
    renderHistory();
    requestReply(conversation, model, attachments);
});

chatInput.addEventListener("input", updateComposer);
chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !requests.has(activeId)) {
        event.preventDefault();
        if (!sendBtn.disabled) $("#composer").requestSubmit();
    }
});

function modelMessages(messages) {
    return messages.filter((message) => !message.isError).slice(-24).flatMap((message) => {
        const text = messageText(message).trim();
        const files = storedAttachments(message);
        const textWithFallback = text || (files.length || legacyImage(message) ? "Help me understand these attachments." : "");
        return textWithFallback ? [{ role: message.role, content: textWithFallback.slice(0, 16000) }] : [];
    });
}

async function requestReply(conversation, model, attachments) {
    const request = { controller: new AbortController(), model, text: "" };
    requests.set(conversation.id, request);
    if (activeId === conversation.id) {
        renderThread();
        updateComposer();
    }
    const payload = JSON.stringify({
        messages: modelMessages(conversation.messages),
        model: model.id,
        temperature: Number($("#temperatureSlider").value),
        top_p: Number($("#topPSlider").value),
        max_tokens: Number($("#maxTokensSlider").value),
    });
    let body = payload;
    let headers = { "Content-Type": "application/json" };
    if (attachments.length) {
        body = new FormData();
        body.set("chat", payload);
        for (const attachment of attachments) body.append("attachment", attachment.file);
        headers = {};
    }
    let completed = false;
    try {
        const response = await fetch("/api/chat", { method: "POST", headers, body, signal: request.controller.signal });
        if (!response.ok) {
            const info = await response.json().catch(() => ({}));
            throw new Error(info.error || "The request failed. Try again.");
        }
        for await (const data of readEvents(response.body)) {
            if (data === "[DONE]") {
                completed = true;
                break;
            }
            const update = JSON.parse(data);
            if (update.error) throw new Error(update.error);
            if (typeof update.content !== "string") continue;
            request.text += update.content;
            if (activeId === conversation.id) {
                const bubble = thread.querySelector(".streaming .message-bubble");
                if (bubble) {
                    bubble.classList.remove("reply-state");
                    bubble.removeAttribute("role");
                    bubble.textContent = request.text;
                    scrollToBottom();
                }
            }
        }
        if (!completed || !request.text.trim()) throw new Error("The reply was interrupted. Retry to get a complete answer.");
        conversation.messages.push({ role: "assistant", content: request.text, model: model.name });
    } catch (error) {
        if (request.controller.signal.aborted) {
            if (request.text.trim()) conversation.messages.push({ role: "assistant", content: request.text, model: model.name });
            else if (activeId === conversation.id) announce("Reply stopped.");
        } else {
            conversation.messages.push({ role: "assistant", content: error.message, isError: true });
        }
    } finally {
        requests.delete(conversation.id);
        saveConversations();
        if (activeId === conversation.id) {
            renderThread();
            updateComposer();
            if (document.activeElement === sendBtn && sendBtn.disabled) chatInput.focus();
        }
    }
}

async function* readEvents(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith("data:")) yield line.slice(5).trim();
            }
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

thread.addEventListener("click", (event) => {
    const mode = event.target.closest("[data-mode]")?.dataset.mode;
    if (mode === "text") chatInput.focus();
    if (mode === "voice") openVoice();
    if (mode === "video") openVideoPicker();
});

window.addEventListener("DOMContentLoaded", () => {
    if (conversations.length) switchConversation(conversations[0].id);
    else createConversation(false);
    loadModels();
});
