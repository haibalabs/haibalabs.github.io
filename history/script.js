// script.js
import { VERSION }          from './modules/config.js';
import { EventManager }     from './modules/event-manager.js';
import { UIManager }        from './modules/ui-manager.js';
import { PanelManager }     from './modules/panel-manager.js';
import { initMap }          from './modules/map-utils.js';

// Initialize map globally since it's used across different modules
const { map, markersLayer, geocodeCache } = initMap();

function initTouchControls() {
    const panel = document.querySelector('.controls-panel');
    const toggleBtn = document.querySelector('.toggle-controls-btn');
    const timelineWrapper = document.querySelector('.timeline-wrapper'); 
    
    let touchStartX = 0;
    let touchEndX = 0;

    panel.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    });

    panel.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchEndX - touchStartX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                panel.classList.add('open');
            } else {
                panel.classList.remove('open');
            }
        }
    }
   
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('open');
      timelineWrapper.classList.toggle('sidepanel-open');
      toggleBtn.textContent = panel.classList.contains('open') ? '‹' : '›';
    });
}

initTouchControls();

async function initializeApp() {
    document.getElementById('versionNumber').textContent = VERSION;
    
    const eventManager = new EventManager();
    const panelManager = new PanelManager(map, markersLayer, geocodeCache, () => {
        uiManager.resetWindow();
    });
    const uiManager = new UIManager(eventManager, panelManager);
    
    // Get data file from URL params
    const params = new URLSearchParams(window.location.search);
    const dataFile = params.get('file') || 'events.json';

    try {
        document.body.classList.add('hide-low-confidence');
        await eventManager.loadEvents(dataFile);
        uiManager.renderFilters();

        // Calculate initial visible range and render
        uiManager.resetWindow();
    } catch (error) {
        console.error('Failed to initialize app:', error);
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);