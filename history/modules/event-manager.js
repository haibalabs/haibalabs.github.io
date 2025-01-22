// event-manager.js
import { parseTimeToSortableValue } from './date-handlers.js';

export class EventManager {
    constructor() {
        this.events = [];
        this.sortedIndices = [];
        this.currentFilter = 'all';
        this.searchTerm = '';
        this.cachedFilteredEvents = null;
    }

    async loadEvents(dataFile) {
        try {
            const response = await fetch(dataFile);
            if (!response.ok) {
                throw new Error(`Could not load data file: ${dataFile}`);
            }
            this.events = await response.json();
            this.normalizeEvents();
            this.sortEvents();
            this.cachedFilteredEvents = null; // Invalidate cache after loading new data
            return this.events;
        } catch (error) {
            console.error('Error loading events:', error);
            throw error;
        }
    }

    normalizeEvents() {
        this.events.forEach(event => {
            if (!event.enhanced_time && event.time) {
                event.enhanced_time = event.time;
            }
        });
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