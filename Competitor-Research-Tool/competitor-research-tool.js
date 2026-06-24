"use strict";

const STORAGE_KEY = "competitorResearchSaves";

function isSeekTalentSearchUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
        const u = new URL(url);
        return (
            u.hostname === "au.employer.seek.com" &&
            u.pathname.startsWith("/talentsearch/search/")
        );
    } catch {
        return false;
    }
}

/** Parse `company=` from SEEK search URL (semicolon-separated, URL-decoded). */
function parseCompaniesFromSeekUrl(url) {
    try {
        const companyParam = new URL(url).searchParams.get("company");
        if (!companyParam) return [];
        return companyParam
            .split(";")
            .map((name) => name.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

function formatSavedAt(ms) {
    return new Date(ms).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}

function createId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadSaves() {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEY, (data) => {
            resolve(Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : []);
        });
    });
}

function writeSaves(saves) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY]: saves }, resolve);
    });
}

async function copyText(text) {
    await navigator.clipboard.writeText(text);
}

document.addEventListener("DOMContentLoaded", () => {
    const backButton = document.querySelector(".back-button");
    const roleNameInput = document.getElementById("roleNameInput");
    const addSearchButton = document.getElementById("addSearchButton");
    const statusEl = document.getElementById("crtStatus");
    const savedSearchList = document.getElementById("savedSearchList");
    const emptyState = document.getElementById("emptyState");

    if (backButton) {
        backButton.addEventListener("click", () => {
            window.location.href = "../index.html";
        });
    }

    function setStatus(text, isError) {
        if (!statusEl) return;
        statusEl.textContent = text || "";
        statusEl.style.color = isError ? "#c0392b" : "#6c757d";
    }

    function renderSavedList(saves) {
        const sorted = [...saves].sort((a, b) => b.savedAt - a.savedAt);

        savedSearchList.querySelectorAll(".crt-saved-item").forEach((el) => el.remove());

        if (sorted.length === 0) {
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;

        sorted.forEach((entry) => {
            const item = document.createElement("article");
            item.className = "crt-saved-item";
            item.dataset.id = entry.id;

            const header = document.createElement("div");
            header.className = "crt-saved-header";

            const nameBtn = document.createElement("button");
            nameBtn.type = "button";
            nameBtn.className = "crt-saved-name";
            nameBtn.textContent = entry.name;
            nameBtn.title = "Open saved SEEK search in new tab";
            nameBtn.addEventListener("click", () => {
                chrome.tabs.create({ url: entry.url });
            });

            const meta = document.createElement("div");
            meta.className = "crt-saved-meta";
            const companyLabel = entry.companies.length === 1 ? "company" : "companies";
            meta.textContent = `${formatSavedAt(entry.savedAt)} · ${entry.companies.length} ${companyLabel}`;

            header.appendChild(nameBtn);
            header.appendChild(meta);

            const actions = document.createElement("div");
            actions.className = "crt-item-actions";

            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "crt-btn-secondary";
            toggleBtn.textContent = "Show companies";

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "crt-btn-secondary";
            copyBtn.textContent = "Copy as list";

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "crt-btn-danger";
            deleteBtn.textContent = "Delete";

            const companiesPanel = document.createElement("div");
            companiesPanel.className = "crt-companies-panel";
            companiesPanel.hidden = true;

            const companiesList = document.createElement("pre");
            companiesList.className = "crt-companies-list";
            companiesList.textContent = entry.companies.join("\n");

            companiesPanel.appendChild(companiesList);

            toggleBtn.addEventListener("click", () => {
                const showing = !companiesPanel.hidden;
                companiesPanel.hidden = showing;
                toggleBtn.textContent = showing ? "Show companies" : "Hide companies";
            });

            copyBtn.addEventListener("click", async () => {
                try {
                    await copyText(entry.companies.join("\n"));
                    const prev = copyBtn.textContent;
                    copyBtn.textContent = "Copied!";
                    setTimeout(() => {
                        copyBtn.textContent = prev;
                    }, 1500);
                } catch {
                    setStatus("Could not copy to clipboard.", true);
                }
            });

            deleteBtn.addEventListener("click", async () => {
                const saves = await loadSaves();
                const next = saves.filter((s) => s.id !== entry.id);
                await writeSaves(next);
                renderSavedList(next);
                setStatus("Deleted.");
            });

            actions.appendChild(toggleBtn);
            actions.appendChild(copyBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(header);
            item.appendChild(actions);
            item.appendChild(companiesPanel);
            savedSearchList.appendChild(item);
        });
    }

    async function refreshList() {
        const saves = await loadSaves();
        renderSavedList(saves);
    }

    if (addSearchButton) {
        addSearchButton.addEventListener("click", () => {
            const name = (roleNameInput.value || "").trim();
            if (!name) {
                setStatus("Enter a role name first.", true);
                roleNameInput.focus();
                return;
            }

            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                const tab = tabs[0];
                if (!tab || !tab.url) {
                    setStatus("Could not read the active tab.", true);
                    return;
                }

                if (!isSeekTalentSearchUrl(tab.url)) {
                    setStatus("Open a SEEK talent search (with company filters) in this window first.", true);
                    return;
                }

                const companies = parseCompaniesFromSeekUrl(tab.url);
                if (companies.length === 0) {
                    setStatus("No companies found in the URL. Apply company filters on SEEK first.", true);
                    return;
                }

                const entry = {
                    id: createId(),
                    name,
                    url: tab.url,
                    companies,
                    savedAt: Date.now(),
                };

                const saves = await loadSaves();
                saves.push(entry);
                await writeSaves(saves);

                roleNameInput.value = "";
                renderSavedList(saves);
                setStatus(`Saved "${name}" (${companies.length} companies).`);
            });
        });
    }

    if (roleNameInput) {
        roleNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") addSearchButton.click();
        });
    }

    refreshList();
});
