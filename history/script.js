import { MapBrowser } from './modules/map-browser.js';
import { VERSION }      from './modules/config.js';
import { EventManager } from './modules/event-manager.js';
import { UIManager }    from './modules/ui-manager.js';
import { PanelManager } from './modules/panel-manager.js';
import { ModalManager } from './modules/modal-manager.js';
import { initMap, LocationVerifier } from './modules/map-utils.js';
import { initTimelineNav } from './modules/timeline-nav.js';
import { startTimeTravel } from './modules/time-travel.js';
import { TimelineUI }   from './modules/timeline-ui.js';
import { TimelineStore } from './modules/timeline-store.js';
import { FirebaseImageStore } from './modules/firebase-image-store.js';
import { releasePositions } from './modules/world-locations.js';
import { EditUI } from './modules/edit-ui.js';
import { EditStore } from './modules/edit-store.js';
import { initThemeChoice } from './modules/theme.js';

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
    initThemeChoice();

    const locationVerifier = new LocationVerifier();
    await locationVerifier.loadUnverifiedLocations('unverified-locations.json');
    const eventManager = new EventManager(locationVerifier);

    const panelManager = new PanelManager(map, markersLayer, geocodeCache, () => {
        uiManager.relayoutKeepingPlace();
    });
    const uiManager = new UIManager(eventManager, panelManager);

    const modalManager = new ModalManager(eventManager, uiManager);
    uiManager.modalManager = modalManager;
    // before any await, so it hears the first sign-in state
    uiManager.timelineUI = new TimelineUI(eventManager, uiManager,
        new TimelineStore(eventManager.db, eventManager.auth),
        new FirebaseImageStore(eventManager.firebaseApp, { emulator: eventManager.usesEmulators }));
    new EditUI(eventManager, uiManager, new EditStore(eventManager.db, eventManager.auth));

    // Get data file from URL params
    const params = new URLSearchParams(window.location.search);
    // the canonical world dataset, with stable event IDs; ?file=events.json still opens the legacy file
    const dataFile = params.get('file') || 'canonical-t2.json';

    const endTimeTravel = startTimeTravel();
    try {
        document.body.classList.add('hide-low-confidence');
        // the released records are kept as loaded, so their checks need no second download
        const images = uiManager.fetchReleasedImages();
        const locations = uiManager.fetchReleasedLocations();
        const labels = uiManager.fetchPlaceLabels();
        const publishedEdits = uiManager.fetchPublishedEdits();
        await eventManager.loadEvents(dataFile, { keepRecords: Promise.all([images, locations]).then(([i, l]) => [...releasePositions(i), ...releasePositions(l)]) });
        // images first: their checks compare each event's places as loaded
        await uiManager.showReleasedImages(await images);
        await uiManager.showReleasedLocations(await locations);
        // labels go by each location's place_id, after the location release has merged places
        await uiManager.showPlaceLabels(await labels);
        // approved edits last: the release checks above compare the events as the file has them
        uiManager.showPublishedEdits(await publishedEdits);
        uiManager.mapBrowser = new MapBrowser(eventManager, uiManager, panelManager);
        uiManager.renderFilters();
        initControls();

        // Calculate initial visible range and render
        uiManager.resetWindow();
        endTimeTravel();
        initTimelineNav({ eventManager, uiManager });
        uiManager.timelineUI.worldReady();
    } catch (error) {
        endTimeTravel();
        console.error('Failed to initialize app:', error);
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);