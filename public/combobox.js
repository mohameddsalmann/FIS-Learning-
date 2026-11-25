class SearchCombobox {
    constructor(id, onSelect = () => {}) {
        this.input = document.getElementById(id);
        this.root = this.input.closest(".combobox");
        this.list = document.createElement("div");
        this.list.id = id + "-listbox";
        this.list.className = "combo-list";
        this.list.setAttribute("role", "listbox");
        const label = this.input.labels[0];
        if (label) {
            label.id ||= id + "-label";
            this.list.setAttribute("aria-labelledby", label.id);
        }
        this.list.hidden = true;
        this.status = document.createElement("span");
        this.status.className = "sr-only";
        this.status.setAttribute("role", "status");
        this.root.append(this.list, this.status);
        this.input.setAttribute("aria-controls", this.list.id);
        this.onSelect = onSelect;
        this.options = [];
        this.matches = [];
        this.active = -1;
        this.value = "";
        const trigger = this.root.querySelector("button");
        trigger.addEventListener("mousedown", (event) => event.preventDefault());
        trigger.addEventListener("click", () => {
            if (!this.list.hidden) this.close();
            else {
                this.input.focus();
                this.open();
            }
        });
        this.input.addEventListener("focus", () => this.input.select());
        this.input.addEventListener("click", () => this.open());
        this.input.addEventListener("input", () => this.render(this.input.value));
        this.input.addEventListener("keydown", (event) => this.keydown(event));
        this.input.addEventListener("blur", () => this.close());
        this.list.addEventListener("mousedown", (event) => {
            if (event.target.closest("[role=option]")) event.preventDefault();
        });
        this.list.addEventListener("click", (event) => {
            const row = event.target.closest("[role=option]");
            if (row) this.commit(this.matches[Number(row.dataset.index)]);
        });
        window.addEventListener("resize", () => this.position());
        this.root.closest("dialog")?.addEventListener("scroll", () => this.position(), { passive: true });
    }

    setOptions(options, preferred = this.value, empty = "No options available") {
        this.options = options;
        this.value = options.find((option) => option.id === preferred)?.id || options[0]?.id || "";
        this.input.placeholder = options.length ? "Search options…" : empty;
        this.setDisabled(!options.length);
        this.close();
    }

    setDisabled(disabled) {
        this.input.disabled = disabled;
        this.root.querySelector("button").disabled = disabled;
        if (disabled) this.close();
    }

    open() {
        if (this.input.disabled || !this.list.hidden) return;
        this.render("");
        this.input.select();
    }

    render(query) {
        if (this.input.disabled) return;
        const words = query.trim().toLowerCase().split(/\s+/);
        this.matches = this.options.filter((option) => words.every((word) =>
            [option.name, option.id, option.detail].filter(Boolean).join(" ").toLowerCase().includes(word)));
        this.active = -1;
        this.input.removeAttribute("aria-activedescendant");
        this.list.replaceChildren(...this.matches.map((option, index) => {
            const row = document.createElement("div");
            row.className = "combo-option";
            row.id = this.list.id + "-" + index;
            row.dataset.index = index;
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", String(option.id === this.value));
            const name = document.createElement("strong");
            name.textContent = option.name;
            row.append(name);
            if (option.detail || option.expires) {
                const detail = document.createElement("small");
                const end = option.expires && new Date(option.expires + "T00:00:00Z").toLocaleDateString("en", {
                    month: "short", day: "numeric", timeZone: "UTC",
                });
                detail.textContent = [option.detail, end && "Free until " + end].filter(Boolean).join(" · ");
                row.append(detail);
            }
            return row;
        }));
        this.status.textContent = this.matches.length ? "" : "No matching options.";
        if (!this.matches.length) {
            const empty = document.createElement("p");
            empty.className = "combo-empty";
            empty.setAttribute("aria-hidden", "true");
            empty.textContent = "No matching options.";
            this.list.append(empty);
        }
        this.input.setAttribute("aria-expanded", "true");
        this.list.hidden = false;
        this.list.scrollTop = 0;
        this.position();
    }

    position() {
        if (this.list.hidden) return;
        const anchor = this.root.getBoundingClientRect();
        const margin = 10;
        const hasWideOptions = this.root.classList.contains("combo-wide");
        const width = Math.min(window.innerWidth - 2 * margin, Math.max(anchor.width, hasWideOptions ? 340 : 0));
        const below = window.innerHeight - anchor.bottom - margin;
        const above = anchor.top - margin;
        const upward = below < 170 && above > below;
        this.list.style.inlineSize = width + "px";
        this.list.style.left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin)) + "px";
        this.list.style.maxBlockSize = Math.min(300, Math.max(40, (upward ? above : below) - 5)) + "px";
        this.list.style.top = upward ? "auto" : anchor.bottom + 5 + "px";
        this.list.style.bottom = upward ? window.innerHeight - anchor.top + 5 + "px" : "auto";
    }

    close() {
        this.list.hidden = true;
        this.active = -1;
        this.input.setAttribute("aria-expanded", "false");
        this.input.removeAttribute("aria-activedescendant");
        this.input.value = this.options.find((option) => option.id === this.value)?.name || "";
        this.status.textContent = "";
    }

    commit(option) {
        if (!option) return;
        this.value = option.id;
        this.close();
        this.onSelect(option.id);
    }

    keydown(event) {
        if (event.isComposing) return;
        const { key } = event;
        if (key === "ArrowDown" || key === "ArrowUp") {
            event.preventDefault();
            this.open();
            if (!this.matches.length) return;
            const last = this.matches.length - 1;
            this.active = key === "ArrowDown" ? Math.min(this.active + 1, last)
                : this.active < 0 ? last : Math.max(0, this.active - 1);
            this.list.querySelector(".active-option")?.classList.remove("active-option");
            const row = this.list.children[this.active];
            row.classList.add("active-option");
            this.input.setAttribute("aria-activedescendant", row.id);
            row.scrollIntoView({ block: "nearest" });
        } else if (!this.list.hidden && (key === "Enter" || key === "Escape")) {
            event.preventDefault();
            event.stopPropagation();
            if (key === "Enter" && this.matches[this.active]) this.commit(this.matches[this.active]);
            else this.close();
        }
    }
}
