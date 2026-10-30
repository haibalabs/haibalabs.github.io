// Map lab: the site's startup (history/script.js) with a MapBrowser subclass and a panel of switches.
// Every switch off is the site as it is on main. Switch state lives in ?lab=<id>,<id> so a variant can
// be reloaded, bookmarked or opened beside another in a second window.
import { VERSION }      from '../../modules/config.js';
import { EventManager } from '../../modules/event-manager.js';
import { UIManager }    from '../../modules/ui-manager.js';
import { PanelManager } from '../../modules/panel-manager.js';
import { ModalManager } from '../../modules/modal-manager.js';
import { initMap, LocationVerifier } from '../../modules/map-utils.js';
import { initTimelineNav } from '../../modules/timeline-nav.js';
import { TimelineUI }   from '../../modules/timeline-ui.js';
import { TimelineStore } from '../../modules/timeline-store.js';
import { FirebaseImageStore } from '../../modules/firebase-image-store.js';
import { releasePositions } from '../../modules/world-locations.js';
import { EditUI } from '../../modules/edit-ui.js';
import { EditStore } from '../../modules/edit-store.js';
import { LabMapBrowser } from './lab-map-browser.js';
import { VARIANTS } from './variants.js';
import { LabPanel } from './lab-panel.js';

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
        uiManager.relayoutKeepingPlace();
    });
    const uiManager = new UIManager(eventManager, panelManager);

    const modalManager = new ModalManager(eventManager, uiManager);
    uiManager.modalManager = modalManager;
    uiManager.timelineUI = new TimelineUI(eventManager, uiManager,
        new TimelineStore(eventManager.db, eventManager.auth),
        new FirebaseImageStore(eventManager.firebaseApp, { emulator: eventManager.usesEmulators }));
    new EditUI(eventManager, uiManager, new EditStore(eventManager.db, eventManager.auth));

    const params = new URLSearchParams(window.location.search);
    const dataFile = params.get('file') || 'canonical-t2.json';

    try {
        document.body.classList.add('hide-low-confidence');
        const images = uiManager.fetchReleasedImages();
        const locations = uiManager.fetchReleasedLocations();
        await eventManager.loadEvents(dataFile, { keepRecords: Promise.all([images, locations]).then(([i, l]) => [...releasePositions(i), ...releasePositions(l)]) });
        await uiManager.showReleasedImages(await images);
        await uiManager.showReleasedLocations(await locations);
        uiManager.mapBrowser = new LabMapBrowser(eventManager, uiManager, panelManager);
        uiManager.renderFilters();
        initControls();

        uiManager.resetWindow();
        initTimelineNav({ eventManager, uiManager });
        uiManager.timelineUI.worldReady();

        const lab = { map, eventManager, uiManager, panelManager, browser: uiManager.mapBrowser };
        new LabPanel(lab, VARIANTS, panelManager.mapPanel);
        // The lab is for the map: open its drawer on wide screens, where the timeline stays beside it.
        if (window.matchMedia('(min-width: 641px)').matches) document.getElementById('toggle-map').click();
        window.lab = lab;
    } catch (error) {
        console.error('Failed to initialize map lab:', error);
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);
