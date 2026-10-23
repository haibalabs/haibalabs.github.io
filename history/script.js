import { VERSION }      from './modules/config.js';
import { EventManager } from './modules/event-manager.js';
import { UIManager }    from './modules/ui-manager.js';
import { PanelManager } from './modules/panel-manager.js';
import { ModalManager } from './modules/modal-manager.js';
import { initMap, LocationVerifier } from './modules/map-utils.js';
import { initTimelineNav } from './modules/timeline-nav.js';

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

async function initializeApp() {
    document.getElementById('versionNumber').textContent = VERSION;

    const locationVerifier = new LocationVerifier();
    await locationVerifier.loadUnverifiedLocations('unverified-locations.json');
    const eventManager = new EventManager(locationVerifier);

    const panelManager = new PanelManager(map, markersLayer, geocodeCache, () => {
        uiManager.resetLayout();
    });
    const uiManager = new UIManager(eventManager, panelManager);

    const modalManager = new ModalManager(eventManager, uiManager);

    // Get data file from URL params
    const params = new URLSearchParams(window.location.search);
    const dataFile = params.get('file') || 'events.json';

    try {
        document.body.classList.add('hide-low-confidence');
        await eventManager.loadEvents(dataFile);
        uiManager.renderFilters();
        initControls();

        // Calculate initial visible range and render
        uiManager.resetWindow();
        initTimelineNav({ eventManager, uiManager });
    } catch (error) {
        console.error('Failed to initialize app:', error);
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);