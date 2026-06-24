import { escapeCsvCell, downloadCsvText } from '../utility/csvExport.js';
import { normalizeLinkedinUrl, isValidLinkedinUrl, parseLinkedinProfileUrlsFromText } from '../utility/linkedinUrl.js';

const APOLLO_BATCH_SIZE = 5;
const LUSHA_BATCH_SIZE = 5;
const CONTACTOUT_PRIMARY_BATCH_SIZE = 50;
const CONTACTOUT_FALLBACK_BATCH_SIZES = [25, 10, 5];

/** @typedef {'neutral'|'loading'|'success'|'error'} EnrichmentStatusVariant */

/**
 * @typedef {Object} EnrichmentPipelineDeps
 * @property {(payload: object) => Promise<any>} sendMessage
 * @property {(ev: { text: string, variant?: EnrichmentStatusVariant }) => void} [onStatus]
 * @property {(ev: { value: number, max: number }) => void} [onProgress]
 * @property {(text: string) => void} [onStatsLine]
 * @property {(rows: object[], stats: object) => void | Promise<void>} [persist]
 * @property {(rows: object[]) => void} [downloadCsv]
 */

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
}

function normalizeEmails(values) {
    const arr = Array.isArray(values) ? values : (values ? [values] : []);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return [...new Set(arr.map((v) => String(v || '').trim().toLowerCase()).filter((v) => emailRegex.test(v)))];
}

function normalizePhones(values) {
    const arr = Array.isArray(values) ? values : (values ? [values] : []);
    return [...new Set(arr
        .map((v) => String(v || '').trim())
        .map((v) => {
            const keepPlus = v.startsWith('+');
            const digits = v.replace(/[^\d]/g, '');
            return keepPlus ? `+${digits}` : digits;
        })
        .filter((v) => v.length >= 6))];
}

function valuesFromUnknownList(values, candidates) {
    const arr = Array.isArray(values) ? values : (values ? [values] : []);
    const out = [];
    for (const item of arr) {
        if (typeof item === 'string') {
            out.push(item);
            continue;
        }
        if (item && typeof item === 'object') {
            for (const key of candidates) {
                if (typeof item[key] === 'string' && item[key].trim()) out.push(item[key]);
            }
        }
    }
    return out;
}

function unwrapLushaContact(contact) {
    if (!contact || typeof contact !== 'object') return {};
    const data = contact.data && typeof contact.data === 'object' ? contact.data : contact;
    if (data.contact && typeof data.contact === 'object') return data.contact;
    if (data.person && typeof data.person === 'object') return data.person;
    if (data.profile && typeof data.profile === 'object') return data.profile;
    return data;
}

function toCsv(rows) {
    const header = ['linkedinUrl', 'firstName', 'lastName', 'fullName', 'companyName', 'personalEmails', 'workEmails', 'phoneNumbers'];
    const lines = [header.join(',')];
    rows.forEach((row) => {
        lines.push([
            escapeCsvCell(row.linkedinUrl),
            escapeCsvCell(row.firstName),
            escapeCsvCell(row.lastName),
            escapeCsvCell(row.fullName),
            escapeCsvCell(row.companyName),
            escapeCsvCell(row.personalEmails.join(';')),
            escapeCsvCell(row.workEmails.join(';')),
            escapeCsvCell(row.phoneNumbers.join(';'))
        ].join(','));
    });
    return lines.join('\r\n');
}

function autoDownloadCsv(rows) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadCsvText(toCsv(rows), `enriched-contacts-${stamp}`);
}

function defaultSendRuntimeMessage(payload) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response?.success) return reject(new Error(response?.error || 'Request failed.'));
            resolve(response.data);
        });
    });
}

function createInitialRows(urlText) {
    const urls = parseLinkedinProfileUrlsFromText(urlText);
    return urls.map((linkedinUrl, index) => ({
        contactId: String(index + 1),
        linkedinUrl,
        firstName: '',
        lastName: '',
        fullName: '',
        companyName: '',
        companyDomain: '',
        personalEmails: [],
        workEmails: [],
        phoneNumbers: []
    }));
}

function extractLushaPhones(contact) {
    const unwrapped = unwrapLushaContact(contact);
    const raw = unwrapped?.phoneNumbers || unwrapped?.phones || unwrapped?.revealedPhones || [];
    return normalizePhones(valuesFromUnknownList(raw, ['number', 'value', 'phone', 'e164', 'internationalNumber']));
}

function pickContactOutEmailsForUrl(profilesObj, linkedinUrl) {
    if (!profilesObj || !linkedinUrl) return [];
    if (profilesObj[linkedinUrl]) return normalizeEmails(profilesObj[linkedinUrl]);
    const normalizedTarget = normalizeLinkedinUrl(linkedinUrl);
    for (const [key, value] of Object.entries(profilesObj)) {
        if (normalizeLinkedinUrl(key) === normalizedTarget) return normalizeEmails(value);
    }
    return [];
}

function summarizeRows(rows, stageCounts) {
    return {
        total: rows.length,
        processed: rows.length,
        apolloMatched: stageCounts.apolloMatched,
        withPersonalEmail: rows.filter((r) => r.personalEmails.length > 0).length,
        withWorkEmail: rows.filter((r) => r.workEmails.length > 0).length,
        withPhone: rows.filter((r) => r.phoneNumbers.length > 0).length,
        empty: rows.filter((r) => r.personalEmails.length === 0 && r.phoneNumbers.length === 0 && r.workEmails.length === 0).length,
        failedBatches: stageCounts.apolloFailedBatches + stageCounts.contactOutFailedBatches + stageCounts.lushaFailedBatches,
        contactOutWithPersonal: stageCounts.contactOutWithPersonal,
        lushaEmailFallbackUsed: stageCounts.lushaEmailFallbackUsed
    };
}

/**
 * @param {EnrichmentPipelineDeps} deps
 */
function pipelineCtx(deps) {
    const onStatus = deps.onStatus || (() => {});
    const onProgress = deps.onProgress || (() => {});
    return {
        sendMessage: deps.sendMessage,
        onStatus,
        onProgress
    };
}

async function apolloEnrichStage(rows, apolloApiKey, ctx) {
    const { sendMessage, onStatus, onProgress } = ctx;
    if (!apolloApiKey) {
        onStatus({ text: 'Apollo key not set. Skipping Apollo stage.', variant: 'neutral' });
        return { rows, apolloMatched: 0 };
    }
    onStatus({ text: `Apollo stage: processing ${rows.length} profiles in batches of ${APOLLO_BATCH_SIZE}...`, variant: 'loading' });
    onProgress({ value: 0, max: rows.length });

    const chunks = chunkArray(rows, APOLLO_BATCH_SIZE);
    let processed = 0;
    let apolloMatched = 0;
    for (const chunk of chunks) {
        const results = await sendMessage({
            type: 'fetchApolloDataBulk',
            apiKey: apolloApiKey,
            contacts: chunk.map((row) => ({ contactId: row.contactId, linkedinUrl: row.linkedinUrl }))
        });
        const byId = new Map((results || []).map((r) => [String(r.contactId), r]));
        chunk.forEach((row) => {
            const person = byId.get(String(row.contactId))?.person;
            if (!person) return;
            row.firstName = person.first_name || row.firstName;
            row.lastName = person.last_name || row.lastName;
            row.fullName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
            row.companyName = person.organization?.name || row.companyName || '';
            row.companyDomain = person.organization?.domain || row.companyDomain || '';
            row.workEmails = normalizeEmails([...row.workEmails, ...(person.email ? [person.email] : [])]);
            if (row.workEmails.length > 0) apolloMatched += 1;
        });
        processed += chunk.length;
        onProgress({ value: processed, max: rows.length });
        onStatus({ text: `Apollo stage: ${processed}/${rows.length} processed`, variant: 'loading' });
    }
    return { rows, apolloMatched };
}

async function contactOutChunkWithFallback(rowsChunk, contactOutApiKey, sendMessage, fallbackIndex = 0) {
    try {
        const data = await sendMessage({
            type: 'fetchContactOutBatch',
            apiKey: contactOutApiKey,
            profiles: rowsChunk.map((r) => r.linkedinUrl),
            emailType: 'personal'
        });
        return { data, failed: 0 };
    } catch (error) {
        if (fallbackIndex >= CONTACTOUT_FALLBACK_BATCH_SIZES.length || rowsChunk.length <= 1) {
            return { data: { profiles: {} }, failed: 1 };
        }
        const nextSize = CONTACTOUT_FALLBACK_BATCH_SIZES[fallbackIndex];
        const pieces = chunkArray(rowsChunk, nextSize);
        let mergedProfiles = {};
        let failed = 0;
        for (const piece of pieces) {
            const res = await contactOutChunkWithFallback(piece, contactOutApiKey, sendMessage, fallbackIndex + 1);
            mergedProfiles = { ...mergedProfiles, ...(res.data?.profiles || {}) };
            failed += res.failed;
        }
        return { data: { profiles: mergedProfiles }, failed };
    }
}

async function contactOutEnrichStage(rows, contactOutApiKey, ctx) {
    const { sendMessage, onStatus, onProgress } = ctx;
    onStatus({ text: `ContactOut stage: processing ${rows.length} profiles in batches of ${CONTACTOUT_PRIMARY_BATCH_SIZE}...`, variant: 'loading' });
    onProgress({ value: 0, max: rows.length });

    const chunks = chunkArray(rows, CONTACTOUT_PRIMARY_BATCH_SIZE);
    let processed = 0;
    let failedBatches = 0;
    let withPersonalFromContactOut = 0;
    for (const chunk of chunks) {
        const res = await contactOutChunkWithFallback(chunk, contactOutApiKey, sendMessage, 0);
        const profilesObj = res.data?.profiles || {};
        chunk.forEach((row) => {
            row.personalEmails = pickContactOutEmailsForUrl(profilesObj, row.linkedinUrl);
            if (row.personalEmails.length > 0) withPersonalFromContactOut += 1;
        });
        failedBatches += res.failed;
        processed += chunk.length;
        onProgress({ value: processed, max: rows.length });
        onStatus({ text: `ContactOut stage: ${processed}/${rows.length} processed`, variant: 'loading' });
    }

    return { rows, failedBatches, withPersonalFromContactOut };
}

async function lushaEnrichStage(rows, lushaApiKey, ctx) {
    const { sendMessage, onStatus, onProgress } = ctx;
    onStatus({ text: `Lusha stage: processing ${rows.length} profiles in batches of ${LUSHA_BATCH_SIZE}...`, variant: 'loading' });
    onProgress({ value: 0, max: rows.length });
    const chunks = chunkArray(rows, LUSHA_BATCH_SIZE);
    let processed = 0;
    let failedBatches = 0;
    for (const chunk of chunks) {
        try {
            const data = await sendMessage({
                type: 'fetchLushaPersonBatch',
                apiKey: lushaApiKey,
                contacts: chunk.map((row) => ({
                    contactId: row.contactId,
                    linkedinUrl: row.linkedinUrl,
                    fullName: row.fullName || undefined,
                    companyName: row.companyName || undefined
                }))
            });
            const contactsObj = data?.contacts || {};
            chunk.forEach((row) => {
                const hit = contactsObj[row.contactId] || {};
                row.phoneNumbers = extractLushaPhones(hit);
            });
        } catch (error) {
            failedBatches += 1;
        }
        processed += chunk.length;
        onProgress({ value: processed, max: rows.length });
        onStatus({ text: `Lusha stage: ${processed}/${rows.length} processed`, variant: 'loading' });
    }
    return { rows, failedBatches };
}

/**
 * Deep module: Apollo → ContactOut → Lusha, row shaping, summary. No DOM; effects only via deps.
 *
 * API keys: the pipeline does not re-validate “user filled the form.” For the extension page, non-empty
 * Lusha and ContactOut keys are enforced in the UI before calling in; pass trimmed strings. Apollo may
 * be omitted (empty skips that stage). Wrong or expired keys fail at runtime via `deps.sendMessage` / vendors.
 * Personal emails come only from ContactOut; Lusha is used for phone numbers only.
 *
 * @param {object} input
 * @param {string} input.urlText
 * @param {string} [input.apolloApiKey] optional; empty skips Apollo
 * @param {string} input.lushaApiKey non-empty expected when caller is the enrichment page (validated there)
 * @param {string} input.contactOutApiKey same as lushaApiKey
 * @param {EnrichmentPipelineDeps} input.deps
 */
export async function runEnrichmentPipeline({ urlText, apolloApiKey, lushaApiKey, contactOutApiKey, deps }) {
    const ctx = pipelineCtx(deps);
    const onStatus = ctx.onStatus;

    const rows = createInitialRows(urlText);
    if (rows.length === 0) {
        onStatus({ text: 'No valid LinkedIn URLs found.', variant: 'error' });
        ctx.onProgress({ value: 0, max: 0 });
        return { rows: [], stats: null };
    }

    const apollo = await apolloEnrichStage(rows, apolloApiKey, ctx);
    const contactOut = await contactOutEnrichStage(apollo.rows, contactOutApiKey, ctx);
    const lusha = await lushaEnrichStage(contactOut.rows, lushaApiKey, ctx);

    const finalRows = lusha.rows.map((row) => ({
        contactId: row.contactId,
        linkedinUrl: row.linkedinUrl,
        firstName: row.firstName,
        lastName: row.lastName,
        fullName: row.fullName,
        companyName: row.companyName,
        personalEmails: row.personalEmails,
        workEmails: row.workEmails,
        phoneNumbers: row.phoneNumbers
    }));

    const stats = summarizeRows(finalRows, {
        apolloMatched: apollo.apolloMatched,
        apolloFailedBatches: 0,
        contactOutFailedBatches: contactOut.failedBatches,
        contactOutWithPersonal: contactOut.withPersonalFromContactOut,
        lushaFailedBatches: lusha.failedBatches,
        lushaEmailFallbackUsed: 0
    });

    if (deps.persist) await deps.persist(finalRows, stats);
    if (deps.downloadCsv) deps.downloadCsv(finalRows);

    onStatus({
        text: `Done. Personal: ${stats.withPersonalEmail}, Work: ${stats.withWorkEmail}, Phone: ${stats.withPhone}, Empty: ${stats.empty}`,
        variant: 'success'
    });
    if (deps.onStatsLine) {
        deps.onStatsLine(`Total ${stats.total} | Apollo ${stats.apolloMatched} | ContactOut personal ${stats.contactOutWithPersonal}`);
    }
    ctx.onProgress({ value: rows.length, max: rows.length });

    return { rows: finalRows, stats };
}

function bindDomStatusElements(statusEl, progressEl, statsEl) {
    const applyVariant = (el, variant) => {
        const base = 'status-message';
        if (variant === 'loading') el.className = `${base} loading`;
        else if (variant === 'success') el.className = `${base} success`;
        else if (variant === 'error') el.className = `${base} error`;
        else el.className = base;
    };
    return {
        sendMessage: defaultSendRuntimeMessage,
        onStatus: ({ text, variant = 'neutral' }) => {
            statusEl.textContent = text;
            applyVariant(statusEl, variant);
        },
        onProgress: ({ value, max }) => {
            progressEl.max = max || 0;
            progressEl.value = value;
        },
        onStatsLine: statsEl ? (text) => { statsEl.textContent = text; } : undefined,
        persist: async (rows, stats) => {
            await chrome.storage.local.set({ enrichedContactData: rows, enrichmentStats: stats });
        },
        downloadCsv: autoDownloadCsv
    };
}

/**
 * Page adapter: wires DOM + chrome defaults, then delegates to runEnrichmentPipeline.
 * Callers should validate required keys in the UI (see `runEnrichmentPipeline` contract).
 */
export async function processLinkedinURLs(urlText, apolloApiKey, lushaApiKey, contactOutApiKey) {
    const statusEl = document.getElementById('enrichment-status');
    const progressEl = document.getElementById('enrichment-progress');
    const statsEl = document.getElementById('enrichment-stats');
    const deps = bindDomStatusElements(statusEl, progressEl, statsEl);
    const { rows } = await runEnrichmentPipeline({
        urlText,
        apolloApiKey,
        lushaApiKey,
        contactOutApiKey,
        deps
    });
    return rows;
}

export {
    normalizeLinkedinUrl,
    isValidLinkedinUrl,
    parseLinkedinProfileUrlsFromText,
    toCsv,
    createInitialRows,
    summarizeRows,
    defaultSendRuntimeMessage
};
