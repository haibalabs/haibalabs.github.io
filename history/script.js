import { MapBrowser } from './modules/map-browser.js';
import { VERSION }      from './modules/config.js';
import { EventManager } from './modules/event-manager.js';
import { UIManager }    from './modules/ui-manager.js';
import { PanelManager } from './modules/panel-manager.js';
import { ModalManager } from './modules/modal-manager.js';
import { initMap, LocationVerifier } from './modules/map-utils.js';
import { initTimelineNav } from './modules/timeline-nav.js';
import { keepTimelinePosition } from './modules/timeline-position.js';
import { startTimeTravel } from './modules/time-travel.js';
import { TimelineUI }   from './modules/timeline-ui.js';
import { TimelineStore } from './modules/timeline-store.js';
import { FirebaseImageStore } from './modules/firebase-image-store.js';
import { releasePositions } from './modules/world-locations.js';
import { EditUI } from './modules/edit-ui.js';
import { EditStore } from './modules/edit-store.js';
import { EditUploads } from './modules/edit-uploads.js';
import { PlaceSearch } from './modules/place-search.js';
import { initThemeChoice } from './modules/theme.js';
import { fetchAddedEventIds, fetchLandmarks, fetchPublished, manifestUrlFor, MANIFEST_URL, NEXT_MANIFEST_URL, publishedWorld } from './modules/published-data.js';
import { refuseWrites } from './modules/firebase-writes.js';
import { clearPlaceLabels, setPlaceLabels } from './modules/world-labels.js';
import { fetchLiveRelease } from './modules/world-release.js';
import { showStagingBanner } from './modules/release-ui.js';

// The site loads the published release that Firestore names as live (world-release.js), or the one
// committed with it. ?file= opens a data file and its release files instead, as before the switch (tests
// and the publication smoke use it). ?data=next is the read-only staging preview of the next release, or of
// ?release=<manifest hash>: it shares the live Firebase project, so that page refuses every write, whatever
// its controls show, except the admin's "Make this live" (release-ui.js).
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const STAGING = PAGE_PARAMS.get('data') === 'next';
const PUBLISHED = STAGING || !PAGE_PARAMS.has('file');
if (STAGING) {
    refuseWrites('This is the staging site, which is read-only.');
    document.documentElement.classList.add('staging');
}

// The live release, or the committed one when none is named or the named one can't be loaded.
async function fetchLiveData(live) {
    if (live) {
        try {
            return await fetchPublished(manifestUrlFor(live.manifest_sha256));
        } catch (error) {
            console.warn('The live release could not be loaded; showing the committed one:', error);
        }
    }
    return fetchPublished(MANIFEST_URL);
}

// The release staging previews: the one ?release= names, else the next release, else the committed one.
async function fetchStagedData() {
    const named = PAGE_PARAMS.get('release');
    if (/^[0-9a-f]{64}$/.test(named ?? '')) return fetchPublished(manifestUrlFor(named));
    try {
        return await fetchPublished(NEXT_MANIFEST_URL);
    } catch {
        return fetchPublished(MANIFEST_URL);
    }
}

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
    // the published release serves its own copy of the corrections, loaded with the release below
    if (!PUBLISHED) await locationVerifier.loadUnverifiedLocations('unverified-locations.json');
    const eventManager = new EventManager(locationVerifier);

    const panelManager = new PanelManager(map, markersLayer, geocodeCache, () => {
        uiManager.relayoutKeepingPlace();
    });
    const uiManager = new UIManager(eventManager, panelManager);

    // one place search for both event forms, over the loaded world events' places
    const placeSearch = new PlaceSearch(() => eventManager.events);
    const modalManager = new ModalManager(eventManager, uiManager, { placeSearch });
    uiManager.modalManager = modalManager;
    // before any await, so it hears the first sign-in state
    uiManager.timelineUI = new TimelineUI(eventManager, uiManager,
        new TimelineStore(eventManager.db, eventManager.auth),
        new FirebaseImageStore(eventManager.firebaseApp, { emulator: eventManager.usesEmulators }));
    uiManager.editUI = new EditUI(eventManager, uiManager, new EditStore(eventManager.db, eventManager.auth), {
        placeSearch, uploads: new EditUploads(eventManager.firebaseApp, { emulator: eventManager.usesEmulators }),
    });

    // ?file= names the data file to open instead of the published release, such as canonical-t2.json
    const params = PAGE_PARAMS;
    const dataFile = params.get('file') || 'canonical-t2.json';

    const endTimeTravel = startTimeTravel();
    try {
        document.body.classList.add('hide-low-confidence');
        const publishedEdits = uiManager.fetchPublishedEdits();
        // read alongside the approved edits; only the live page has to wait for it before loading
        const liveRelease = PUBLISHED ? fetchLiveRelease(eventManager.db) : null;
        // the loaded release's manifest, for what loads after the timeline (its landmarks)
        let releaseManifest = null;
        // on the staging page: the previewed release and its banner, which shows its new events once found
        let staged = null;
        if (PUBLISHED) {
            const [live, published] = await Promise.all([liveRelease,
                STAGING ? fetchStagedData() : liveRelease.then(fetchLiveData)]);
            releaseManifest = published.manifest;
            // the footer names the release this page serves, so anyone can tell which one is live or staged
            const releaseName = published.manifest.release_id ?? published.manifest.snapshot_id ?? 'unnamed';
            document.getElementById('releaseInfo').textContent = ` · release ${releaseName} (${published.manifestSha256.slice(0, 8)})`;
            // images and places come with the release; the corrections apply as each event loads
            await locationVerifier.loadUnverifiedLocations(published.correctionsUrl);
            const world = publishedWorld(published);
            eventManager.loadPublished(world);
            clearPlaceLabels();
            setPlaceLabels(world.labels);
            if (STAGING) {
                const banner = showStagingBanner({ live, db: eventManager.db, uiManager, staged: { manifestSha256: published.manifestSha256,
                    releaseId: published.manifest.release_id ?? published.manifest.snapshot_id ?? 'unnamed' } });
                staged = { published, banner, live };
            }
        } else {
            // the released records are kept as loaded, so their checks need no second download
            const images = uiManager.fetchReleasedImages();
            const locations = uiManager.fetchReleasedLocations();
            const labels = uiManager.fetchPlaceLabels();
            await eventManager.loadEvents(dataFile, { keepRecords: Promise.all([images, locations]).then(([i, l]) => [...releasePositions(i), ...releasePositions(l)]) });
            // images first: their checks compare each event's places as loaded
            await uiManager.showReleasedImages(await images);
            await uiManager.showReleasedLocations(await locations);
            // labels go by each location's place_id, after the location release has merged places
            await uiManager.showPlaceLabels(await labels);
        }
        // approved edits last: the release checks above compare the events as the file has them
        uiManager.showPublishedEdits(await publishedEdits);
        // the timeline works without the map, so a map failure doesn't stop the rest of the start-up
        try {
            uiManager.mapBrowser = new MapBrowser(eventManager, uiManager, panelManager);
        } catch (error) {
            console.error('The map could not start:', error);
        }
        uiManager.renderFilters();
        initControls();

        // Calculate initial visible range and render
        uiManager.resetWindow();
        endTimeTravel();
        initTimelineNav({ eventManager, uiManager });
        uiManager.timelineUI.worldReady();
        // back from the review page (or a reload) in this tab, the timeline opens where the reader left it
        keepTimelinePosition(uiManager);
        // the release's landmarks load after the timeline, so they never hold it up; the site works without them
        if (releaseManifest && uiManager.mapBrowser) {
            fetchLandmarks(releaseManifest)
                .then(landmarks => landmarks && uiManager.mapBrowser.showLandmarks(landmarks))
                .catch(error => console.error('The landmarks could not load:', error));
        }
        // The staged release's new events are those the release visitors see now doesn't serve, so a review
        // covers all that Make this live would add, even when several releases were staged since. Finding them
        // waits for the timeline, as it may fetch that release's shards.
        if (staged) {
            const liveUrl = staged.live ? manifestUrlFor(staged.live.manifest_sha256) : MANIFEST_URL;
            staged.banner.showNewEvents(fetchAddedEventIds(staged.published, liveUrl));
        }
        // character cards (characters/): a profiled person's name on an event card opens their card above the timeline
        // and map search (map-search/): a field at the map's top right that flies the map to a landmark or place
        if (uiManager.mapBrowser) {
            const app = { map, eventManager, uiManager, panelManager, browser: uiManager.mapBrowser };
            import('./characters/characters.js')
                .then(({ setCharacters }) => setCharacters(app, true))
                .catch(error => console.error('The character cards could not start:', error));
            import('./map-search/map-search.js')
                .then(({ setSearch }) => setSearch(app, true))
                .catch(error => console.error('The map search could not start:', error));
        }
        // ?lab opens the map lab (lab/map/), which is loaded only then
        if (params.has('lab') && uiManager.mapBrowser) {
            import('./lab/map/lab.js')
                .then(({ startLab }) => startLab({ map, eventManager, uiManager, panelManager, browser: uiManager.mapBrowser }))
                .catch(error => console.error('The map lab could not start:', error));
        }
    } catch (error) {
        endTimeTravel();
        console.error('Failed to initialize app:', error);
        // The message is for the events themselves failing. A later step failing (a sidecar) still shows the
        // events as loaded, unless drawing them is what failed.
        if (!eventManager.events.length) uiManager.showLoadFailure();
        else {
            try {
                uiManager.resetWindow();
            } catch (drawError) {
                console.error('The events could not be drawn:', drawError);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);