"use strict";

function extractSeekTalentPoolFromDom() {
    const rows = [];
    const seen = new Set();

    function isValidCandidateProfileHref(href) {
        if (!href || typeof href !== "string") return false;
        const path = (() => {
            try {
                return new URL(href, window.location.origin).pathname;
            } catch {
                return href.split("?")[0].split("#")[0];
            }
        })();
        if (/talentsearch\/profiles\/search/i.test(path)) return false;
        if (/talentsearch\/profile\/search/i.test(path)) return false;
        if (/\/profiles\/?search$/i.test(path)) return false;
        if (/\/profile\/?search$/i.test(path)) return false;
        if (/talentsearch\/profile\/[^/]+/i.test(path)) return true;
        if (/talentsearch\/profiles\/[^/]+/i.test(path) && !/search$/i.test(path)) return true;
        return false;
    }

    function extractCandidateNameFromLink(anchor, card) {
        if (!anchor) return "";
        const direct = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        if (direct.length > 0 && direct.length <= 80 && !/\bat\s+[A-Za-z]/i.test(direct)) {
            return cleanCandidateName(direct);
        }
        const inner =
            anchor.querySelector(
                "span:first-child, [class*='name' i], [data-testid*='name' i], [data-automation*='name' i], h2, h3, h4",
            ) || card.querySelector("[data-testid*='name' i], [data-automation*='name' i], [class*='candidateName' i]");
        if (inner) {
            const t = (inner.textContent || "").replace(/\s+/g, " ").trim();
            if (t && t.length <= 120) return cleanCandidateName(t);
        }
        return cleanCandidateName(direct);
    }

    function cleanCandidateName(raw) {
        if (!raw) return "";
        let s = String(raw).replace(/\s+/g, " ").trim();
        s = s.split(
            /\s*(Verified credentials|Verified|Add to pool|Updated today|Send job|Send message|Access profile|Download profile|May be approachable)/i,
        )[0].trim();
        s = s.replace(/_[a-z0-9]{5,}/gi, " ").replace(/\s+/g, " ").trim();
        if (s.length <= 70 && !/ at |AUD|annually|months?\)/i.test(s)) return s;
        const atJob = s.search(/\s+at\s+[A-Za-z0-9&]/i);
        if (atJob > 1 && atJob <= 100) return s.slice(0, atJob).trim();
        const dateR = s.search(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*-/i);
        if (dateR > 1 && dateR <= 90) return s.slice(0, dateR).trim();
        const stuck = s.match(
            /^([A-Za-z][A-Za-z\s\-'.]*[A-Za-z])(?=(?:Junior|Senior|Lead|Principal|Chief|Graduate|Trainee|Project|Estimator|Manager|Coordinator|Engineer|Director|Analyst|Planner|Technician|Specialist|Designer|Architect|Surveyor|Supervisor|Buyer|Administrator|Executive|Assistant|Associate|Consultant|Developer|Officer|Representative|Intern|Partner|Head)\b)/i,
        );
        if (stuck) return stuck[1].replace(/\s+/g, " ").trim();
        return s.slice(0, 70).trim();
    }

    const monthYearRangeRegex =
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*-\s*(Present|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i;

    const isVisible = (el) => {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };

    /** First non-empty textContent from any matching element in card. */
    function firstTextInCard(card, selectorCsv) {
        const parts = selectorCsv.split(",").map((p) => p.trim()).filter(Boolean);
        for (const sel of parts) {
            try {
                const el = card.querySelector(sel);
                const t = el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
                if (t) return t;
            } catch {
                /* invalid selector — skip */
            }
        }
        return "";
    }


    function formatUpdatedStatus(raw) {
        if (!raw || typeof raw !== "string") return "";
        const relDisplay = raw.replace(/\s+/g, " ").trim();
        const s = relDisplay;

        if (
            /^updated\s+(?:over\s+(?:a\s+)?year|more\s+than\s+a\s+year)\s+ago/i.test(s) ||
            /^updated\s+over\s+1\s+year\s+ago/i.test(s)
        ) {
            return "over a year";
        }

        const now = new Date();
        let target = null;

        if (/^updated\s+today\b/i.test(s)) {
            target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (/^updated\s+yesterday\b/i.test(s)) {
            target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        } else {
            let m;
            if ((m = s.match(/^updated\s+(\d+)\s+days?\s+ago/i))) {
                const n = parseInt(m[1], 10);
                target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
            } else if ((m = s.match(/^updated\s+(\d+)\s+weeks?\s+ago/i))) {
                const n = parseInt(m[1], 10);
                target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n * 7);
            } else if ((m = s.match(/^updated\s+(?:over\s+)?(\d+)\s+months?\s+ago/i))) {
                const months = parseInt(m[1], 10);
                target = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
            } else if ((m = s.match(/^updated\s+(\d+)\s+years?\s+ago/i))) {
                const yrs = parseInt(m[1], 10);
                target = new Date(now.getFullYear() - yrs, now.getMonth(), now.getDate());
            } else if (/^updated\s+a\s+year\s+ago/i.test(s)) {
                target = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
            }
        }

        if (!target || Number.isNaN(target.getTime())) {
            return relDisplay;
        }

        const monthNames = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ];
        const day = target.getDate();
        const mon = monthNames[target.getMonth()];
        const year = target.getFullYear();
        const absPart = `${day} ${mon} ${year}`;
        const relPart = s.replace(/^updated\b/i, "Updated");
        return `${relPart} - ${absPart}`;
    }

    const stats = {
        profileListItemCount: 0,
        profileLinkCount: 0,
        cardRootsBuilt: 0,
    };

    const profileListSelectors = [
        "[data-testid='profileListItem']",
        "[data-testid*='profileListItem' i]",
        "[data-testid*='ProfileListItem' i]",
        "[data-automation='profile-list-item']",
        "[data-automation*='profile-list-item' i]",
        "[data-automation*='profileListItem' i]",
    ].join(", ");

    const listByTestId = Array.from(document.querySelectorAll(profileListSelectors));
    stats.profileListItemCount = listByTestId.length;

    const anchors = Array.from(
        document.querySelectorAll(
            "a[href*='/talentsearch/profile/'], a[href*='/talentsearch/profiles/'], a[href*='/talent/profile/']",
        ),
    ).filter((a) => isValidCandidateProfileHref(a.getAttribute("href") || ""));
    stats.profileLinkCount = anchors.length;

    const cardRoots = [];
    const rootSeen = new WeakSet();

    const addRoot = (el) => {
        if (!el || rootSeen.has(el)) return;
        rootSeen.add(el);
        cardRoots.push(el);
    };

    for (const el of listByTestId) {
        addRoot(el);
    }

    const cardRootClosestSelectors =
        "[data-testid='profileListItem'], [data-testid*='profileListItem' i], [data-testid*='ProfileListItem' i], [data-automation='profile-list-item'], [data-automation*='profile-list-item' i], [data-automation*='profileListItem' i]";

    for (const a of anchors) {
        const byTest = a.closest(cardRootClosestSelectors) || null;
        let card = byTest || a.closest("article") || a.closest("[role='listitem']") || a.closest("li");
        if (!card) {
            let p = a.parentElement;
            for (let d = 0; d < 14 && p; d += 1) {
                const len = (p.innerText || "").length;
                if (len > 120 && len < 12000) {
                    card = p;
                    break;
                }
                p = p.parentElement;
            }
        }
        if (card) addRoot(card);
    }

    stats.cardRootsBuilt = cardRoots.length;

    const cards = cardRoots.filter((el) => isVisible(el));

    const locationSelectors = [
        "[data-automation='location']",
        "[data-automation*='location' i]",
        "[data-testid='location']",
        "[data-testid*='location' i]",
        "[data-testid*='Location' i]",
        "[aria-label*='location' i]",
    ].join(", ");

    const salarySelectors = [
        "[data-automation='salary']",
        "[data-automation*='salary' i]",
        "[data-automation*='salaryExpectation' i]",
        "[data-testid='salary']",
        "[data-testid*='salary' i]",
        "[data-testid*='Salary' i]",
        "[aria-label*='salary' i]",
    ].join(", ");

    const nameFallbackSelectors = [
        "[data-testid='name']",
        "[data-testid*='candidate-name' i]",
        "[data-testid*='candidateName' i]",
        "[data-automation='candidate-name']",
        "[data-automation*='candidate-name' i]",
        "[data-automation*='candidateName' i]",
    ].join(", ");

    for (const card of cards) {
        if (!card) continue;

        const profileLinks = Array.from(
            card.querySelectorAll(
                "a[href*='/talentsearch/profile/'], a[href*='/talentsearch/profiles/'], a[href*='/talent/profile/']",
            ),
        ).filter((a) => isValidCandidateProfileHref(a.getAttribute("href") || ""));

        if (profileLinks.length === 0) continue;

        let profileLink = profileLinks[0] || null;
        let shortest = profileLink;
        let shortestLen = (shortest.textContent || "").length;
        for (const pl of profileLinks) {
            const len = (pl.textContent || "").length;
            if (len > 0 && len < shortestLen) {
                shortestLen = len;
                shortest = pl;
            }
        }
        if (shortestLen > 0 && shortestLen < 200) profileLink = shortest;

        const href = profileLink ? profileLink.getAttribute("href") || "" : "";
        if (!isValidCandidateProfileHref(href)) continue;

        let name = extractCandidateNameFromLink(profileLink, card);
        if (!name || name.length > 100) {
            name = firstTextInCard(card, nameFallbackSelectors);
            if (!name) {
                for (const sel of ["h1", "h2", "h3", "h4"]) {
                    const h = card.querySelector(sel);
                    const t = (h && (h.textContent || "").trim()) || "";
                    if (t.length > 1 && t.length < 100) {
                        name = cleanCandidateName(t);
                        break;
                    }
                }
            } else {
                name = cleanCandidateName(name);
            }
        }
        name = cleanCandidateName(name || "");

        let location = firstTextInCard(card, locationSelectors);
        let salary = firstTextInCard(card, salarySelectors);

        const cardText = card.innerText || card.textContent || "";
        const updatedMatch = cardText.match(/Updated\s+[^\n\r]+/i);
        const updatedStatus = formatUpdatedStatus(updatedMatch ? updatedMatch[0] : "");

        const rawLines = cardText
            .split(/\n+/)
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean);

        const careerLines = rawLines.filter((line) => monthYearRangeRegex.test(line)).slice(0, 2);

        const parseCareerLine = (line) => {
            const d = line.match(
                /((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*-\s*(Present|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\s*(\([^)]*\))?)/i,
            );
            if (!d) return { career: line || "", duration: "" };
            return {
                career: (line || "").replace(d[1], "").replace(/\s+/g, " ").trim(),
                duration: d[1].replace(/\s+/g, " ").trim(),
            };
        };

        const c1 = parseCareerLine(careerLines[0] || "");
        const c2 = parseCareerLine(careerLines[1] || "");

        const locationFromText =
            rawLines.find((line) =>
                /(NSW|VIC|QLD|WA|SA|TAS|ACT|NT|AU|MY)\b/i.test(line) &&
                /,/.test(line) &&
                !/Updated|Send job|Send message|Download profile|Access profile|Add to pool|Verified/i.test(line),
            ) || "";

        const salaryFromText =
            rawLines.find((line) => /(AUD|MYR|\$|annually|monthly|\+)/i.test(line)) || "";

        location = location || locationFromText;
        salary = salary || salaryFromText;

        if (!href || !isValidCandidateProfileHref(href)) continue;
        if (!name && !monthYearRangeRegex.test(cardText)) continue;
        const rowKey = href || `${name}|${c1.career}|${location}|${updatedStatus}`;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);

        const profileUrl = href
            ? href.startsWith("http")
                ? href
                : `${window.location.origin}${href}`
            : "";

        rows.push({
            fullName: name,
            career1: c1.career,
            duration1: c1.duration,
            career2: c2.career,
            duration2: c2.duration,
            location,
            salaryExpectation: salary,
            updatedStatus,
            profileUrl,
        });
    }

    return { rows, stats };
}

function isSeekTalentResultsUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (!url.includes("au.employer.seek.com")) return false;
    return url.includes("/talentsearch/search") || url.includes("/talentsearch/pooling/pool");
}

function csvEscapeCell(value) {
    const s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function rowsToCsv(rows) {
    const headers = [
        "fullName",
        "career1",
        "duration1",
        "career2",
        "duration2",
        "location",
        "salaryExpectation",
        "updatedStatus",
        "profileUrl",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
        lines.push(headers.map((h) => csvEscapeCell(r[h])).join(","));
    }
    return lines.join("\r\n");
}

/** UTF-8 BOM helps Excel recognise encoding when opening CSV. */
function downloadCsvForExcel(csvText, baseName) {
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    //const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `${baseName}.csv`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
    const backButton = document.querySelector(".back-button");
    const extractExportButton = document.getElementById("extractExportButton");
    const extractionStatus = document.getElementById("extractionStatus");

    if (backButton) {
        backButton.addEventListener("click", () => {
            window.location.href = "../index.html";
        });
    }

    function setStatus(text) {
        if (extractionStatus) extractionStatus.textContent = text;
    }

    if (extractExportButton) {
        extractExportButton.addEventListener("click", () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab || tab.id == null) {
                    setStatus("Could not find active tab.");
                    return;
                }

                if (!isSeekTalentResultsUrl(tab.url || "")) {
                    setStatus("Open a SEEK Talent Pool in this window first.");
                    return;
                }

                setStatus("Extracting…");
                extractExportButton.disabled = true;

                chrome.scripting.executeScript(
                    {
                        target: { tabId: tab.id },
                        func: extractSeekTalentPoolFromDom,
                    },
                    (results) => {
                        extractExportButton.disabled = false;

                        if (chrome.runtime.lastError) {
                            setStatus(chrome.runtime.lastError.message || "Extraction failed.");
                            return;
                        }

                        const res = results && results[0] && results[0].result;
                        if (!res || !Array.isArray(res.rows)) {
                            setStatus("No data returned from page.");
                            return;
                        }

                        const { rows } = res;
                        if (rows.length === 0) {
                            setStatus("No candidates found on this page.");
                            return;
                        }

                        const csv = rowsToCsv(rows);
                        downloadCsvForExcel(csv, "seek-talent-pool");
                        setStatus(`Exported ${rows.length} candidate(s) to CSV.`);
                    },
                );
            });
        });
    }
});
