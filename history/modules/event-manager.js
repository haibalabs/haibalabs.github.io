// event-manager.js
import { parseTimeToSortableValue } from './date-handlers.js';

import { initializeApp as firebaseInit } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator, collection, doc, setDoc, query, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
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
        this.currentFile = null;
        this.lastSyncTimestamp = null;

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
        if (USE_EMULATORS) {
            const firebaseApp = firebaseInit({ apiKey: 'demo-key', projectId: 'demo-historiline' });
            this.db = getFirestore(firebaseApp);
            this.auth = getAuth(firebaseApp);
            connectFirestoreEmulator(this.db, '127.0.0.1', 8085);
            connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
            return;
        }
        const firebaseApp = firebaseInit(firebaseConfig);
        const analytics = getAnalytics(firebaseApp);
        this.db = getFirestore(firebaseApp);
        this.auth = getAuth(firebaseApp);

        console.log("Firebase initialized successfully!");
    }

    getCollectionName() {
        if (!this.currentFile) return 'events_main';
        // Extract filename without extension and sanitize for Firestore
        return 'events_' + this.currentFile.split('/').pop().replace('.json', '')
            .replace(/[^a-zA-Z0-9]/g, '_');
    }

    async saveEvent(event) {
        try {
            const user = this.auth.currentUser;
            if (!user) {
                throw new Error('User must be authenticated to save events');
            }

            const eventRef = doc(this.db, this.getCollectionName(), event.name);
            await setDoc(eventRef, {
                ...event,
                lastModified: serverTimestamp(),
                userId: user.uid // Add user ID to track who made changes
            });

            this.lastSyncTimestamp = Date.now();
            return true;
        } catch (error) {
            console.error('Error saving event:', error);
            throw new Error(`Failed to save event "${event.name}": ${error.message}`);
        }
    }

    async pushChanges() {
        let savedCount = 0;
        let errors = [];
        
        // Filter events that need pushing (local changes newer than remote)
        const unpushedEvents = this.events.filter(event => 
            event.localTimestamp > (event.remoteTimestamp || 0)
        );

        for (const event of unpushedEvents) {
            try {
                const eventRef = doc(this.db, this.getCollectionName(), event.name);
                await setDoc(eventRef, {
                    ...event,
                    isNew: false,
                    lastModified: serverTimestamp(),
                    userId: this.auth.currentUser?.uid
                });

                // Update local event after successful push
                event.isNew = false;
                event.remoteTimestamp = Date.now();
                savedCount++;
            } catch (error) {
                errors.push({
                    event: event.name,
                    error: error.message
                });
            }
        }

        if (errors.length > 0) {
            throw new Error(`Saved ${savedCount} events, but failed to save ${errors.length} events. First error: ${errors[0].error}`);
        }

        if (errors.length === 0) {
            // Update lastSyncTimestamp after successful batch push
            this.lastSyncTimestamp = Date.now();
        }

        return savedCount;
    }

    // Add method to get unpushed count
    getUnpushedCount() {
        return this.events.filter(event => 
            event.localTimestamp > (event.remoteTimestamp || 0)
        ).length;
    }

    async pullChanges() {
        try {
            const user = this.auth.currentUser;
            if (!user) {
                throw new Error('User must be authenticated to pull events');
            }

            // Use the most recent timestamp for comparison
            const sinceTimestamp = Math.max(
                this.fileTimestamp || 0,
                this.lastSyncTimestamp || 0
            );

            const eventsRef = collection(this.db, this.getCollectionName());
            const q = query(
                eventsRef,
                where('lastModified', '>', new Date(sinceTimestamp))
            );

            const snapshot = await getDocs(q);
            let updatedCount = 0;

            snapshot.forEach((doc) => {
                const fbEvent = doc.data();
                const serverTimestamp = fbEvent.lastModified?.toMillis();

                // Update lastSyncTimestamp with latest server timestamp
                if (serverTimestamp) {
                    this.lastSyncTimestamp = Math.max(
                        this.lastSyncTimestamp || 0,
                        serverTimestamp
                    );
                }

                const existingIndex = this.events.findIndex(e => e.name === doc.id);
                
                if (existingIndex >= 0) {
                    const localEvent = this.events[existingIndex];
                    
                    // Detect conflict:
                    // 1. Server has newer changes than what we last synced (serverTimestamp > localEvent.remoteTimestamp)
                    // 2. We have local changes not yet pushed (localEvent.localTimestamp > localEvent.remoteTimestamp)
                    if (serverTimestamp > localEvent.remoteTimestamp && 
                        localEvent.localTimestamp > localEvent.remoteTimestamp) {
                        console.warn(`Conflict detected for ${doc.id}:
                                     Server timestamp: ${serverTimestamp}
                                     Local timestamp: ${localEvent.localTimestamp}
                                     Last sync: ${localEvent.remoteTimestamp}`);
                        // For now, we could either:
                        // - Skip the update (keep local changes)
                        // - Take server version
                        // - Implement conflict resolution UI
                        return; // Skip for now
                    }
            
                    // No conflict - server version is newer
                    this.events[existingIndex] = {
                        ...fbEvent,
                        localTimestamp: serverTimestamp,
                        remoteTimestamp: serverTimestamp
                    };
                } else {
                    // New event, no conflict possible
                    this.events.push({
                        ...fbEvent,
                        localTimestamp: serverTimestamp,
                        remoteTimestamp: serverTimestamp
                    });
                }
                updatedCount++;
            });

            if (updatedCount > 0) {
                this.sortEvents();
                this.invalidateCache();
                console.log(`Synced ${updatedCount} events from Firestore`);
            }

            return updatedCount;
        } catch (error) {
            console.error('Error syncing with Firestore:', error);
            throw error;
        }
    }
    async loadEvents(dataFile) {
        try {
            this.currentFile = dataFile;
            const response = await fetch(dataFile);
            if (!response.ok) {
                throw new Error(`Could not load data file: ${dataFile}`);
            }
    
            const data = await response.json();
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
            this.lastSyncTimestamp = baseTimestamp;
    
            // Initialize events with timestamps
            this.events = eventsArray.map(event => {
                return {
                    ...event,
                    localTimestamp: baseTimestamp,
                    remoteTimestamp: null // Will be set when synced with server
                };
            });
            
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

    addEvent(event) {
        const normalizedEvent = this.normalizeEvent({
            ...event,
            isNew: true,  // Mark as new local event
            localTimestamp: Date.now(),
            remoteTimestamp: null  // null indicates never synced
        });

        this.events.push(normalizedEvent);
        this.sortEvents();
        this.invalidateCache();
    }

    sortEvents() {
        this.sortedIndices = this.events
            .map((event, index) => ({
                index,
                time: parseTimeToSortableValue(event.enhanced_time).sortableValue
            }))
            .sort((a, b) => a.time - b.time);
    }
  
    getFilteredEvents(filter = null, searchTerm = '') {
        // Only recalculate if filter criteria changed
        if (filter !== this.currentFilter || 
            searchTerm !== this.searchTerm || 
            !this.cachedFilteredEvents) {
            
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
                    return hasAcceptableConfidence && matchesFilter && matchesSearch;
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