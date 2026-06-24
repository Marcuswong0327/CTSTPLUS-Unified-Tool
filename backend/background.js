/**
 * Service worker entry: routes `runtime.onMessage` by protocol.
 *
 * - SEEK auto-messenger: `startProcessing`, `stopProcessing`, `getStatus`, outbound `statusUpdate`
 * - Talent enrichment: `fetchApolloDataBulk`, `fetchContactOutBatch`, `fetchLushaPersonBatch`
 */

import { tryHandleEnrichmentMessage } from './enrichment-fetch.js';
import { tryHandleSeekMessage, attachSeekTabListeners } from './seek-auto-messenger.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (tryHandleEnrichmentMessage(message, sendResponse)) return true;
    if (tryHandleSeekMessage(message, sendResponse)) return true;
    return true;
});

attachSeekTabListeners();

console.log('Background script loaded (SEEK messenger + enrichment fetch).');
