const studyDialog = $("#studyTools");
const studyForm = $("#studyForm");
const studySubmit = $("#studySubmit");
const studyStatus = $("#studyStatus");
const studyResult = $("#studyResult");
const toolConfig = {
    image: { kind: "image", label: "Image model", action: "Create image", pending: "Creating illustration…" },
    check: { kind: "decision", label: "Answer-check model", action: "Check answer", pending: "Checking your answer…" },
    notes: { kind: "embedding", label: "Note search model", action: "Search notes", pending: "Searching your notes…" },
};
let currentTool = "image";
let studyRequest = null;
let studyImageUrl = null;
const studyCombo = new SearchCombobox("studyModel", (id) => setPreference("fis_study_" + currentTool, id));

function syncStudyModels() {
    const config = toolConfig[currentTool];
    $("#studyModelLabel").textContent = config.label;
    const kit = models.filter((model) => model.kind === config.kind);
    studyCombo.setOptions(kit, getPreference("fis_study_" + currentTool), "No free model available");
    studySubmit.disabled = !kit.length || Boolean(studyRequest);
    const rerank = $("#rerankNotes");
    const canRerank = models.some((model) => model.kind === "rerank");
    rerank.disabled = currentTool !== "notes" || !canRerank;
    if (!canRerank) rerank.checked = false;
}

function setStudyStatus(message, error = false) {
    studyStatus.textContent = message;
    studyStatus.toggleAttribute("data-error", error);
}

function clearStudyResult() {
    if (studyImageUrl) URL.revokeObjectURL(studyImageUrl);
    studyImageUrl = null;
    studyResult.hidden = true;
    studyResult.replaceChildren();
}

function changeStudyTool(mode) {
    studyRequest?.abort();
    studyRequest = null;
    currentTool = mode;
    studyForm.querySelectorAll("[data-study-fields]").forEach((group) => {
        group.hidden = group.dataset.studyFields !== mode;
        group.querySelectorAll("input, textarea").forEach((field) => { field.disabled = group.hidden; });
    });
    studySubmit.textContent = toolConfig[mode].action;
    clearStudyResult();
    syncStudyModels();
    setStudyStatus(studyCombo.value ? "" : "This tool currently has no available free model.");
}

$("#studyToolsBtn").addEventListener("click", () => {
    changeStudyTool(currentTool);
    studyDialog.showModal();
});
studyDialog.addEventListener("close", () => {
    studyRequest?.abort();
    studyRequest = null;
    clearStudyResult();
});
studyDialog.querySelectorAll("input[name=studyMode]").forEach((input) => {
    input.addEventListener("change", () => changeStudyTool(input.value));
});

studyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (studyRequest || !studyCombo.value) return;
    const mode = currentTool;
    const fields = new FormData(studyForm);
    const payload = { model: studyCombo.value };
    if (mode === "image") payload.prompt = fields.get("prompt")?.trim();
    if (mode === "check") {
        payload.question = fields.get("question")?.trim();
        payload.answer = fields.get("answer")?.trim();
        payload.reference = fields.get("reference")?.trim();
    }
    if (mode === "notes") {
        payload.query = fields.get("query")?.trim();
        payload.notes = fields.get("notes")?.trim();
        payload.rerank = fields.has("rerank");
    }
    const required = { image: ["prompt"], check: ["question", "answer"], notes: ["query", "notes"] };
    if (required[mode].some((name) => !payload[name])) {
        setStudyStatus("Fill in the required fields.", true);
        studyForm.elements.namedItem(required[mode].find((name) => !payload[name])).focus();
        return;
    }
    clearStudyResult();
    const request = new AbortController();
    studyRequest = request;
    studySubmit.disabled = true;
    setStudyStatus(toolConfig[mode].pending);
    try {
        const response = await fetch("/api/study/" + mode, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload), signal: request.signal,
        });
        if (!response.ok) {
            const details = await response.json().catch(() => ({}));
            throw new Error(details.error || "The study tool could not finish. Try again.");
        }
        const result = mode === "image" ? await response.blob() : await response.json();
        if (studyRequest !== request || !studyDialog.open) return;
        renderStudyResult(mode, result, payload);
        setStudyStatus("Result ready.");
    } catch (error) {
        if (studyRequest === request && !request.signal.aborted) setStudyStatus(error.message, true);
    } finally {
        if (studyRequest === request) {
            studyRequest = null;
            studySubmit.disabled = !studyCombo.value;
        }
    }
});

function renderStudyResult(mode, result, payload) {
    if (mode === "image") {
        studyImageUrl = URL.createObjectURL(result);
        const img = element("img");
        img.src = studyImageUrl;
        img.alt = "Generated illustration for: " + payload.prompt;
        const download = element("a", "message-action", "Download illustration");
        download.href = studyImageUrl;
        download.download = "study-illustration." + (result.type === "image/jpeg" ? "jpg" : result.type.split("/")[1]);
        studyResult.append(img, download);
    } else if (mode === "check") {
        const labels = { addresses_prompt: "Answers the question", agrees_with_reference: "Agrees with your reference" };
        const checks = element("ul");
        for (const { id, probability } of result.checks) {
            checks.append(element("li", "", labels[id] + ": " + (probability === null ? "Unable to assess" : Math.round(probability * 100) + "% likelihood")));
        }
        studyResult.append(checks, element("p", "", "Use these estimates as feedback while reviewing your answer."));
    } else {
        const passages = element("ol");
        for (const passage of result.passages) {
            const item = element("li", "", passage);
            item.dir = "auto";
            passages.append(item);
        }
        studyResult.append(element("h3", "", "Matching passages"), passages);
    }
    studyResult.hidden = false;
}
