

document.addEventListener('DOMContentLoaded', () => {
    const MESSAGE_PREFIX = 'Hi [candidate],';

    function buildFullMessage(body) {
        const tail = (body || '').replace(/\r\n/g, '\n').trim();
        return tail ? `${MESSAGE_PREFIX}\n${tail}` : MESSAGE_PREFIX;
    }

    function stripPrefixFromSaved(saved) {
        if (!saved) return '';
        if (saved.startsWith(MESSAGE_PREFIX)) {
            let rest = saved.slice(MESSAGE_PREFIX.length);
            if (rest.startsWith('\r\n')) rest = rest.slice(2);
            else if (rest.startsWith('\n')) rest = rest.slice(1);
            return rest;
        }
        return saved;
    }

    // References
    const subjectInput = document.getElementById('subject');
    const messageInput = document.getElementById('message');
    const progressBar = document.getElementById('progressBar');
    const statusText = document.getElementById('statusText');
    const startBtn = document.getElementById('startButton');
    const stopBtn = document.getElementById('stopButton');
    const popup = document.getElementById('popup');
    const popupTitle = document.getElementById('popup-title');
    const popupMessage = document.getElementById('popup-message');
    const closePopup = document.getElementById('closePopup');
    const modeButtons = document.querySelectorAll('.mode-button');
    const backButton = document.querySelector('.back-button');

    // Local state variables
    let isRunning = false;
    let stopRequested = false;
    let selectedMode = 'pool'; // Default to pool mode

    // Mode selection handling
    modeButtons.forEach(button => {
        button.addEventListener('click', () => {
            modeButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            selectedMode = button.dataset.mode;
            saveFormData();
        });
    });

    // Back button handling
    if (backButton) {
        backButton.addEventListener('click', () => {
            window.location.href = '../index.html';
        });
    }

    // --- UI Update Function ---
    function updateUI(status) {
        if (!status) return;

        isRunning = status.isRunning;
        stopRequested = status.stopRequested;

        if (statusText) statusText.textContent = status.statusText || "Idle";
        if (progressBar) {
            progressBar.value = status.totalSent || 0;
            progressBar.max = Math.max(status.totalSent || 0, status.estimatedTotal || 20);
        }

        if (startBtn) startBtn.disabled = status.isRunning;
        if (stopBtn) stopBtn.disabled = !status.isRunning || status.stopRequested;

        if (status.jobConfig) {
            if (subjectInput && subjectInput.value === '' && status.jobConfig.subject) {
                subjectInput.value = status.jobConfig.subject;
            }
            if (messageInput && messageInput.value === '' && status.jobConfig.message) {
                messageInput.value = stripPrefixFromSaved(status.jobConfig.message);
            }
        }
    }

    // --- Event Listeners ---
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            const subject = subjectInput ? subjectInput.value.trim() : '';
            const message = buildFullMessage(messageInput ? messageInput.value : '');

            if (!subject || !message) {
                showNotification('Please enter both Subject and Message.', 'error');
                return;
            }
            saveFormData();

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab || !tab.id) {
                    showNotification('Could not find active tab.', 'error');
                    resetStartButtonOnError();
                    return;
                }

                const validUrls = {
                    search: 'au.employer.seek.com/talentsearch/search/',
                    pool: 'au.employer.seek.com/talentsearch/pooling/pool/'
                };

                if (!tab.url || !tab.url.includes(validUrls[selectedMode])) {
                    showNotification(`Please navigate to a SEEK Talent ${selectedMode === 'search' ? 'Search results' : 'Search pool'} page first.`, 'error');
                    resetStartButtonOnError();
                    return;
                }

                startBtn.disabled = true;
                if (stopBtn) stopBtn.disabled = false;
                if (statusText) statusText.textContent = 'Requesting start...';

                chrome.runtime.sendMessage(
                    {
                        type: 'startProcessing',
                        subject: subject,
                        message: message,
                        tabId: tab.id,
                        mode: selectedMode
                    },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.error("Popup: Error sending start message:", chrome.runtime.lastError);
                            showNotification(`Error: ${chrome.runtime.lastError.message}`, 'error');
                            resetStartButtonOnError();
                            return;
                        }
                        if (response && response.success) {
                            console.log("Popup: Start request sent successfully.");
                        } else {
                            console.error("Popup: Background script failed to start.", response?.message);
                            showNotification(response?.message || 'Failed to start process.', 'error');
                            resetStartButtonOnError();
                        }
                    }
                );
            });
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            console.log("Popup: Stop button clicked.");
            stopBtn.disabled = true;
            if (statusText) statusText.textContent = 'Requesting stop...';

            chrome.runtime.sendMessage({ type: 'stopProcessing' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Popup: Error sending stop message:", chrome.runtime.lastError);
                    showNotification(`Error: ${chrome.runtime.lastError.message}`, 'error');
                    if (statusText) statusText.textContent = 'Error requesting stop.';
                    refreshStatusFromBackground();
                    return;
                }
                if (response && response.success) {
                    console.log("Popup: Stop request sent successfully.");
                } else {
                    console.warn("Popup: Stop request failed or process wasn't running.", response?.message);
                    if (response?.message !== "No process running to stop.") {
                        showNotification(response?.message || 'Failed to send stop request.', 'warning');
                    }
                    refreshStatusFromBackground();
                }
            });
        });
    }

    if (closePopup && popup) {
        closePopup.addEventListener('click', () => {
            popup.classList.remove('active');
        });
    }

    if (subjectInput) subjectInput.addEventListener('input', saveFormData);
    if (messageInput) messageInput.addEventListener('input', saveFormData);

    // --- Helper Functions ---
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification) {
                notification.classList.add('fade-out');
                setTimeout(() => notification.remove(), 500);
            }
        }, 4000);
    }

    function showPopup(message, title = 'Process Update') {
        if (popupTitle) popupTitle.textContent = title;
        if (popupMessage) popupMessage.textContent = message;
        if (popup) popup.classList.add('active');
    }

    function saveFormData() {
        if (subjectInput && messageInput) {
            const formData = {
                subject: subjectInput.value,
                messageBody: messageInput.value,
                message: buildFullMessage(messageInput.value),
                mode: selectedMode
            };
            chrome.storage.local.set({ messengerFormData: formData });
        }
    }

    function loadFormData() {
        chrome.storage.local.get('messengerFormData', (data) => {
            if (data.messengerFormData) {
                if (subjectInput) subjectInput.value = data.messengerFormData.subject || '';
                if (messageInput) {
                    const fb = data.messengerFormData;
                    if (fb.messageBody !== undefined && fb.messageBody !== null) {
                        messageInput.value = fb.messageBody;
                    } else if (fb.message) {
                        messageInput.value = stripPrefixFromSaved(fb.message);
                    }
                }
                if (data.messengerFormData.mode) {
                    selectedMode = data.messengerFormData.mode;
                    modeButtons.forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.mode === selectedMode);
                    });
                }
            }
        });
    }

    function resetStartButtonOnError() {
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (statusText) statusText.textContent = 'Idle';
    }

    function refreshStatusFromBackground() {
        chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
            if (response?.success) {
                updateUI(response.status);
            } else {
                console.warn("Popup: Failed to refresh status from background.");
            }
        });
    }

    // --- Function to Check and Show Final Status Popup ---
    function checkAndShowFinalPopup() {
        chrome.storage.local.get('lastCompletionStatus', (data) => {
            if (data.lastCompletionStatus) {
                const finalStatus = data.lastCompletionStatus;
                console.log("Popup: Found stored final status:", finalStatus);

                if (popup && !popup.classList.contains('active')) {
                    if (finalStatus.success) {
                        showPopup(`Process Finished! Successfully sent messages to ${finalStatus.totalSent} candidates.`, "Process Complete");
                    } else if (finalStatus.outcome === "stopped") {
                        showPopup(`Process was stopped manually after sending ${finalStatus.totalSent} messages.`, "Process Stopped");
                    } else if (finalStatus.outcome === "error") {
                        showPopup(`Process stopped due to an error after sending ${finalStatus.totalSent} messages. ${finalStatus.errorMessage || 'Check background logs.'}`, 'Process Error');
                    }
                    chrome.storage.local.remove('lastCompletionStatus', () => {
                        console.log("Popup: Cleared stored final status.");
                    });
                } else {
                    console.log("Popup: Another popup is already active or popup element missing, clearing stored status without showing.");
                    chrome.storage.local.remove('lastCompletionStatus');
                }
            } else {
                console.log("Popup: No stored final status found.");
            }
        });
    }

    // --- Listener for Messages from Background ---
    function handleBackgroundMessage(message, sender, sendResponse) {
        console.log("Popup: Received message from background:", message);
        if (!message || !message.type) return;

        switch (message.type) {
            case 'statusUpdate':
                if (message.status) {
                    updateUI(message.status);
                    if (!message.status.isRunning) {
                        checkAndShowFinalPopup();
                    }
                }
                break;
            case 'processComplete':
                if (message.status) {
                    console.log("Popup: Received explicit 'processComplete' message.");
                    updateUI({
                        isRunning: false,
                        stopRequested: false,
                        totalSent: message.status.totalSent,
                        estimatedTotal: message.status.totalSent,
                        statusText: `Finished. Sent: ${message.status.totalSent}`,
                        lastError: null,
                        jobConfig: null
                    });
                    if (popup && !popup.classList.contains('active')) {
                        showPopup(`Process Finished! Successfully sent messages to ${message.status.totalSent} candidates.`, "Process Complete");
                    }
                    chrome.storage.local.remove('lastCompletionStatus');
                }
                break;
            case 'processFinished':
                if (message.status) {
                    console.log("Popup: Received explicit 'processFinished' (error/stopped) message.");
                    updateUI({
                        isRunning: false,
                        stopRequested: message.status.outcome === 'stopped',
                        totalSent: message.status.totalSent,
                        estimatedTotal: message.status.totalSent,
                        statusText: message.status.outcome === 'stopped'
                            ? `Stopped. Sent: ${message.status.totalSent}`
                            : `Error: ${message.status.errorMessage || 'Unknown'}. Sent: ${message.status.totalSent}`,
                        lastError: message.status.errorMessage,
                        jobConfig: null
                    });
                    if (popup && !popup.classList.contains('active')) {
                        if (message.status.outcome === "stopped") {
                            showPopup(`Process was stopped manually after sending ${message.status.totalSent} messages.`, "Process Stopped");
                        } else {
                            showPopup(`Process stopped due to an error after sending ${message.status.totalSent} messages. ${message.status.errorMessage || 'Check background logs.'}`, 'Process Error');
                        }
                    }
                    chrome.storage.local.remove('lastCompletionStatus');
                }
                break;
        }
    }
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);

    // --- Initial Setup ---
    loadFormData();

    if (statusText) statusText.textContent = "Checking status...";
    chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Popup: Error getting initial status:", chrome.runtime.lastError);
            if (statusText) statusText.textContent = "Error contacting background.";
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            checkAndShowFinalPopup();
        } else if (response && response.success) {
            console.log("Popup: Initial status received:", response.status);
            updateUI(response.status);
            if (!response.status.isRunning) {
                checkAndShowFinalPopup();
            }
        } else {
            console.error("Popup: Failed to get initial status from background.");
            if (statusText) statusText.textContent = "Failed to get status.";
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            checkAndShowFinalPopup();
        }
    });

    window.addEventListener('unload', () => {
        try {
            chrome.runtime.onMessage.removeListener(handleBackgroundMessage);
            console.log("Popup closing, removing listener.");
        } catch (e) {
            console.warn("Popup closing: Error removing listener (might have already been removed).", e);
        }
    });
});
