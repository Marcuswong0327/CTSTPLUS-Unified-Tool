const UTF8_BOM = '\uFEFF';

/**
 * RFC-style CSV cell quoting. Treats CR like newline so Excel and strict parsers stay happy.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvCell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

/**
 * Objects as rows; header list defines column order and header row text.
 * @param {object[]} rows
 * @param {string[]} headers
 * @param {{ lineEnding?: string }} [options]
 */
export function rowsObjectsToCsv(rows, headers, { lineEnding = '\r\n' } = {}) {
    const lines = [headers.join(',')];
    for (const r of rows) {
        lines.push(headers.map((h) => escapeCsvCell(r[h])).join(','));
    }
    return lines.join(lineEnding);
}

/**
 * @param {string} csvText without BOM; BOM prepended when excelBom is true
 * @param {string} fileBaseName without or with .csv
 * @param {{ excelBom?: boolean }} [options]
 */
export function downloadCsvText(csvText, fileBaseName, { excelBom = true } = {}) {
    const base = fileBaseName.replace(/\.csv$/i, '');
    const payload = excelBom ? UTF8_BOM + csvText : csvText;
    const blob = new Blob([payload], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
