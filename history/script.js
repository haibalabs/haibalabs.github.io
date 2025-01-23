// script.js
import { VERSION }          from './modules/config.js';
import { EventManager }     from './modules/event-manager.js';
import { UIManager }        from './modules/ui-manager.js';
import { PanelManager }     from './modules/panel-manager.js';
import { initMap }          from './modules/map-utils.js';

// Initialize map globally since it's used across different modules
const { map, markersLayer, geocodeCache } = initMap();

function initControls() {
    const panel = document.querySelector('.controls-panel');
    const toggleBtn = document.querySelector('.toggle-controls-btn');
    const timelineWrapper = document.querySelector('.timeline-wrapper'); 
   
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('open');
      timelineWrapper.classList.toggle('sidepanel-open');
      toggleBtn.textContent = panel.classList.contains('open') ? '‹' : '›';
    });
}

initControls();

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