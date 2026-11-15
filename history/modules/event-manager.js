// event-manager.js
import { acceptedEventIds } from './world-acceptance.js';
import { PlaceEventIndex } from './place-event-index.js';
import { eventSortableValue, eventTiebreak } from './date-handlers.js';
import { sha256Hex } from './world-images.js';
import { placeLabel } from './world-labels.js';

import { initializeApp as firebaseInit } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-analytics.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js";

// ?emulator on localhost connects to the local Firebase emulators (see firebase/README.md)
const USE_EMULATORS = typeof location !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URLSearchParams(location.search).has('emulator');

export class EventManager {
    constructor(locationVerifier) {
        this.locationVerifier = locationVerifier;
        this.events = [];
        this.acceptedWorldEvents = new WeakSet();
        this.sortedIndices = [];
        this.currentFilter = 'all';
        this.searchTerm = '';
        this.cachedFilteredEvents = null;
        this.placeIndex = new PlaceEventIndex();
        this.geographicFilter = {};
        this.timeRange = {};
        this.currentFile = null;
        this.timelineView = 'with-world';

        // Firebase Configuration
        const firebaseConfig = {
            apiKey: "AIzaSyD2_F2ffZusNl2yQzt1O_KaR2iXRYiWPrA",
            authDomain: "historytimeline-81f70.firebaseapp.com",
            projectId: "historytimeline-81f70",
            storageBucket: "historytimeline-81f70.firebasestorage.app",
            messagingSenderId: "276751184860",
            appId: "1:276751184860:web:1df4c5796c219f3cfe9519",
            measurementId: "G-VVKRPCCRXQ"
        };

        // Initialize Firebase
        // the app and emulator flag are kept for the personal-photo Storage adapter (script.js)
        this.usesEmulators = USE_EMULATORS;
        if (USE_EMULATORS) {
            const firebaseApp = firebaseInit({ apiKey: 'demo-key', projectId: 'demo-historiline', storageBucket: 'demo-historiline.appspot.com' });
            this.firebaseApp = firebaseApp;
            this.db = getFirestore(firebaseApp);
            this.auth = getAuth(firebaseApp);
            connectFirestoreEmulator(this.db, '127.0.0.1', 8085);
            connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
            return;
        }
        const firebaseApp = firebaseInit(firebaseConfig);
        this.firebaseApp = firebaseApp;
        const analytics = getAnalytics(firebaseApp);
        this.db = getFirestore(firebaseApp);
        this.auth = getAuth(firebaseApp);

        console.log("Firebase initialized successfully!");
    }

    /**
     * @param {string} dataFile
     * @param {{ keepRecords?: Promise<number[]>|number[] }} [options] - positions of records to keep
     *     untouched copies of in keptRecords, before loading normalizes and annotates the events
     */
    async loadEvents(dataFile, { keepRecords = [] } = {}) {
        try {
            this.currentFile = dataFile;
            const response = await fetch(dataFile);
            if (!response.ok) {
                throw new Error(`Could not load data file: ${dataFile}`);
            }
    
            const bytes = await response.arrayBuffer();
            // The hash of the exact bytes these events were parsed from, and a count of loads.
            // Previews bound to one reviewed file check both (world-images.js).
            this.loadedSha256 = sha256Hex(bytes);
            this.releaseManifestSha256 = null;
            this.loadGeneration = (this.loadGeneration ?? 0) + 1;
            const data = JSON.parse(new TextDecoder().decode(bytes));
            let eventsArray;
            let baseTimestamp;
    
            // Check if we have the new format with metadata
            if (data.metadata && data.events) {
                // Parse ISO timestamp from metadata
                baseTimestamp = new Date(data.metadata.timestamp).getTime();
                eventsArray = data.events;
            } else {
                // Old format - use HTTP headers
                const lastModified = response.headers.get('last-modified');
                baseTimestamp = new Date(lastModified).getTime();
                eventsArray = data; // Assume data is the events array
            }
    
            // Store the file timestamp
            this.fileTimestamp = baseTimestamp;

            // Copies of the requested records as the file has them: normalizing annotates nested
            // fields such as locations in place. Released images compare against these (world-images.js).
            const keep = await Promise.resolve(keepRecords).catch(() => []);
            this.keptRecords = [];
            for (const index of keep) {
                if (Number.isInteger(index) && index >= 0 && index < eventsArray.length) this.keptRecords[index] = structuredClone(eventsArray[index]);
            }

            this.adoptEvents(eventsArray, baseTimestamp, await acceptedEventIds(data));
            return this.events;
        } catch (error) {
            console.error('Error loading events:', error);
            throw error;
        }
    }

    /**
     * Loads the world events of a published release (published-data.js), already in the shape a data
     * file gives. Each placed location takes its reviewed place after the manual corrections, as a
     * location release does for a data file.
     *
     * @param {{ manifestUrl: string, manifestSha256: string, timestamp: number, events: object[],
     *     acceptedIds: Set<string>, placeLocations: (events: object[]) => void }} published
     */
    loadPublished(published) {
        this.currentFile = published.manifestUrl;
        // previews are bound to the bytes of one data file, which a published release doesn't have
        this.loadedSha256 = null;
        // the release a visitor saw, which edits and flags record
        this.releaseManifestSha256 = published.manifestSha256 ?? null;
        this.loadGeneration = (this.loadGeneration ?? 0) + 1;
        this.keptRecords = [];
        this.fileTimestamp = published.timestamp;
        this.adoptEvents(published.events, published.timestamp, published.acceptedIds, published.placeLocations);
        return this.events;
    }

    // Normalizes the loaded events (verifying their locations), marks the accepted ones and sorts them.
    adoptEvents(eventsArray, baseTimestamp, acceptedIds, placeLocations = null) {
        this.acceptedWorldEvents = new WeakSet();
        this.events = eventsArray.map(event => this.normalizeEvent({ ...event }, baseTimestamp));
        placeLocations?.(this.events);
        for (const event of this.events) {
            if (acceptedIds.has(event.event_id)) this.acceptedWorldEvents.add(event);
        }
        this.sortEvents();
        this.invalidateCache();
    }    

    // Helper to invalidate cache
    invalidateCache() {
        this.cachedFilteredEvents = null;
    }
    
    // Single event normalization
    normalizeEvent(event, fileTimestamp = null) {
        // Basic normalization
        if (!event.enhanced_time && event.time) {
            event.enhanced_time = event.time;
        }

        // Handle timestamps
        if (fileTimestamp) {
            // For events from main file
            event.sourceTimestamp = fileTimestamp;
            event.lastModified = fileTimestamp;
        } else if (!event.lastModified) {
            // For new events with no timestamp
            event.lastModified = Date.now();
        }
        // If event has lastModified, keep it

        // Verify location if needed
        if (this.locationVerifier) {
            this.locationVerifier.verifyEventLocation(event);
        }

        return event;
    }

    setGeographicFilter(filter = {}) {
        this.geographicFilter = filter;
        this.invalidateCache();
    }

    setTimeRange(from = null, through = null) {
        this.timeRange = { from, through };
        this.invalidateCache();
    }

    // Only the world events with these IDs, or every event for null. The visibility rules still apply.
    setEventIdFilter(ids = null) {
        this.eventIdFilter = ids;
        this.invalidateCache();
    }

    // Personal timeline events live in this.events next to world events, marked personal: true.
    // TimelineStore saves them as they change.
    setPersonalEvents(timelineId, events) {
        this.events = this.events.filter(event => !event.personal);
        for (const event of events) this.events.push(this.toPersonal(timelineId, event));
        this.sortEvents();
        this.invalidateCache();
    }

    clearPersonalEvents() {
        this.events = this.events.filter(event => !event.personal);
        this.timelineView = 'with-world';
        this.sortEvents();
        this.invalidateCache();
    }

    upsertPersonalEvent(timelineId, event) {
        const index = this.events.findIndex(e => e.personal && e.event_id === event.event_id);
        const personal = this.toPersonal(timelineId, event);
        if (index >= 0) this.events[index] = personal;
        else this.events.push(personal);
        this.sortEvents();
        this.invalidateCache();
    }

    removePersonalEvent(eventId) {
        this.events = this.events.filter(e => !(e.personal && e.event_id === eventId));
        this.sortEvents();
        this.invalidateCache();
    }

    toPersonal(timelineId, event) {
        return this.normalizeEvent({ confidence: 'high', categories: [], figures: [], locations: [], ...event,
            personal: true, timelineId });
    }

    // 'with-world' shows personal events among world events; 'only' shows personal events alone.
    setTimelineView(view) {
        this.timelineView = view;
        this.invalidateCache();
    }

    sortEvents() {
        this.placeIndex = new PlaceEventIndex(this.events);
        this.sortedIndices = this.events
            .map((event, index) => ({
                index,
                time: eventSortableValue(event),
                tiebreak: eventTiebreak(event)
            }))
            // deep-time records at one navigation position keep their sort_tiebreak order; a
            // fraction added to the time would be lost to rounding at billions of years
            .sort((a, b) => a.time - b.time || a.tiebreak - b.tiebreak);
    }
  
    getFilteredEvents(filter = null, searchTerm = '') {
        // Only recalculate if filter criteria changed
        if (filter !== this.currentFilter || 
            searchTerm !== this.searchTerm || 
            !this.cachedFilteredEvents) {
            
            const geographicIds = this.placeIndex.query(this.geographicFilter);
            this.currentFilter = filter;
            this.searchTerm = searchTerm;
            this.cachedFilteredEvents = this.sortedIndices
                .map(({ index }) => this.events[index])
                .filter(event => {
                    const hasAcceptableConfidence = this.isVisibleEvent(event);
                    const matchesFilter = !filter || filter === 'all' || 
                        (event.categories && event.categories.includes(filter));
                    const matchesSearch = !searchTerm || (
                        (event.name && event.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        (event.description && event.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        (event.enhanced_description && event.enhanced_description.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        // a place is found by its label or by its written name
                        (event.locations || []).some(location => [location?.name, placeLabel(location)]
                            .some(text => text && text.toLowerCase().includes(searchTerm.toLowerCase())))
                    );
                    const id = this.placeIndex.idFor(event);
                    const year = this.placeIndex.years.get(id);
                    const { from, through } = this.timeRange;
                    const matchesTime = (from == null || year >= from) && (through == null || year <= through);
                    const matchesView = this.timelineView !== 'only' || event.personal === true;
                    const matchesIds = !this.eventIdFilter || (!event.personal && this.eventIdFilter.has(event.event_id));
                    return hasAcceptableConfidence && matchesFilter && matchesSearch && matchesTime && matchesView && matchesIds
                        && geographicIds.has(id);
                });
        }
        return this.cachedFilteredEvents;
    }    

    isAcceptedWorldEvent(event) {
        return this.acceptedWorldEvents.has(event);
    }

    isVisibleEvent(event) {
        return event.confidence !== 'low' || this.isAcceptedWorldEvent(event);
    }

    getHighMediumCount() {
        return this.events.filter(e => this.isVisibleEvent(e)).length;
    }

    findNearestEventIndex(targetTime) {
        return this.sortedIndices.findIndex(({ time }) => time >= targetTime);
    }

    getFirstEventIndex() {
        return this.sortedIndices[0]?.index || 0;
    }

    getLastEventIndex() {
        return this.sortedIndices[this.sortedIndices.length - 1]?.index || 0;
    }
}
