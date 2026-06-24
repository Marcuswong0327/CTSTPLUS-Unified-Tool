
document.addEventListener('DOMContentLoaded', () => {
    // Handle tool button clicks
    const toolButtons = document.querySelectorAll('.tool-button');

    toolButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const toolId = button.getAttribute('data-tool');

            if (toolId === 'auto-messenger') {
                // Navigate to SEEK Auto Messenger page
                window.location.href = 'Auto-Seek-Messenger/auto-messenger.html';
            }
            if (toolId === 'profile-downloader') {
                // Navigate to Profile Downloader page
                window.location.href = 'Profile-Downloader/profile_downloader.html';
            }

            if(toolId === 'competitor-research-tool'){
                //Navigate to competitor research tool
                window.location.href = 'Competitor-Research-Tool/competitor-research-tool.html';
            }

            if (toolId === 'talent-pool-enrichment') {
                //Navigate to talent pool enrichment
                window.location.href = 'Talent-Data-Enrichment/talent-data-enrichment.html'
            }

            if (toolId === 'talent-pool-extraction') {
                //Navigate to talent pool extraction
                window.location.href = 'Talent-Pool-Extraction/talent-pool-extraction.html'
            }
        });
    });


    // Handle Resume Parser 2.0 button
    const resumeParser2Button = document.getElementById('resume-parser-2-button');
    if (resumeParser2Button) {
        resumeParser2Button.addEventListener('click', () => {
            // Open the Streamlit app in a new tab
            chrome.tabs.create({
                url: 'https://azure-resume-extraction-ai.streamlit.app/'
            });
        });
    }
});

