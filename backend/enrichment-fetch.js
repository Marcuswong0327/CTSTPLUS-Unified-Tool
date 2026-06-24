/**
 * Talent data enrichment: HTTP calls from the service worker (CORS).
 * Separate from SEEK auto-messenger so message routing stays obvious.
 */

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retryConfig = {}) {
    const {
        maxAttempts = 4,
        baseDelayMs = 500,
        retryableStatus = [429, 500, 502, 503, 504]
    } = retryConfig;

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetch(url, options);
            if (!retryableStatus.includes(response.status) || attempt === maxAttempts) {
                return response;
            }
            const jitter = Math.floor(Math.random() * 120);
            await sleep(baseDelayMs * (2 ** (attempt - 1)) + jitter);
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts) throw error;
            const jitter = Math.floor(Math.random() * 120);
            await sleep(baseDelayMs * (2 ** (attempt - 1)) + jitter);
        }
    }
    throw lastError || new Error('Retry attempts exhausted.');
}

async function parseJsonOrThrow(response, apiName) {
    const raw = await response.text();
    let data = null;
    try {
        data = raw ? JSON.parse(raw) : null;
    } catch {
        data = { raw };
    }
    if (!response.ok) {
        const details = data?.message || data?.error || raw || 'Unknown API error';
        throw new Error(`${apiName} failed (${response.status}): ${details}`);
    }
    return data;
}

async function fetchApolloMatchOne(contact, apiKey) {
    const payload = {
        linkedin_url: contact.linkedinUrl
    };

    const response = await fetchWithRetry('https://api.apollo.io/v1/people/match', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'X-Api-Key': apiKey
        },
        body: JSON.stringify(payload)
    });

    const data = await parseJsonOrThrow(response, 'Apollo');
    return {
        contactId: String(contact.contactId),
        person: data?.person || null
    };
}

async function fetchApolloDataBulk(contacts, apiKey) {
    const tasks = (contacts || []).map(async (contact) => {
        try {
            return await fetchApolloMatchOne(contact, apiKey);
        } catch (error) {
            return {
                contactId: String(contact.contactId),
                person: null,
                error: error.message
            };
        }
    });
    return Promise.all(tasks);
}

async function fetchLushaPersonBatch(contacts, apiKey) {
    const payload = {
        contacts: (contacts || []).map((c) => ({
            contactId: String(c.contactId),
            linkedinUrl: c.linkedinUrl,
            ...(c.fullName ? { fullName: c.fullName } : {}),
            ...((c.companyName || c.companyDomain) ? {
                companies: [{
                    ...(c.companyName ? { name: c.companyName } : {}),
                    ...(c.companyDomain ? { domain: c.companyDomain } : {}),
                    isCurrent: true
                }]
            } : {})
        }))
    };

    const response = await fetchWithRetry('https://api.lusha.com/v2/person', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api_key': apiKey
        },
        body: JSON.stringify(payload)
    });

    return parseJsonOrThrow(response, 'Lusha');
}

async function fetchContactOutBatch(profiles, apiKey, emailType = 'personal') {
    const response = await fetchWithRetry(`https://api.contactout.com/v1/people/linkedin/batch?email_type=${encodeURIComponent(emailType)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'token': apiKey
        },
        body: JSON.stringify({ profiles: profiles || [] })
    });

    const data = await parseJsonOrThrow(response, 'ContactOut');
    const message = String(data?.message || '');
    if (/sample response/i.test(message) || /unlock full access/i.test(message) || /book a call/i.test(message)) {
        throw new Error('ContactOut API key is on sample/demo access. Live enrichment is not enabled for this token.');
    }
    return data;
}

/**
 * @param {object} message
 * @param {(response: object) => void} sendResponse
 * @returns {boolean} true if this module handled the message
 */
export function tryHandleEnrichmentMessage(message, sendResponse) {
    if (message.type === 'fetchApolloDataBulk') {
        (async () => {
            try {
                const data = await fetchApolloDataBulk(message.contacts || [], message.apiKey);
                sendResponse({ success: true, data });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    if (message.type === 'fetchContactOutBatch') {
        (async () => {
            try {
                const data = await fetchContactOutBatch(message.profiles || [], message.apiKey, message.emailType || 'personal');
                sendResponse({ success: true, data });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    if (message.type === 'fetchLushaPersonBatch') {
        (async () => {
            try {
                const data = await fetchLushaPersonBatch(message.contacts || [], message.apiKey);
                sendResponse({ success: true, data });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    return false;
}
