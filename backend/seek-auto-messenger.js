/**
 * SEEK auto-messenger: multi-page tab scripting loop and `statusUpdate` messages to the popup.
 * Talent enrichment HTTP is in `enrichment-fetch.js` (different `runtime.onMessage` types).
 */

// State variables
let isRunning = false;
let stopRequested = false;
let currentTabId = null;
let totalSent = 0;
let estimatedTotalCandidates = 0;
let totalCandidatesOnPage = 20;
let currentStatusText = "Idle";
let lastError = null;
let jobConfig = { subject: '', message: '', mode: 'pool' };

// --- Content Script Functions ---

async function processCurrentPage(options) {
    const { subject, message, getCounts, isDryRun = false, mode = 'pool' } = options;
    const actionDelay = 800;
    const modalAppearDelay = 2500;
    const afterSendDelay = 1500;
    const interactionDelay = 150;

    const SELECTORS = {
        SEND_MESSAGE_BUTTON: 'button[id^="sendMessage-"]',
        SEND_MESSAGE_BUTTON_ALT: 'button._1k7wyi40[type="button"] span._1k7wyi40 span._1scu9ig4',
        CANDIDATE_CARD: {
            SEARCH: 'div[data-cy="profile-card"]',
            POOL: '[data-cy="profile-card"]'
        },
        CANDIDATE_NAME: {
            SEARCH: 'span[data-role="heading"]',
            POOL: 'span[data-role="heading"]'
        }
    };

    async function setInputValue(inputElement, value) {
        if (!inputElement) { console.warn("setInputValue: Input element not found."); return false; }
        inputElement.focus();
        await new Promise(resolve => setTimeout(resolve, 100));
        inputElement.value = value || '';
        inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
        return true;
    }

    return new Promise((resolvePage) => {
        let candidateCards;
        let usedSelectorDescription = "";

        const primarySelectorCy = mode === 'search' ? SELECTORS.CANDIDATE_CARD.SEARCH : SELECTORS.CANDIDATE_CARD.POOL;

        candidateCards = Array.from(document.querySelectorAll(primarySelectorCy));
        usedSelectorDescription = `primary selector ('${primarySelectorCy}')`;

        if (candidateCards.length === 0) {
            console.log(`[Content Script] No candidate cards found with ${usedSelectorDescription}. Attempting fallback with 'data-testid="profile-card"'.`);
            const fallbackSelectorTestId = mode === 'search' ? 'div[data-testid="profile-card"]' : '[data-testid="profile-card"]';
            candidateCards = Array.from(document.querySelectorAll(fallbackSelectorTestId));

            if (candidateCards.length > 0) {
                usedSelectorDescription = `fallback selector ('${fallbackSelectorTestId}')`;
                console.log(`[Content Script] Successfully found ${candidateCards.length} cards using ${usedSelectorDescription}.`);
            } else {
                usedSelectorDescription = `primary ('${primarySelectorCy}') and fallback ('${fallbackSelectorTestId}') selectors`;
                console.log(`[Content Script] Still no cards found after trying both primary and fallback selectors.`);
            }
        }

        console.log(`[Content Script] Final check: Found ${candidateCards.length} candidate cards using ${usedSelectorDescription}. Mode: ${mode}`);

        const pageResult = {
            processed: 0,
            fullNames: [],
            totalOnPage: getCounts ? candidateCards.length : 0
        };

        if (candidateCards.length === 0) {
            console.log("[Content Script] No candidate cards found on this page after all attempts.");
            resolvePage(pageResult);
            return;
        }

        let cardIndex = 0;
        const processNextCard = async () => {
            if (cardIndex >= candidateCards.length) {
                console.log("[Content Script] Finished processing all cards on this page.");
                resolvePage(pageResult);
                return;
            }

            const card = candidateCards[cardIndex];
            const nameElement = card.querySelector(mode === 'search' ? SELECTORS.CANDIDATE_NAME.SEARCH : SELECTORS.CANDIDATE_NAME.POOL);
            let fullName = 'Unknown Candidate';
            if (nameElement) {
                const nameDiv = nameElement.querySelector('div._1k1leza0');
                fullName = nameDiv?.textContent?.trim() || nameElement.textContent?.trim() || 'Unknown Candidate';
            }

            if (fullName === 'Unknown Candidate') {
                console.log(`[Content Script] - Could not find candidate name. Stopping widget.`);
                resolvePage({
                    processed: 0,
                    fullNames: [],
                    totalOnPage: 0,
                    error: "SEEK has changed their website so our current approach for names doesn't work anymore, contact Jack to fix"
                });
                return;
            }

            let firstName = fullName;
            if (fullName !== 'Unknown Candidate' && fullName.includes(' ')) {
                firstName = fullName.split(' ')[0];
            }

            let messageButton;
            if (mode === 'search') {
                messageButton = card.querySelector('button[id^="sendMessage-"]');
            } else {
                messageButton = Array.from(card.querySelectorAll('button')).find(btn =>
                    btn.textContent?.trim() === 'Send message' ||
                    btn.getAttribute('data-cy') === 'send-message-button' ||
                    btn.getAttribute('data-testid') === 'send-message-button'
                );
            }

            console.log(`[Content Script] Processing Card ${cardIndex + 1}: Candidate "${firstName}" (Full: "${fullName}")`);

            if (!messageButton) {
                console.log(`[Content Script] - Message button not found for ${firstName}. Skipping.`);
                cardIndex++;
                setTimeout(processNextCard, 100);
                return;
            }

            try {
                console.log(`[Content Script] - Preparing to interact with button for ${firstName}...`);
                messageButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(resolve => setTimeout(resolve, interactionDelay));
                messageButton.focus();
                await new Promise(resolve => setTimeout(resolve, interactionDelay));
                console.log(`[Content Script] - Clicking message button for ${firstName}...`);
                messageButton.click();
                await new Promise(resolve => setTimeout(resolve, modalAppearDelay));

            } catch (interactionError) {
                console.error(`[Content Script] - Error during button interaction for ${firstName}:`, interactionError);
                cardIndex++;
                setTimeout(processNextCard, actionDelay);
                return;
            }

            const modalDialog = document.querySelector('div[role="dialog"][aria-label*="send message to"]');
            if (!modalDialog) {
                console.warn(`[Content Script] - Could not find the message dialog for ${firstName} after clicking. Skipping card.`);
                const anyCloseButton = document.querySelector('div[role="dialog"] button[aria-label="Close"], div[role="dialog"] button[data-testid="cancel-message"], div[role="dialog"] button#sendMessageDialog-close');
                if (anyCloseButton) {
                    console.log("[Content Script] - Found a generic close button, clicking it as fallback.");
                    anyCloseButton.click();
                    await new Promise(resolve => setTimeout(resolve, actionDelay));
                }
                cardIndex++;
                setTimeout(processNextCard, actionDelay);
                return;
            }

            console.log(`[Content Script] - Found message dialog for ${firstName}.`);
            const subjectInputModal = modalDialog.querySelector('#subject');
            const messageInputModal = modalDialog.querySelector('#body');
            const sendButtonModal = modalDialog.querySelector('button[data-testid="send-message"]');
            const cancelButtonModal = modalDialog.querySelector('button[data-testid="cancel-message"]');
            const closeButtonGeneric = modalDialog.querySelector('button[aria-label="Close"], button#sendMessageDialog-close');

            if (subjectInputModal && messageInputModal && (sendButtonModal || cancelButtonModal || closeButtonGeneric)) {
                console.log(`[Content Script] - Found required modal fields for ${firstName}.`);
                try {
                    const personalizedMessage = message.replace(/\[candidate\]/gi, firstName);
                    console.log(`[Content Script] - Filling modal fields (Subject & Message for ${firstName})...`);
                    let subjectSet = await setInputValue(subjectInputModal, subject);
                    let messageSet = await setInputValue(messageInputModal, personalizedMessage);

                    if (!subjectSet || !messageSet) {
                        console.warn(`[Content Script] - Failed to set Subject or Message for ${firstName}.`);
                    } else {
                        console.log(`[Content Script] - Fields filled successfully.`);
                    }
                    await new Promise(resolve => setTimeout(resolve, actionDelay / 2));

                    console.log(`[Content Script] - Sending message to ${firstName}...`);
                    if (sendButtonModal) {
                        console.log("[Content Script]   - Clicking Send button.");
                        sendButtonModal.click();
                        pageResult.processed++;
                        pageResult.fullNames.push(fullName);
                    } else {
                        console.warn("[Content Script]   - Could not find Send button.");
                    }
                    await new Promise(resolve => setTimeout(resolve, afterSendDelay));

                } catch (err) {
                    console.error(`[Content Script] - Error filling or processing modal for ${firstName}:`, err);
                    if (cancelButtonModal) { cancelButtonModal.click(); }
                    else if (closeButtonGeneric) { closeButtonGeneric.click(); }
                    await new Promise(resolve => setTimeout(resolve, actionDelay));
                }
            } else {
                console.warn(`[Content Script] - Required modal elements missing for ${firstName}. Trying to close.`);
                if (cancelButtonModal) { cancelButtonModal.click(); }
                else if (closeButtonGeneric) { closeButtonGeneric.click(); }
                await new Promise(resolve => setTimeout(resolve, actionDelay));
            }

            cardIndex++;
            const nextCardDelay = actionDelay + Math.random() * 500;
            setTimeout(processNextCard, nextCardDelay);
        };

        processNextCard();
    });
}

function checkAndGoToNextPage(mode) {
    try {
        console.log(`[Content Script] Checking for next page in ${mode} mode`);

        const nextButton = document.querySelector('nav[aria-label="Pagination of results"] a[rel="next"][aria-label="Next"]');

        if (!nextButton) {
            console.log(`[Content Script] Next button not found for ${mode} mode`);
            return false;
        }

        console.log(`[Content Script] Found next button:`, nextButton);

        const isHidden = nextButton.getAttribute('aria-hidden') === 'true' || nextButton.disabled;
        if (isHidden) {
            console.log(`[Content Script] Next button is disabled/hidden in ${mode} mode`);
            return false;
        }

        console.log(`[Content Script] Clicking next button in ${mode} mode`);
        nextButton.click();
        return true;
    } catch (error) {
        console.error(`[Content Script] Error in ${mode} mode:`, error);
        return false;
    }
}

async function sendStatusUpdate() {
    if (chrome.runtime?.id) {
        const status = {
            isRunning,
            stopRequested,
            totalSent,
            estimatedTotal: estimatedTotalCandidates > 0 ? estimatedTotalCandidates : totalCandidatesOnPage,
            statusText: currentStatusText,
            lastError: lastError ? lastError.message : null
        };
        try {
            await chrome.runtime.sendMessage({ type: "statusUpdate", status: status });
        } catch (error) {
            if (!error.message?.includes("Receiving end does not exist")) {
                console.warn("Background: Error sending status update:", error);
            }
        }
    } else {
        console.log("Background: Extension context invalidated, skipping status update.");
    }
}

// Main Logic for processing
async function startProcessing(subject, message, tabId, mode = 'pool') {
    isRunning = true;
    stopRequested = false;
    currentTabId = tabId;
    totalSent = 0;
    estimatedTotalCandidates = 0;
    totalCandidatesOnPage = 20;
    lastError = null;
    jobConfig = { subject, message, mode };
    currentStatusText = "Starting...";
    await sendStatusUpdate();

    try {
        let currentPage = 1;
        let initialPageInfo = true;

        while (isRunning && currentTabId && !stopRequested) {
            console.log(`Background: Processing page ${currentPage} in ${mode} mode...`);
            currentStatusText = `Processing page ${currentPage}...`;
            await sendStatusUpdate();

            if (!isRunning || !currentTabId || stopRequested) break;

            if (currentPage > 1) {
                console.log(`Background: Waiting for page ${currentPage} to load...`);
                await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 2000));
            }

            const executionArgs = {
                subject: jobConfig.subject,
                message: jobConfig.message,
                getCounts: initialPageInfo,
                isDryRun: false,
                mode: jobConfig.mode
            };

            let result;
            try {
                console.log(`Background: Checking if tab ${currentTabId} exists...`);
                await chrome.tabs.get(currentTabId);

                console.log(`Background: Executing script on tab ${currentTabId}...`);
                result = await chrome.scripting.executeScript({
                    target: { tabId: currentTabId },
                    func: processCurrentPage,
                    args: [executionArgs]
                });

                console.log(`Background: Script execution result:`, result);

                if (!isRunning || !currentTabId || stopRequested) {
                    console.log("Background: Stop detected after script execution, discarding result.");
                    break;
                }

            } catch (scriptError) {
                console.error("Background: Script execution error:", scriptError);
                if (!isRunning || !currentTabId) {
                    console.log("Background: Processing stopped (tab closed or stop requested during script execution attempt).");
                } else {
                    console.error("Background: Error during script execution or tab access:", scriptError);
                    lastError = new Error(`Scripting/Tab Error: ${scriptError.message}`);
                    currentStatusText = `Error on page ${currentPage}: ${lastError.message}`;
                    isRunning = false;
                    currentTabId = null;
                }
                break;
            }

            if (!result) {
                console.error("Background: Script execution returned no result");
                lastError = new Error("Script execution returned no result");
                currentStatusText = `Error on page ${currentPage}: No result from script execution`;
                isRunning = false;
                break;
            }

            if (!result[0]) {
                console.error("Background: Script execution result array is empty");
                lastError = new Error("Script execution result array is empty");
                currentStatusText = `Error on page ${currentPage}: Empty result array`;
                isRunning = false;
                break;
            }

            if (result[0].result && result[0].result.error) {
                console.error("Background: Error reported from content script:", result[0].result.error);
                lastError = new Error(result[0].result.error);
                currentStatusText = lastError.message;
                isRunning = false;
                break;
            }

            if (result[0].result === undefined) {
                console.error("Background: Script execution result is undefined");
                lastError = new Error("Script execution result is undefined");
                currentStatusText = `Error on page ${currentPage}: Undefined result`;
                isRunning = false;
                break;
            }

            const pageResult = result[0].result;
            console.log(`Background: Page result:`, pageResult);

            totalSent += pageResult.processed;
            console.log(`Background: Page ${currentPage} result (sent ${pageResult.processed}):`, pageResult.fullNames);

            if (initialPageInfo && pageResult.totalOnPage > 0) {
                totalCandidatesOnPage = pageResult.totalOnPage;
                if (isRunning && currentTabId) {
                    try {
                        await chrome.tabs.get(currentTabId);
                        const countResult = await chrome.scripting.executeScript({
                            target: { tabId: currentTabId },
                            func: () => {
                                const countEl = document.querySelector('div._1bdy3160 > div > div > span._1k7wyi40.dh5dib4z.tc3pdg0.tc3pdg3');
                                const match = countEl?.textContent?.match(/^(\d+)/);
                                return match ? parseInt(match[1], 10) : null;
                            }
                        });
                        if (!isRunning || !currentTabId || stopRequested) break;

                        if (countResult && countResult[0] && countResult[0].result) {
                            estimatedTotalCandidates = countResult[0].result;
                            console.log(`Background: Estimated total candidates: ${estimatedTotalCandidates}`);
                        } else {
                            console.warn("Background: Could not estimate total candidates from page element.");
                            estimatedTotalCandidates = 0;
                        }
                    } catch (countError) {
                        if (!isRunning || !currentTabId) {
                            console.log("Background: Stop detected during total count retrieval.");
                        } else {
                            console.warn("Background: Error getting total candidate count:", countError);
                        }
                        estimatedTotalCandidates = 0;
                    }
                }
                initialPageInfo = false;
            }

            const estimatedTotal = estimatedTotalCandidates > 0 ? estimatedTotalCandidates : totalCandidatesOnPage * currentPage;
            currentStatusText = `Sent ${totalSent} / ~${estimatedTotalCandidates || '??'} candidates`;
            console.log(`Background: Current status: ${currentStatusText}`);

            if (!isRunning || !currentTabId || stopRequested) break;

            console.log(`Background: Waiting before checking next page...`);
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));

            currentStatusText = `Checking for next page...`;
            console.log(`Background: ${currentStatusText}`);
            await sendStatusUpdate();

            if (!isRunning || !currentTabId || stopRequested) break;

            let nextPageResult;
            try {
                await chrome.tabs.get(currentTabId);
                nextPageResult = await chrome.scripting.executeScript({
                    target: { tabId: currentTabId },
                    func: checkAndGoToNextPage,
                    args: [mode]
                });

                if (!isRunning || !currentTabId || stopRequested) {
                    console.log("Background: Stop detected after next page check.");
                    break;
                }

            } catch (nextPageError) {
                if (!isRunning || !currentTabId) {
                    console.log("Background: Processing stopped (tab closed or stop requested during next page check).");
                } else {
                    console.error("Background: Error during next page check/click or tab access:", nextPageError);
                    lastError = new Error(`Next Page/Tab Error: ${nextPageError.message}`);
                    currentStatusText = `Error checking next page: ${lastError.message}`;
                    isRunning = false;
                    currentTabId = null;
                }
                break;
            }

            if (!nextPageResult || !nextPageResult[0] || !nextPageResult[0].result) {
                if (!stopRequested) {
                    console.log('Background: No next page found or navigation failed. Finishing.');
                    currentStatusText = `Finished. Sent ${totalSent} messages.`;
                } else {
                    console.log('Background: Finishing loop after stop request (no next page).');
                }
                isRunning = false;
                break;
            }

            currentPage++;
            currentStatusText = `Navigating to page ${currentPage}... Waiting...`;
            console.log(`Background: ${currentStatusText}`);
            await sendStatusUpdate();

            if (!isRunning || !currentTabId || stopRequested) break;

            await new Promise(resolve => setTimeout(resolve, 6000 + Math.random() * 2000));

            if (!isRunning || !currentTabId || stopRequested) break;

        }

        if (stopRequested) {
            console.log(`Background: Process stopped by user. Sent approx ${totalSent} messages.`);
            currentStatusText = `Stopped. Sent: ${totalSent}`;
        } else if (lastError) {
            console.log(`Background: Process stopped due to error: ${lastError.message}`);
        } else if (!isRunning && !lastError) {
            console.log(`Background: Process completed naturally.`);
            if (!currentStatusText.includes("Finished")) {
                currentStatusText = `Finished. Sent: ${totalSent}`;
            }
        }

    } catch (error) {
        console.error('Background: Unexpected error during processing loop:', error);
        lastError = error;
        currentStatusText = `Fatal Error: ${error.message}. Sent: ${totalSent}`;
        isRunning = false;
    } finally {
        console.log("Background: Processing loop ended.");
        isRunning = false;
        await sendStatusUpdate();
        currentTabId = null;
        stopRequested = false;
    }
}

/**
 * @param {object} message
 * @param {(response: object) => void} sendResponse
 * @returns {boolean} true if handled (SEEK messenger protocol)
 */
export function tryHandleSeekMessage(message, sendResponse) {
    if (message.type === 'startProcessing') {
        if (isRunning) {
            sendResponse({ success: false, message: "Process already running." });
            return true;
        }
        if (!message.tabId || !message.subject || !message.message) {
            sendResponse({ success: false, message: "Missing required parameters (tabId, subject, message)." });
            return true;
        }

        console.log("Background: Start request received. Waiting 3 seconds...");
        currentStatusText = "Initializing...";
        lastError = null;
        jobConfig = { subject: '', message: '', mode: 'pool' };
        totalSent = 0;
        estimatedTotalCandidates = 0;
        sendStatusUpdate();

        setTimeout(() => {
            if (stopRequested || isRunning) {
                console.log("Background: Start aborted during delay (stopped or already running).");
                if (!isRunning) {
                    currentStatusText = "Idle";
                    stopRequested = false;
                    sendStatusUpdate();
                }
                return;
            }

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const targetTabId = message.tabId || (tabs.length > 0 ? tabs[0].id : null);

                if (!targetTabId) {
                    console.error("Background: Could not determine target tab ID after delay.");
                    currentStatusText = "Error: Could not find target tab.";
                    lastError = new Error("Could not determine target tab ID.");
                    stopRequested = false;
                    isRunning = false;
                    sendStatusUpdate();
                    return;
                }

                console.log(`Background: Starting process on determined tab: ${targetTabId} after delay.`);
                startProcessing(message.subject, message.message, targetTabId, message.mode || 'pool');
            });
        }, 3000);

        sendResponse({ success: true, message: "Start request received. Initializing..." });
        return true;
    }

    if (message.type === 'stopProcessing') {
        if (isRunning || currentStatusText === "Initializing...") {
            console.log("Background: Stop requested by popup.");
            stopRequested = true;
            isRunning = false;
            currentStatusText = 'Stopping... Please wait.';
            console.log("Background: isRunning set to false, stopRequested set to true.");
            sendStatusUpdate();
            sendResponse({ success: true, message: "Stop request received. Interrupting process..." });
        } else {
            console.log("Background: Stop requested but process not running or initializing.");
            stopRequested = false;
            currentStatusText = "Idle";
            sendStatusUpdate();
            sendResponse({ success: false, message: "No process running to stop." });
        }
        return true;
    }

    if (message.type === 'getStatus') {
        const status = {
            isRunning,
            stopRequested,
            totalSent,
            estimatedTotal: estimatedTotalCandidates > 0 ? estimatedTotalCandidates : totalCandidatesOnPage,
            statusText: currentStatusText,
            lastError: lastError ? lastError.message : null,
            jobConfig: (isRunning || currentStatusText === "Initializing..." || totalSent > 0 || (lastError && jobConfig.subject) || jobConfig.subject) ? jobConfig : null
        };
        sendResponse({ success: true, status: status });
        return true;
    }

    return false;
}

export function attachSeekTabListeners() {
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        const processingTabId = currentTabId;
        if (tabId === processingTabId && isRunning) {
            console.log(`Background: Target tab ${tabId} closed. Stopping process.`);
            stopRequested = true;
            isRunning = false;
            currentTabId = null;
            lastError = new Error("Target tab was closed during processing.");
            currentStatusText = `Stopped: Target tab closed. Sent: ${totalSent}`;
            sendStatusUpdate();
        }
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const processingTabId = currentTabId;
        if (tabId === processingTabId && isRunning && changeInfo.url) {
            console.log(`Background: Target tab ${tabId} updated URL to: ${changeInfo.url}. Monitoring.`);
        }
        if (tabId === processingTabId && isRunning && changeInfo.status === 'complete') {
            console.log(`Background: Target tab ${tabId} finished loading (status: complete).`);
        }
    });
}
