
document.addEventListener('DOMContentLoaded', () => {
    // === Profile Downloader Implementation ===
    const userEmailInput = document.getElementById('user-email');
    const profileDownloadButton = document.getElementById('profile-download-button');
    const profileClearButton = document.getElementById('profile-clear-button');
    const profileStatus = document.getElementById('profile-status');
    const profileProgress = document.getElementById('profile-progress');
    const profileResults = document.getElementById('profile-results');
    const profileSummary = document.getElementById('profile-summary');
    const backButton = document.querySelector('.back-button');

    let profileProcessRunning = false;
    let profileStopRequested = false;

    // Back button handling
    if (backButton) {
        backButton.addEventListener('click', () => {
            window.location.href = '../index.html';
        });
    }

    // Profile Downloader: Main process handler
    if (profileDownloadButton) {
        profileDownloadButton.addEventListener('click', async () => {
            const email = userEmailInput ? userEmailInput.value.trim() : '';

            if (!email) {
                showNotification('Please enter your email address.', 'error');
                return;
            }

            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showNotification('Please enter a valid email address.', 'error');
                return;
            }

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab || !tab.id) {
                    showNotification('Could not find active tab.', 'error');
                    return;
                }

                // Verify we're on a SEEK Talent Search page
                if (!tab.url || !tab.url.includes('au.employer.seek.com/talentsearch')) {
                    showNotification('Please navigate to a SEEK Talent Search page first.', 'error');
                    return;
                }

                startProfileDownloader(email, tab.id);
            });
        });
    }

    if (profileClearButton) {
        profileClearButton.addEventListener('click', () => {
            if (userEmailInput) {
                userEmailInput.value = '';
            }
            resetProfileDownloader();
        });
    }

    async function startProfileDownloader(userEmail, tabId) {
        try {
            console.log("=== PROFILE DOWNLOADER STARTED ===");
            console.log("User email:", userEmail);
            console.log("Tab ID:", tabId);

            profileProcessRunning = true;
            profileStopRequested = false;

            if (profileDownloadButton) profileDownloadButton.disabled = true;
            if (profileStatus) profileStatus.textContent = 'Initializing profile access process...';
            if (profileProgress) {
                profileProgress.value = 0;
                profileProgress.max = 100;
            }

            // Stage 1: Access all profiles
            console.log("=== STARTING STAGE 1 ===");
            const stage1Result = await executeStage1(userEmail, tabId);
            console.log("=== STAGE 1 COMPLETED ===", stage1Result);
            if (profileStopRequested) return;

            // Stage 2: Collect download buttons after waiting
            console.log("=== STARTING STAGE 2 ===");
            const stage2Result = await executeStage2(tabId);
            console.log("=== STAGE 2 COMPLETED ===", stage2Result);

            // Show final results
            console.log("=== DISPLAYING RESULTS ===");
            displayProfileResults(stage1Result, stage2Result);

        } catch (error) {
            console.error('Profile Downloader error:', error);
            showNotification(`Error: ${error.message}`, 'error');
            if (profileStatus) profileStatus.textContent = `Error: ${error.message}`;
        } finally {
            profileProcessRunning = false;
            if (profileDownloadButton) profileDownloadButton.disabled = false;
        }
    }

    async function executeStage1(userEmail, tabId) {
        if (profileStatus) profileStatus.textContent = 'Stage 1: Finding access profile buttons...';

        // Inject script to find all access profile buttons
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: findAccessProfileButtons,
        });

        console.log(results);

        const accessButtons = results[0].result;

        if (profileStatus) profileStatus.textContent = `Found ${accessButtons.length} profiles to access. Starting process...`;
        if (profileProgress) profileProgress.max = accessButtons.length;
        console.log(profileStatus);

        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < accessButtons.length; i++) {
            if (profileStopRequested) break;

            try {
                if (profileStatus) {
                    profileStatus.textContent = `Processing profile ${i + 1}/${accessButtons.length}...`;
                }

                // Click the first remaining "Access profile" button (index 0). We use 0 every time
                // because after each click the DOM updates (that button becomes "Download profile"),
                // so re-querying and using index 0 always targets the next unprocessed profile.
                // Using index i would skip every other profile after the list shifts.
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: processAccessProfile,
                    args: [0, userEmail]
                });

                successCount++;

                // Add small delay between profiles for stability
                await new Promise(resolve => setTimeout(resolve, 1500));

            } catch (error) {
                console.error(`Error processing profile ${i + 1}:`, error);
                errorCount++;
            }

            processedCount++;
            if (profileProgress) profileProgress.value = processedCount;
        }

        return {
            total: accessButtons.length,
            processed: processedCount,
            successful: successCount,
            errors: errorCount
        };
    }

    async function executeStage2(tabId) {
        if (profileStatus) profileStatus.textContent = 'Stage 2: Waiting for page to update (6 seconds)...';

        // Wait 6 seconds for page to update
        await new Promise(resolve => setTimeout(resolve, 6000));

        if (profileStatus) profileStatus.textContent = 'Stage 2: Collecting download profile buttons...';

        // Count all download profile buttons (without clicking)
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: countDownloadProfileButtons,
        });

        const downloadButtons = results[0].result;

        if (!downloadButtons || downloadButtons.length === 0) {
            return {
                downloadButtonsFound: 0,
                buttons: [],
                downloadsCompleted: 0
            };
        }

        // Stage 3: Click all download buttons
        if (profileStatus) profileStatus.textContent = `Stage 3: Starting downloads for ${downloadButtons.length} profiles...`;
        console.log("=== STAGE 3: Starting downloads ===");

        const downloadResult = await executeDownloads(tabId, downloadButtons.length);
        console.log("=== STAGE 3: Downloads completed, result:", downloadResult);

        // Stage 4: Handle pagination if there are more pages
        if (profileStatus) profileStatus.textContent = `Stage 4: Handling pagination...`;
        console.log("=== STAGE 4: About to call handlePagination ===");
        showNotification('Starting pagination check...', 'info');

        let paginationResult;
        try {
            paginationResult = await handlePagination(tabId);
            console.log("=== STAGE 4: Pagination completed successfully, result:", paginationResult);
            showNotification(`Pagination completed! Processed ${paginationResult.pagesProcessed} pages`, 'success');
        } catch (paginationError) {
            console.error("=== STAGE 4: Pagination failed with error:", paginationError);
            showNotification(`Pagination failed: ${paginationError.message}`, 'error');
            paginationResult = { pagesProcessed: 1, totalDownloads: 0 };
        }

        return {
            downloadButtonsFound: downloadButtons.length,
            buttons: downloadButtons,
            downloadsCompleted: downloadResult.completed,
            downloadErrors: downloadResult.errors,
            pagesProcessed: paginationResult.pagesProcessed,
            totalDownloads: paginationResult.totalDownloads
        };
    }

    async function executeDownloads(tabId, downloadCount) {
        try {
            if (profileStatus) profileStatus.textContent = `Starting ${downloadCount} downloads...`;

            // Execute the download script with timeout protection
            const downloadPromise = chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: findDownloadProfileButtons,
            });

            // Add a safety timeout at the extension level (30 seconds max)
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Download timeout after 30 seconds')), 30000)
            );

            const results = await Promise.race([downloadPromise, timeoutPromise]);
            const downloadResult = results[0].result;
            console.log("Download execution result:", downloadResult);

            if (profileStatus) {
                profileStatus.textContent = `Downloads completed: ${downloadResult.completed}/${downloadResult.total} successful. Waiting 3 seconds...`;
            }

            // Wait 3 seconds after downloads complete before starting pagination
            await new Promise(resolve => setTimeout(resolve, 3000));

            return {
                completed: downloadResult.completed,
                errors: downloadResult.total - downloadResult.completed
            };
        } catch (error) {
            console.error('Error executing downloads:', error);
            if (profileStatus) profileStatus.textContent = `Download error: ${error.message}`;

            // If downloads failed/timed out, still try to proceed with a reasonable estimate
            return { completed: Math.max(0, downloadCount - 5), errors: Math.min(5, downloadCount) };
        }
    }

    async function handlePagination(tabId) {
        console.log("=== STARTING PAGINATION HANDLER ===");
        let pagesProcessed = 1;
        let totalDownloads = 0;

        // Get current email value for subsequent pages
        const currentEmail = userEmailInput ? userEmailInput.value.trim() : '';
        console.log("Email for pagination:", currentEmail);

        // Check if there are more pages
        while (true) {
            if (profileStopRequested) {
                console.log("Pagination stopped by user request");
                break;
            }

            console.log(`=== CHECKING FOR PAGE ${pagesProcessed + 1} ===`);
            if (profileStatus) profileStatus.textContent = `Checking for next page...`;

            // Look for next page button and click it
            console.log("Executing findAndClickNextPage script...");
            const nextPageResult = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: findAndClickNextPage,
            });

            const hasNextPage = nextPageResult[0].result;
            console.log("Next page result:", hasNextPage);

            if (!hasNextPage) {
                console.log("No more pages found - pagination complete");
                if (profileStatus) profileStatus.textContent = `No more pages found. Processing complete.`;
                break;
            }

            pagesProcessed++;
            if (profileStatus) profileStatus.textContent = `Moving to page ${pagesProcessed}, waiting for page to load...`;

            // Wait for new page to load
            await new Promise(resolve => setTimeout(resolve, 6000));

            // Process profiles on this new page
            if (profileStatus) profileStatus.textContent = `Page ${pagesProcessed}: Starting profile access process...`;

            // Repeat the entire process for this page
            await executeStage1(currentEmail, tabId);
            if (profileStopRequested) break;

            // Wait and find download buttons on this page
            await new Promise(resolve => setTimeout(resolve, 6000));

            const pageDownloadResults = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: countDownloadProfileButtons,
            });

            const pageDownloadButtons = pageDownloadResults[0].result;

            if (pageDownloadButtons && pageDownloadButtons.length > 0) {
                if (profileStatus) profileStatus.textContent = `Page ${pagesProcessed}: Downloading ${pageDownloadButtons.length} profiles...`;

                const pageDownloadResult = await executeDownloads(tabId, pageDownloadButtons.length);
                totalDownloads += pageDownloadResult.completed;
            }

            // Prevent infinite loops - max 10 pages
            if (pagesProcessed >= 10) {
                if (profileStatus) profileStatus.textContent = `Reached maximum page limit (10 pages). Stopping.`;
                break;
            }
        }

        return { pagesProcessed, totalDownloads };
    }

    function displayProfileResults(stage1Result, stage2Result) {
        const totalDownloads = (stage2Result.totalDownloads || 0) + (stage2Result.downloadsCompleted || 0);

        if (profileStatus) {
            profileStatus.textContent = `Process completed! ${stage1Result.successful}/${stage1Result.total} profiles accessed, ${totalDownloads} profiles downloaded across ${stage2Result.pagesProcessed || 1} page(s).`;
        }

        if (profileProgress) profileProgress.value = profileProgress.max;

        let html = '<div style="background: white; padding: 15px; border-radius: 4px; margin-top: 10px;">';
        html += '<h4 style="margin-top: 0;">Complete Profile Download Results</h4>';

        html += `<p><strong>Stage 1 - Profile Access:</strong></p>`;
        html += `<ul>`;
        html += `<li>Total profiles found: ${stage1Result.total}</li>`;
        html += `<li>Successfully accessed: ${stage1Result.successful}</li>`;
        html += `<li>Errors encountered: ${stage1Result.errors}</li>`;
        html += `</ul>`;

        html += `<p><strong>Stage 2 - Downloads & Pagination:</strong></p>`;
        html += `<ul>`;
        html += `<li>Pages processed: ${stage2Result.pagesProcessed || 1}</li>`;
        html += `<li>Total downloads completed: ${totalDownloads}</li>`;
        if (stage2Result.downloadErrors > 0) {
            html += `<li>Download errors: ${stage2Result.downloadErrors}</li>`;
        }
        html += `</ul>`;

        if (totalDownloads > 0) {
            html += `<p style="color: #28a745;"><strong>✅ Complete Success!</strong> ${totalDownloads} profile downloads have been initiated. Check your Downloads folder.</p>`;
        } else if (stage1Result.successful > 0) {
            html += `<p style="color: #ffc107;"><strong>⚠️ Partial Success:</strong> Profiles were accessed but downloads may have failed. Check the page manually.</p>`;
        } else {
            html += `<p style="color: #dc3545;"><strong>❌ No profiles were processed.</strong> Please check the page and try again.</p>`;
        }

        html += '</div>';

        if (profileSummary) profileSummary.innerHTML = html;
        if (profileResults) profileResults.style.display = 'block';

        const message = totalDownloads > 0
            ? `Successfully downloaded ${totalDownloads} profiles across ${stage2Result.pagesProcessed || 1} page(s)!`
            : `Process completed but no downloads were successful.`;

        showNotification(message, totalDownloads > 0 ? 'success' : 'warning');
    }

    function resetProfileDownloader() {
        if (profileStatus) profileStatus.textContent = 'Enter your email address to get started';
        if (profileProgress) profileProgress.value = 0;
        if (profileResults) profileResults.style.display = 'none';
        profileProcessRunning = false;
        profileStopRequested = false;
    }

    // Helper function for notifications
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

    // === Injected Functions (executed in page context) ===

    // Function to find all access profile buttons
    function findAccessProfileButtons() {
        // Primary selector: button[id^='accessProfile-']
        let buttons = Array.from(document.querySelectorAll("button[id^='accessProfile-']"));

        // Fallback selector: XPath equivalent
        if (buttons.length === 0) {
            const xpath = "//button[.//span[text()='Access profile']]";
            const iterator = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            let node;
            while (node = iterator.iterateNext()) {
                buttons.push(node);
            }
        }

        return buttons.map((btn, index) => ({
            index,
            id: btn.id,
            text: btn.textContent.trim()
        }));
    }

    // Function to process a single access profile (click button, fill modal, submit).
    // buttonIndex should always be 0: we always click the first remaining "Access profile" button,
    // since after each click the list updates and the next profile becomes index 0.
    function processAccessProfile(buttonIndex, userEmail) {
        return new Promise((resolve, reject) => {
            try {
                const buttons = document.querySelectorAll("button[id^='accessProfile-']");
                const button = buttons[buttonIndex];

                if (!button) {
                    throw new Error(`Access profile button at index ${buttonIndex} not found (${buttons.length} buttons in list)`);
                }

                // Step 1: Click the access profile button
                console.log(`Step 1: Clicking first remaining access profile button (${buttons.length} left)`);
                button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                button.style.outline = '3px solid #007bff';

                setTimeout(() => {
                    button.click();
                    button.style.outline = '';

                    // Step 2: Wait for modal to appear and locate email field
                    setTimeout(() => {
                        try {
                            console.log('Step 2: Modal appeared, looking for email input field');

                            // Find email input field
                            const emailInput = document.querySelector('#advertiserEmail') ||
                                document.querySelector('input[id="advertiserEmail"]');

                            if (!emailInput) {
                                throw new Error('Email input field not found in modal');
                            }

                            // Highlight the email input field
                            emailInput.style.outline = '3px solid #28a745';
                            emailInput.focus();

                            // Step 3: Fill email with typing animation
                            setTimeout(() => {
                                console.log('Step 3: Filling email field');

                                // Clear field first
                                emailInput.value = '';

                                // Simulate typing the email character by character
                                let i = 0;
                                const typeEmail = () => {
                                    if (i < userEmail.length) {
                                        emailInput.value += userEmail[i];
                                        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                                        i++;
                                        setTimeout(typeEmail, 50);
                                    } else {
                                        // Email typing complete, remove highlight
                                        emailInput.style.outline = '';

                                        // Step 4: Find and highlight Send button
                                        setTimeout(() => {
                                            console.log('Step 4: Looking for Send button');

                                            const sendButtons = Array.from(document.querySelectorAll('button')).filter(btn =>
                                                btn.textContent.includes('Send') || btn.querySelector('span')?.textContent === 'Send'
                                            );

                                            const sendButton = sendButtons.find(btn => btn.closest('.modal') || btn.closest('[role="dialog"]')) || sendButtons[0];

                                            if (!sendButton) {
                                                throw new Error('Send button not found in modal');
                                            }

                                            // Highlight send button
                                            sendButton.style.outline = '3px solid #dc3545';
                                            sendButton.scrollIntoView({ behavior: 'smooth', block: 'center' });

                                            // Step 5: Click Send button
                                            setTimeout(() => {
                                                console.log('Step 5: Clicking Send button');
                                                sendButton.click();
                                                sendButton.style.outline = '';

                                                // Step 6: Wait for modal to close
                                                setTimeout(() => {
                                                    console.log('Step 6: Waiting for modal to close');
                                                    resolve();
                                                }, 1500);

                                            }, 1000);

                                        }, 800);
                                    }
                                };

                                typeEmail();

                            }, 1000);

                        } catch (modalError) {
                            reject(modalError);
                        }
                    }, 1500);

                }, 800);

            } catch (error) {
                reject(error);
            }
        });
    }

    // Function to find all download profile buttons and return promise when complete
    function countDownloadProfileButtons() {
        const buttons = document.querySelectorAll("button[id^='downloadProfile-']");
        return Array.from(buttons).map((btn, index) => ({
            index,
            id: btn.id,
            text: btn.textContent.trim()
        }));
    }

    // Function to click all download profile buttons and return promise when complete
    function findDownloadProfileButtons() {
        return new Promise((resolve) => {
            const buttons = document.querySelectorAll("button[id^='downloadProfile-']");

            if (!buttons.length) {
                console.warn("No downloadProfile- buttons found.");
                resolve({ completed: 0, total: 0 });
                return;
            }

            console.log(`Found ${buttons.length} download buttons to click`);
            let clickedCount = 0;
            const totalButtons = buttons.length;
            let lastClickTime = Date.now();

            // Safety timeout - resolve after 6 seconds of no activity or when all buttons clicked
            const timeoutCheck = setInterval(() => {
                const timeSinceLastClick = Date.now() - lastClickTime;

                if (timeSinceLastClick > 6000 || clickedCount >= totalButtons) {
                    console.log(`Download completion detected: ${clickedCount}/${totalButtons} clicked (timeout: ${timeSinceLastClick > 6000})`);
                    clearInterval(timeoutCheck);
                    resolve({ completed: clickedCount, total: totalButtons });
                }
            }, 1000);

            buttons.forEach((button, i) => {
                setTimeout(() => {
                    button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    button.style.outline = '3px solid #28a745';

                    setTimeout(() => {
                        button.click();
                        button.style.outline = '';
                        console.log(`Clicked button: ${button.id} (${i + 1}/${totalButtons})`);

                        clickedCount++;
                        lastClickTime = Date.now();

                        // If this was the last button, wait a bit then resolve
                        if (clickedCount === totalButtons) {
                            console.log(`All ${totalButtons} download buttons clicked successfully`);
                            setTimeout(() => {
                                clearInterval(timeoutCheck);
                                resolve({ completed: totalButtons, total: totalButtons });
                            }, 1000);
                        }
                    }, 500);
                }, i * 1000);
            });
        });
    }

    function findAndClickNextPage() {
        console.log("=== PAGINATION DEBUG: Looking for Next page button ===");

        const allLinks = document.querySelectorAll('a');
        console.log(`Total links found: ${allLinks.length}`);

        // Look specifically for pagination links
        const paginationLinks = Array.from(allLinks).filter(link =>
            link.textContent.toLowerCase().includes('next') ||
            link.getAttribute('rel') === 'next' ||
            link.getAttribute('aria-label')?.toLowerCase().includes('next') ||
            link.getAttribute('title')?.toLowerCase().includes('next')
        );

        console.log(`Pagination-related links found: ${paginationLinks.length}`);

        // Multiple selectors to find the Next button
        const selectors = [
            'a[rel="next"]',
            'a[aria-label="Next"]',
            'a[title="Next"]'
        ];

        let nextButton = null;

        // Try each selector
        for (const selector of selectors) {
            nextButton = document.querySelector(selector);
            if (nextButton) {
                console.log(`✅ Next button found using selector: ${selector}`);
                break;
            } else {
                console.log(`❌ No button found with selector: ${selector}`);
            }
        }

        // If no button found with standard selectors, try text-based search
        if (!nextButton) {
            console.log("Trying text-based search for 'Next' button...");
            const textBasedButton = Array.from(allLinks).find(link => {
                const text = link.textContent.trim().toLowerCase();
                const spanText = link.querySelector('span')?.textContent.trim().toLowerCase() || '';
                return text === 'next' || spanText === 'next' ||
                    text.includes('next') || spanText.includes('next');
            });

            if (textBasedButton) {
                nextButton = textBasedButton;
                console.log("✅ Next button found via text search");
            }
        }

        // Check if button is valid and clickable
        if (nextButton) {
            const isVisible = nextButton.offsetParent !== null;
            const isNotHidden = nextButton.getAttribute('aria-hidden') !== 'true';
            const isNotDisabled = !nextButton.hasAttribute('disabled') &&
                !nextButton.classList.contains('disabled');

            if (isVisible && isNotHidden && isNotDisabled) {
                console.log("🎯 Next page button is clickable! Proceeding with click...");

                // Scroll into view and highlight
                nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                nextButton.style.outline = '3px solid #007bff';
                nextButton.style.backgroundColor = 'rgba(0, 123, 255, 0.2)';

                // Multiple click approaches for better compatibility
                try {
                    nextButton.click();
                    console.log("✅ Direct click executed");
                } catch (e1) {
                    try {
                        const clickEvent = new MouseEvent('click', {
                            view: window,
                            bubbles: true,
                            cancelable: true
                        });
                        nextButton.dispatchEvent(clickEvent);
                        console.log("✅ Mouse event click executed");
                    } catch (e2) {
                        try {
                            nextButton.focus();
                            const enterEvent = new KeyboardEvent('keydown', {
                                key: 'Enter',
                                code: 'Enter',
                                bubbles: true
                            });
                            nextButton.dispatchEvent(enterEvent);
                            console.log("✅ Enter key simulation executed");
                        } catch (e3) {
                            console.error("❌ All click methods failed", e1, e2, e3);
                        }
                    }
                }

                // Remove highlight after a moment
                setTimeout(() => {
                    nextButton.style.outline = '';
                    nextButton.style.backgroundColor = '';
                }, 1000);

                console.log("🚀 Next page button click completed");
                return true;
            } else {
                console.log("❌ Next button found but not clickable");
                return false;
            }
        } else {
            console.log("❌ No Next button found at all");
            return false;
        }
    }
});

