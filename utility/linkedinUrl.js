/**
 * Shared LinkedIn profile URL normalization and filtering rules.
 */
export function normalizeLinkedinUrl(raw) {
    const value = (raw || '').trim();
    if (!value) return '';
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
        const url = new URL(withScheme);
        url.hash = '';
        url.search = '';
        return url.toString().replace(/\/+$/, '');
    } catch {
        return '';
    }
}

export function isValidLinkedinUrl(url) {
    return /^https?:\/\//i.test(url) && /(linkedin\.com\/(in|pub)\/)/i.test(url);
}

export function parseLinkedinProfileUrlsFromText(urlText) {
    return [...new Set((urlText || '').split(/[\n,]/).map(normalizeLinkedinUrl).filter((url) => isValidLinkedinUrl(url)))];
}
