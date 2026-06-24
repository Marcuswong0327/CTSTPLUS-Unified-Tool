'use strict';

const contactOutApiKeyInput = document.getElementById('contactOutApiKey');
const apolloApiKeyInput = document.getElementById('apolloApiKey');
const lushaApiKeyInput = document.getElementById('lushaApiKey');

const linkedinUrlsInput = document.getElementById('linkedinUrls');

const enrichCopyPasteUrlsBtn = document.getElementById('enrichCopyPasteButton');
const enrichFromUrlsBtn = document.getElementById('enrichBtn');
const enrichmentStatusEl = document.getElementById('enrichment-status');

import { processLinkedinURLs } from './cddEnrichment.js';
import { parseLinkedinProfileUrlsFromText } from '../utility/linkedinUrl.js';


document.addEventListener("DOMContentLoaded", ()=> {
    const backButton = document.querySelector(".back-button");

    if(backButton){
        backButton.addEventListener("click", () => {
            window.location.href = '../index.html';
        });
    }
});

class TalentDataEnrichment {

    constructor(){
        const run = () => {
            this._loadAPIKeyOnStart();
            this._handleLinkedinURLsOnTextArea(); 
            enrichCopyPasteUrlsBtn.addEventListener('click', this._copyPasteLinkedinURLs.bind(this));
            enrichFromUrlsBtn.addEventListener('click', this._handleLinkedinEnrichment.bind(this));
        };
        if(document.readyState === 'complete' || document.readyState === 'interactive'){
            run();
        } else {
            document.addEventListener('DOMContentLoaded', run);
        }

    };

    _filterLinkedinURLsCount() {
        const urlList = parseLinkedinProfileUrlsFromText(linkedinUrlsInput.value);
        if (urlList.length > 0) {
            const filterURLs = urlList.join('\n');
            linkedinUrlsInput.value = filterURLs;
            chrome.storage.local.set({ linkedInUrls: filterURLs });
        }
        if (urlList.length === 0) return;
    }


    async _copyPasteLinkedinURLs(){
        try{

            const tabs = await chrome.tabs.query({currentWindow:true}); 

            if(tabs.length ===0){
                enrichmentStatusEl.textContent = "No tabs found in current window.";
                enrichmentStatusEl.className = 'status-message error'; 
                return;
            }

            const linkedInUrls = parseLinkedinProfileUrlsFromText(
                tabs.map((tab) => tab.url).filter(Boolean).join('\n')
            );

            if (linkedInUrls.length === 0) {
                enrichmentStatusEl.textContent = "No detected Linkedin URLs in current window.";
                enrichmentStatusEl.className = "status-message error"; 
                return;
            }

            linkedinUrlsInput.value = linkedInUrls.join('\n'); 
            this._filterLinkedinURLsCount();
            enrichmentStatusEl.textContent = `Copied ${linkedInUrls.length} LinkedIn profile URL(s)`;
            enrichmentStatusEl.className = 'status-message success'; 

        }catch(error){
            enrichmentStatusEl.textContent = 'Error: ' + error.message; 
            enrichmentStatusEl.className = 'status-message error'; 
        }

    }

    _loadAPIKeyOnStart() {
        chrome.storage.local.get(['contactOutApiKey', 'apolloApiKey', 'lushaApiKey'], (data) => {
            if (contactOutApiKeyInput && data.contactOutApiKey) {
                contactOutApiKeyInput.value = data.contactOutApiKey;
            }
            if (apolloApiKeyInput && data.apolloApiKey) {
                apolloApiKeyInput.value = data.apolloApiKey;
            }
            if (lushaApiKeyInput && data.lushaApiKey) {
                lushaApiKeyInput.value = data.lushaApiKey;
            }
        });

        //Save API key on input 
        contactOutApiKeyInput.addEventListener('input', function(){
            chrome.storage.local.set({contactOutApiKey: contactOutApiKeyInput.value});
        });

        apolloApiKeyInput.addEventListener('input', function(){
            chrome.storage.local.set({apolloApiKey: apolloApiKeyInput.value});
        });

        lushaApiKeyInput.addEventListener('input', function(){
            chrome.storage.local.set({lushaApiKey: lushaApiKeyInput.value}); 
        });

    }

    _handleLinkedinURLsOnTextArea(){
        linkedinUrlsInput.addEventListener('input', ()=> {
            chrome.storage.local.set({linkedInUrls: linkedinUrlsInput.value});
            this._filterLinkedinURLsCount(); 
        });
    }

    async _handleLinkedinEnrichment(){

        //Checking existence of ContactOut & Lusha API Key & linkedin URLs

        const contactOutKey = contactOutApiKeyInput.value.trim();
        const apolloKey = apolloApiKeyInput.value.trim(); 
        const lushaKey = lushaApiKeyInput.value.trim();
        const urls = linkedinUrlsInput.value.trim();

        // Required keys for this page — pipeline assumes non-empty Lusha + ContactOut (see cddEnrichment.js).
        if (!contactOutKey) {
            enrichmentStatusEl.textContent = 'Please enter ContactOut API Key';
            enrichmentStatusEl.className = 'status-message error';
            return;
        }

        if (!lushaKey) {
            enrichmentStatusEl.textContent = 'Please enter Lusha API Key';
            enrichmentStatusEl.className = 'status-message error';
            return;
        }

        //Disable enrich button while it's processing 
        enrichFromUrlsBtn.disabled = true;
        enrichmentStatusEl.textContent = 'Starting enrichment...'; 
        enrichmentStatusEl.className = 'status-message loading'; 

        try{

            await processLinkedinURLs(urls, apolloKey, lushaKey, contactOutKey);

        }catch(error){
            enrichmentStatusEl.textContent = 'Error:' + error.message; 
            enrichmentStatusEl.className = 'status-message error'; 
        } finally {
            enrichFromUrlsBtn.disabled = false; 

            //reactive button status from disable to enable;
        }
    };
}

new TalentDataEnrichment();