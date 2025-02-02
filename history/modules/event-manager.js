// event-manager.js
import { parseTimeToSortableValue } from './date-handlers.js';

import { initializeApp as firebaseInit } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, query, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js";

export class EventManager {
    constructor(locationVerifier) {
        this.locationVerifier = locationVerifier;
        this.events = [];
        this.sortedIndices = [];
        this.currentFilter = 'all';
        this.searchTerm = '';
        this.cachedFilteredEvents = null;
        this.currentFile = null;

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
            return true;
        } catch (error) {
            console.error('Error saving event:', error);
            throw new Error(`Failed to save event "${event.name}": ${error.message}`);
        }
    }
    
    async pushChanges() {
        let savedCount = 0;
        let errors = [];
    
        for (const event of this.events) {
            try {
                await this.saveEvent(event);
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
    
        return savedCount;
    }

    async pullChanges() {
        try {
            const user = this.auth.currentUser;
            if (!user) {
                throw new Error('User must be authenticated to pull events');
            }

            const eventsRef = collection(this.db, this.getCollectionName());
            const q = query(
                eventsRef,
                where('lastModified', '>', new Date(this.fileTimestamp))
            );

            const snapshot = await getDocs(q);
            let updatedCount = 0;

            snapshot.forEach((doc) => {
                const fbEvent = doc.data();
                const existingIndex = this.events.findIndex(e => e.name === doc.id);
                
                if (existingIndex >= 0) {
                    // Update existing event
                    this.events[existingIndex] = this.normalizeEvent({
                        ...this.events[existingIndex],
                        ...fbEvent
                    });
                } else {
                    // Add new event
                    this.events.push(this.normalizeEvent(fbEvent));
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
    
            const lastModified = response.headers.get('last-modified');
            this.fileTimestamp = lastModified ? new Date(lastModified).getTime() : null;
    
            if (!this.fileTimestamp) {
                const dateHeader = response.headers.get('date');
                this.fileTimestamp = dateHeader ? new Date(dateHeader).getTime() : Date.now();
            }
    
            this.events = await response.json();
            
            // Normalize events with file timestamp
            this.events = this.events.map(event => this.normalizeEvent(event, this.fileTimestamp));
            
            this.sortEvents();
            this.invalidateCache();
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
        this.events.push(this.normalizeEvent(event));
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