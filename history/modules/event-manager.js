// event-manager.js
import { parseTimeToSortableValue } from './date-handlers.js';

export class EventManager {
    constructor() {
        this.events = [];
        this.sortedIndices = [];
        this.currentFilter = 'all';
        this.searchTerm = '';
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
                time: parseTimeToSortableValue(event.enhanced_time)
            }))
            .sort((a, b) => a.time - b.time);
    }

    getFilteredEvents(filter = null, searchTerm = '') {
        return this.sortedIndices
            .map(({ index }) => this.events[index])
            .filter(event => {
                const matchesFilter = !filter || filter === 'all' || 
                    (event.categories && event.categories.includes(filter));
                const matchesSearch = !searchTerm || 
                    event.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    event.enhanced_description.toLowerCase().includes(searchTerm.toLowerCase());
                return matchesFilter && matchesSearch;
            });
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