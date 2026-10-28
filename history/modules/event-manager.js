// event-manager.js
import { PlaceEventIndex } from './place-event-index.js';
import { eventSortableValue, eventTiebreak } from './date-handlers.js';
import { acknowledgement, incomingProblem, mergeDecision, newEventId, pushDecision, syncTarget, toSyncDoc } from './sync-identity.js';
import { sha256Hex } from './world-images.js';

import { initializeApp as firebaseInit } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator, collection, doc, getDoc, query, runTransaction, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
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
        this.sortedIndices = [];
        this.currentFilter = 'all';
        this.searchTerm = '';
        this.cachedFilteredEvents = null;
        this.placeIndex = new PlaceEventIndex();
        this.geographicFilter = {};
        this.timeRange = {};
        this.currentFile = null;
        // Firestore collection for this dataset, or null with the reason sync is unavailable
        this.syncTarget = { collection: null, reason: 'No dataset loaded.', duplicateIds: [] };
        // Highest server revision (lastModified, ms) applied or confirmed unchanged
        this.syncCursor = 0;
        // event_id -> { server, revision } for server changes that clash with local edits
        this.conflicts = new Map();
        // document key -> reason, for server documents that cannot be merged as events
        this.quarantined = new Map();
        this.datasetMetadata = null;
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

    // Re-checks whether the current events may sync; IDs can change after load (adds, pulls).
    refreshSyncTarget() {
        this.syncTarget = syncTarget(this.currentFile, this.datasetMetadata, this.events.filter(event => !event.personal));
    }

    // The dataset's collection; throws with the reason when this dataset cannot sync.
    requireSyncCollection() {
        this.refreshSyncTarget();
        if (!this.syncTarget.collection) throw new Error(this.syncTarget.reason);
        return this.syncTarget.collection;
    }

    // Events with local changes not yet pushed, excluding those in an unresolved conflict.
    getUnpushedEvents() {
        return this.events.filter(event => event.dirty && !this.conflicts.has(event.event_id));
    }

    /**
     * Writes each unpushed event in a transaction that first reads the server revision. If another
     * change landed after the revision the local edit was based on, nothing is written and the
     * event joins this.conflicts with its local changes kept.
     *
     * @returns {Promise<{ saved: number, conflicts: number }>}
     */
    async pushChanges() {
        const collectionName = this.requireSyncCollection();
        const user = this.auth.currentUser;
        if (!user) throw new Error('User must be authenticated to push events');

        let saved = 0;
        let conflicts = 0;
        const errors = [];
        for (const event of this.getUnpushedEvents()) {
            const ref = doc(this.db, collectionName, event.event_id);
            const sent = toSyncDoc(event);
            const writeId = crypto.randomUUID();
            try {
                const conflict = await runTransaction(this.db, async (tx) => {
                    const snap = await tx.get(ref);
                    const serverRevision = snap.exists() ? (snap.data().lastModified?.toMillis?.() ?? 0) : null;
                    if (pushDecision(event, serverRevision) === 'conflict') {
                        return { server: snap.data(), revision: serverRevision };
                    }
                    tx.set(ref, { ...sent, writeId, lastModified: serverTimestamp(), userId: user.uid });
                    return null;
                });
                if (conflict) {
                    this.conflicts.set(event.event_id, conflict);
                    conflicts++;
                    continue;
                }
                const written = (await getDoc(ref)).data();
                Object.assign(event, acknowledgement(event, sent, writeId,
                    { data: written, revision: written?.lastModified?.toMillis?.() ?? null }));
                event.isNew = false;
                saved++;
            } catch (error) {
                errors.push({ event: event.name, error: error.message });
            }
        }

        if (errors.length > 0) {
            throw new Error(`Saved ${saved} events, but failed to save ${errors.length} events. First error: ${errors[0].error}`);
        }
        return { saved, conflicts };
    }

    getUnpushedCount() {
        return this.getUnpushedEvents().length;
    }

    // A local event built from a server document at the given revision.
    fromServer(data, revision) {
        const { lastModified, userId, ...fields } = data;
        return this.normalizeEvent({ ...fields, lastModified: revision, dirty: false, syncedRevision: revision });
    }

    /**
     * Applies server revisions newer than the cursor. Untouched events take the server version;
     * events with unsynced local changes are held in this.conflicts until resolveConflict().
     *
     * Documents whose key is not a valid event ID matching their event_id are set aside in
     * this.quarantined and never merged.
     *
     * @returns {Promise<{ applied: number, conflicts: number, quarantined: number }>}
     */
    async pullChanges() {
        try {
            const collectionName = this.requireSyncCollection();
            if (!this.auth.currentUser) throw new Error('User must be authenticated to pull events');

            const snapshot = await getDocs(query(collection(this.db, collectionName),
                where('lastModified', '>', new Date(this.syncCursor))));
            const indexById = new Map(this.events.map((event, i) => [event.event_id, i]));
            let applied = 0;
            let maxSeen = this.syncCursor;

            snapshot.forEach((snap) => {
                const data = snap.data();
                const revision = data.lastModified?.toMillis?.() ?? 0;
                const id = snap.id;
                const problem = incomingProblem(id, data);
                if (problem) {
                    this.quarantined.set(id, problem);
                    maxSeen = Math.max(maxSeen, revision);
                    return;
                }
                const index = indexById.get(id);
                const decision = mergeDecision(this.events[index], revision);

                if (decision === 'conflict') {
                    this.conflicts.set(id, { server: data, revision });
                    return;
                }
                maxSeen = Math.max(maxSeen, revision);
                if (decision === 'unchanged') return;
                if (decision === 'add') {
                    indexById.set(id, this.events.length);
                    this.events.push(this.fromServer(data, revision));
                } else {
                    this.events[index] = this.fromServer(data, revision);
                }
                applied++;
            });

            // never move the cursor past an unresolved conflict, so later pulls return it again
            const conflictRevisions = [...this.conflicts.values()].map(c => c.revision);
            this.syncCursor = conflictRevisions.length
                ? Math.min(maxSeen, Math.min(...conflictRevisions) - 1)
                : maxSeen;

            if (applied > 0) {
                this.sortEvents();
                this.invalidateCache();
                this.refreshSyncTarget();
            }
            return { applied, conflicts: this.conflicts.size, quarantined: this.quarantined.size };
        } catch (error) {
            console.error('Error syncing with Firestore:', error);
            throw error;
        }
    }

    /**
     * Settles a conflict: 'server' takes the server version, 'local' keeps the local changes,
     * which the next push writes over the server version.
     *
     * @param {string} eventId
     * @param {'server'|'local'} keep
     */
    resolveConflict(eventId, keep) {
        const conflict = this.conflicts.get(eventId);
        if (!conflict) return;
        const index = this.events.findIndex(event => event.event_id === eventId);
        if (keep === 'server') {
            this.events[index] = this.fromServer(conflict.server, conflict.revision);
        } else {
            this.events[index].syncedRevision = conflict.revision;
        }
        this.conflicts.delete(eventId);
        this.sortEvents();
        this.invalidateCache();
        this.refreshSyncTarget();
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

            // Events from the file are untouched and have never been synced
            this.events = eventsArray.map(event => {
                return this.normalizeEvent({
                    ...event,
                    dirty: false,
                    syncedRevision: null
                }, baseTimestamp);
            });
            this.datasetMetadata = data.metadata ?? null;
            this.syncCursor = 0;
            this.conflicts.clear();
            this.quarantined.clear();
            this.refreshSyncTarget();

            this.sortEvents();
            this.invalidateCache();
    
            // Immediately pull any server changes
            // await this.pullChanges(); // to enable later - right now you need to login to pull
            
            return this.events;
        } catch (error) {
            console.error('Error loading events:', error);
            throw error;
        }
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

    // A new event gets its permanent ID here, once, and stays dirty until pushed.
    addEvent(event) {
        const normalizedEvent = this.normalizeEvent({
            ...event,
            event_id: event.event_id || newEventId(),
            isNew: true,
            dirty: true,
            syncedRevision: null
        });

        this.events.push(normalizedEvent);
        this.sortEvents();
        this.invalidateCache();
        // a supplied ID may duplicate an existing one, which turns sync off
        this.refreshSyncTarget();
    }

    setGeographicFilter(filter = {}) {
        this.geographicFilter = filter;
        this.invalidateCache();
    }

    setTimeRange(from = null, through = null) {
        this.timeRange = { from, through };
        this.invalidateCache();
    }

    // Personal timeline events live in this.events next to world events, marked personal: true.
    // TimelineStore saves them as they change, so they are never dirty for world sync.
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
            personal: true, timelineId, dirty: false });
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
                    const hasAcceptableConfidence = event.confidence !== 'low';
                    const matchesFilter = !filter || filter === 'all' || 
                        (event.categories && event.categories.includes(filter));
                    const matchesSearch = !searchTerm || (
                        (event.name && event.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        (event.description && event.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        (event.enhanced_description && event.enhanced_description.toLowerCase().includes(searchTerm.toLowerCase()))
                    );
                    const id = this.placeIndex.idFor(event);
                    const year = this.placeIndex.years.get(id);
                    const { from, through } = this.timeRange;
                    const matchesTime = (from == null || year >= from) && (through == null || year <= through);
                    const matchesView = this.timelineView !== 'only' || event.personal === true;
                    return hasAcceptableConfidence && matchesFilter && matchesSearch && matchesTime && matchesView && geographicIds.has(id);
                });
        }
        return this.cachedFilteredEvents;
    }    

    getHighMediumCount() {
        return this.events.filter(e => e.confidence !== 'low').length;
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
