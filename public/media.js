const fileInput = $("#fileInput");
const videoInput = $("#videoInput");
const mediaLimit = 6 * 1024 * 1024;
const combinedLimit = 20 * 1024 * 1024;
const maxAttachments = 5;

$("#attachBtn").addEventListener("click", () => fileInput.click());
$("#videoBtn").addEventListener("click", openVideoPicker);
for (const input of [fileInput, videoInput]) {
    input.addEventListener("change", () => {
        if (input.files.length) prepareAttachments([...input.files]);
        input.value = "";
    });
}
chatInput.addEventListener("paste", (event) => {
    const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    prepareAttachments(images);
});

function openVideoPicker() {
    if (loadingAttachment || pendingAttachments.length >= maxAttachments) return;
    announce("Choose MP4 clips up to 60 seconds and 6 MB each.");
    videoInput.click();
}

function createAttachment(file) {
    return { file, url: URL.createObjectURL(file), id: crypto.randomUUID() };
}

function readDuration(url) {
    return new Promise((resolve, reject) => {
        const video = element("video");
        const timer = setTimeout(() => finish(null), 8000);
        function finish(duration) {
            clearTimeout(timer);
            video.onloadedmetadata = video.onerror = null;
            video.removeAttribute("src");
            if (Number.isFinite(duration) && duration > 0) resolve(duration);
            else reject(new Error("Choose an MP4 clip that plays in your browser."));
        }
        video.preload = "metadata";
        video.onloadedmetadata = () => finish(video.duration);
        video.onerror = () => finish(null);
        video.src = url;
    });
}

async function prepareAttachments(files) {
    if (loadingAttachment) return;
    if (pendingAttachments.length >= maxAttachments) {
        announce("You can attach up to five files per message.", true);
        return;
    }
    const owner = activeId;
    const pending = [];
    const errors = new Set();
    let size = pendingAttachments.reduce((total, attachment) => total + attachment.file.size, 0);
    for (let file of files) {
        if (!file.type && /\.mp4$/i.test(file.name)) file = new File([file], file.name, { type: "video/mp4" });
        if (pendingAttachments.length + pending.length >= maxAttachments) {
            errors.add("You can attach up to five files per message.");
            break;
        }
        if (!Object.hasOwn(attachmentsByType, file.type)) {
            errors.add("Use MP4, PNG, JPEG, WebP, or PDF files.");
            continue;
        }
        if (!file.size || file.size > mediaLimit || size + file.size > combinedLimit) {
            errors.add("Files must be nonempty, up to 6 MB each and 20 MB total.");
            continue;
        }
        pending.push(createAttachment(file));
        size += file.size;
    }
    if (!pending.length) {
        announce([...errors].join(" "), true);
        return;
    }
    loadingAttachment = true;
    updateComposer();
    if (pending.some((attachment) => attachment.file.type === "video/mp4")) announce("Checking video clips…");
    const checked = await Promise.all(pending.map(async (attachment) => {
        try {
            if (attachment.file.type === "video/mp4") {
                attachment.duration = await readDuration(attachment.url);
                if (attachment.duration > 60) throw new Error("Trim MP4 clips to 60 seconds or less.");
            }
            return attachment;
        } catch (error) {
            releaseDraftFile(attachment);
            errors.add(error.message);
            return null;
        }
    }));
    loadingAttachment = false;
    const accepted = checked.filter(Boolean);
    if (owner !== activeId) {
        for (const attachment of accepted) releaseDraftFile(attachment);
        updateComposer();
        return;
    }
    const current = modelCombo.value;
    setAttachments([...pendingAttachments, ...accepted]);
    const changed = current && modelCombo.value !== current && modelCombo.value;
    const notice = [...errors];
    if (changed) notice.push("Switched to " + modelCombo.input.value + " for these attachments.");
    announce(notice.join(" "), errors.size > 0);
    chatInput.focus();
}

function releaseDraftFile(attachment) {
    if (!mediaFiles.has(attachment.id)) URL.revokeObjectURL(attachment.url);
}

function setAttachments(next) {
    for (const attachment of pendingAttachments) {
        if (!next.includes(attachment)) releaseDraftFile(attachment);
    }
    pendingAttachments = next;
    renderAttachments();
    if (models.length) syncChatModels();
    updateComposer();
}

function renderAttachments() {
    const preview = $("#attachmentPreview");
    preview.hidden = !pendingAttachments.length;
    $("#attachmentCount").textContent = pendingAttachments.length + " of " + maxAttachments + " attachments · 6 MB each, 20 MB total";
    $("#attachmentList").replaceChildren(...pendingAttachments.map((attachment) => {
        const { file, url, duration } = attachment;
        const kind = attachmentsByType[file.type];
        const item = element("li", "attachment-preview");
        const thumbnail = element("span", "attachment-thumbnail");
        if (kind === "Image") {
            const img = element("img");
            img.alt = "";
            img.src = url;
            thumbnail.append(img);
        } else if (kind === "Video") thumbnail.append(icon("video"));
        else thumbnail.textContent = "PDF";
        const info = element("div", "attachment-info");
        info.title = file.name;
        info.append(element("strong", "", file.name), element("small", "", [
            kind, duration ? Math.ceil(duration) + " sec" : null,
            Math.max(1, Math.round(file.size / 1024)) + " KB",
        ].filter(Boolean).join(" · ")));
        const remove = element("button", "icon-btn");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove " + file.name);
        remove.append(icon("close"));
        remove.addEventListener("click", () => {
            setAttachments(pendingAttachments.filter((file) => file !== attachment));
            pruneMedia();
            announce("");
            chatInput.focus();
        });
        item.append(thumbnail, info, remove);
        return item;
    }));
}

function renderMessageMedia(metadata, oldImage) {
    const figure = element("figure", "message-media");
    const attachment = mediaFiles.get(metadata?.id);
    figure.append(element("figcaption", "", metadata?.name || "Attached image"));
    if (attachment?.file.type === "video/mp4") {
        const video = element("video");
        video.src = attachment.url;
        video.controls = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", "Attached video: " + metadata.name);
        figure.append(video);
    } else if (oldImage || attachment?.file.type.startsWith("image/")) {
        const image = element("img");
        image.alt = metadata?.name || "Attached image";
        image.src = oldImage || attachment.url;
        image.loading = "lazy";
        figure.append(image);
    } else if (!attachment) {
        figure.append(element("small", "", "Reattach this file to send it again."));
    }
    return figure;
}

function recoverLegacyImage(message) {
    const url = legacyImage(message);
    if (!url || url.length > Math.ceil(mediaLimit * 4 / 3) + 40) return null;
    const [header, data] = url.split(",");
    try {
        const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
        const type = header.slice(5, header.indexOf(";"));
        const extension = type.split("/")[1];
        return createAttachment(new File([bytes], "Attached image." + extension, { type }));
    } catch {
        return null;
    }
}

const voiceDialog = $("#voiceDialog");
const voiceLanguage = new SearchCombobox("voiceLanguage", (id) => setPreference("fis_voice_language", id));
voiceLanguage.setOptions([
    { id: "en-US", name: "English" },
    { id: "ar-EG", name: "Arabic (Egypt)", detail: "العربية" },
], getPreference("fis_voice_language"));
const voiceDraft = $("#voiceDraft");
const voiceStart = $("#voiceStart");
const voiceApply = $("#voiceApply");
let recognition = null;
let voiceAttempt = 0;
let voiceInvoker = null;

function openVoice() {
    voiceInvoker = document.activeElement;
    voiceDialog.showModal();
}
$("#voiceBtn").addEventListener("click", openVoice);
voiceDialog.addEventListener("close", () => {
    voiceAttempt++;
    const active = recognition;
    recognition = null;
    active?.abort();
    updateVoiceButtons(false);
    if (voiceInvoker?.isConnected) voiceInvoker.focus();
});
voiceDraft.addEventListener("input", () => {
    voiceApply.disabled = Boolean(recognition) || !voiceDraft.value.trim();
});

function voiceStatus(text, error = false) {
    const status = $("#voiceStatus");
    status.textContent = text;
    status.toggleAttribute("data-error", error);
}

function updateVoiceButtons(recording, checking = false) {
    voiceStart.querySelector("span").textContent = recording ? "Stop dictation" : "Start dictation";
    voiceStart.disabled = checking;
    voiceApply.disabled = recording || checking || !voiceDraft.value.trim();
    voiceLanguage.setDisabled(recording || checking);
    voiceDraft.readOnly = recording;
}

voiceStart.addEventListener("click", async () => {
    if (recognition) {
        recognition.stop();
        return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition?.available || !Recognition?.install || !("processLocally" in Recognition.prototype)) {
        voiceStatus("On-device dictation is unavailable in this browser. You can type your question in the composer.", true);
        return;
    }
    const attempt = ++voiceAttempt;
    const current = () => attempt === voiceAttempt && voiceDialog.open;
    const options = { langs: [voiceLanguage.value], processLocally: true };
    updateVoiceButtons(false, true);
    voiceStatus("Checking on-device dictation…");
    try {
        const availability = await Recognition.available(options);
        if (!current()) return;
        if (availability === "unavailable") throw new Error("This language is unavailable for on-device dictation.");
        if (availability !== "available") {
            voiceStatus("Downloading the browser’s on-device language pack…");
            if (!await Recognition.install(options)) throw new Error("The language pack could not download. Try again.");
            if (!current()) return;
        }
        const session = new Recognition();
        recognition = session;
        session.processLocally = true;
        session.lang = options.langs[0];
        session.interimResults = true;
        session.continuous = true;
        const prefix = voiceDraft.value.trim();
        let failed = false;
        session.onstart = () => {
            if (current()) voiceStatus("Listening on this device…");
        };
        session.onresult = (event) => {
            if (!current()) return;
            const transcript = Array.from(event.results).map((result) => result[0].transcript.trim()).join(" ");
            voiceDraft.value = [prefix, transcript].filter(Boolean).join(" ");
        };
        session.onerror = (event) => {
            if (!current()) return;
            failed = true;
            voiceStatus(event.error === "not-allowed"
                ? "Microphone access was denied. Allow it in your browser to dictate."
                : "Dictation stopped. Check your microphone and try again.", true);
        };
        session.onend = () => {
            if (!current()) return;
            recognition = null;
            updateVoiceButtons(false);
            if (!failed) voiceStatus(voiceDraft.value.trim() ? "Review the transcript before using it." : "Nothing was captured. Try again.");
        };
        updateVoiceButtons(true);
        session.start();
    } catch (error) {
        if (!current()) return;
        recognition = null;
        updateVoiceButtons(false);
        voiceStatus(error.message || "Local dictation could not start.", true);
    }
});

voiceApply.addEventListener("click", () => {
    chatInput.value = [chatInput.value.trim(), voiceDraft.value.trim()].filter(Boolean).join(" ").slice(0, 16000);
    voiceDraft.value = "";
    voiceStatus("Ready to check local dictation.");
    voiceDialog.close();
    updateComposer();
    requestAnimationFrame(() => chatInput.focus());
});

let playback = null;
function stopPlayback() {
    const current = playback;
    if (!current) return;
    playback = null;
    current.controller.abort();
    current.audio?.pause();
    current.audio?.remove();
    if (current.url) URL.revokeObjectURL(current.url);
    current.button.textContent = "Listen";
}

async function playResponse(text, button) {
    if (playback?.button === button) {
        stopPlayback();
        return;
    }
    stopPlayback();
    const current = { button, controller: new AbortController() };
    playback = current;
    button.textContent = "Cancel audio";
    const plain = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[#*\x60]/g, "").trim();
    if (plain.length > 4000) announce("Read-aloud will cover the first 4,000 characters.");
    else announce("");
    try {
        const response = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: plain.slice(0, 4000), model: speechCombo.value || undefined }),
            signal: current.controller.signal,
        });
        if (!response.ok) {
            const details = await response.json().catch(() => ({}));
            throw new Error(details.error || "Speech is unavailable. Try again.");
        }
        const audioData = await response.blob();
        if (playback !== current) return;
        current.url = URL.createObjectURL(audioData);
        current.audio = element("audio", "reply-audio");
        current.audio.setAttribute("aria-label", "Spoken tutor reply");
        current.audio.controls = true;
        current.audio.src = current.url;
        current.audio.addEventListener("ended", stopPlayback);
        current.audio.addEventListener("error", () => {
            if (playback !== current) return;
            announce("This spoken reply could not be played.", true);
            stopPlayback();
        });
        button.closest(".message-actions").after(current.audio);
        button.textContent = "Stop audio";
        await current.audio.play().catch(() => {
            if (playback === current) announce("Use the player to start your spoken reply.");
        });
    } catch (error) {
        if (playback !== current) return;
        announce(error.message, true);
        stopPlayback();
    }
}
