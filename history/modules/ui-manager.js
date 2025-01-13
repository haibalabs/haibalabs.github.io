// ui-manager.js
import { formatHistoricalDate, parseTimeToSortableValue } from './date-handlers.js';
import { formatLocations, getMapLocation } from './map-utils.js';
import { PROMINENT_LABELS } from './config.js';

export class UIManager {
    constructor(eventManager, panelManager) {
        this.eventManager = eventManager;
        this.panelManager = panelManager;
        this.timelineContainer = document.getElementById('timeline');
        this.filtersContainer = document.querySelector('.filters');
        
        // Initial spacing update
        this.updateTimelineSpacing();
        
        // Update spacing on window resize
        window.addEventListener('resize', () => this.updateTimelineSpacing());

        // Setup navigation controls
        this.setupNavigation();        
    }

    updateTimelineSpacing() {
        const header = document.querySelector('.header');
        const headerHeight = header.offsetHeight;
        document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    renderEvent(event, sortableTime) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'event';
        eventDiv.setAttribute('data-confidence', event.confidence || 'medium');
        eventDiv.setAttribute('data-sortable-time', sortableTime);

        const primaryLabel = this.getPrimaryLabel(event);
        const eventColor = primaryLabel ? primaryLabel.color : '#ccc';
        eventDiv.style.borderLeft = `5px solid ${eventColor}`;

        const confidenceBadge = this.getConfidenceBadge(event);
        const formattedDate = formatHistoricalDate(event.enhanced_time);

        eventDiv.innerHTML = this.getEventHTML(event, formattedDate, confidenceBadge);
        this.addLocationHandler(eventDiv, event);
        this.addWikiHandler(eventDiv, event);

        return eventDiv;
    }

    renderEvents(filter = null, searchTerm = '') {
        this.timelineContainer.innerHTML = '';
        const filteredEvents = this.eventManager.getFilteredEvents(filter, searchTerm);
        
        if (filteredEvents.length === 0) {
            const noResultsDiv = document.createElement('div');
            noResultsDiv.className = 'no-results';
            noResultsDiv.innerHTML = `
                <div class="empty-message">
                    <span class="empty-emoji">😕</span>
                    <p>No events match the search or filtering criteria</p>
                </div>
            `;
            this.timelineContainer.appendChild(noResultsDiv);
        } else {
            filteredEvents.forEach(event => {
                const sortableTime = parseTimeToSortableValue(event.enhanced_time);
                const eventDiv = this.renderEvent(event, sortableTime);
                this.timelineContainer.appendChild(eventDiv);
            });
        }
    
        this.updateEventCounts();
        this.updateTimelineSpacing();
    }
    
    getPrimaryLabel(event) {
        return PROMINENT_LABELS.find(label => 
            event.categories && event.categories.includes(label.name)
        );
    }

    getConfidenceBadge(event) {
        return event.confidence === 'medium' ? 
            `<span class="confidence-badge confidence-uncertain">uncertain</span>` : 
            '';
    }

    getEventHTML(event, formattedDate, confidenceBadge) {
        return `
            <div class="event-header">
                ${event.name}
                ${confidenceBadge}
            </div>
            <div class="event-time">
                <span class="event-date">${formattedDate}</span>
            </div>
            <div class="event-description">${event.enhanced_description || event.description}</div>
        `;
    }

    addLocationHandler(eventDiv, event) {
        const locationText = formatLocations(event.locations);
        if (locationText) {
            const timeDiv = eventDiv.querySelector('.event-time');
            const locationSpan = document.createElement('span');
            locationSpan.className = 'event-location clickable';
            locationSpan.innerHTML = `⌖ ${locationText}`;

            locationSpan.addEventListener('click', async (e) => {
                e.stopPropagation();
                const mapLocation = getMapLocation(event.locations);
                if (mapLocation) {
                    await this.panelManager.showLocationOnMap(locationSpan, event, mapLocation);
                }
            });

            timeDiv.appendChild(locationSpan);
        }
    }

    addWikiHandler(eventDiv, event) {
        if (event.wikipedia_url) {
            const timeDiv = eventDiv.querySelector('.event-time');
            const wikiSpan = document.createElement('span');
            wikiSpan.className = 'wiki-link';
            wikiSpan.textContent = '📜';
            wikiSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this.panelManager.handleInfoClick(event.wikipedia_url);
            });

            timeDiv.appendChild(wikiSpan);
        }
    }

    renderFilters() {
        this.filtersContainer.innerHTML = ''; // Clear existing filters
        PROMINENT_LABELS.forEach(label => {
            const button = document.createElement('button');
            button.className = label.name === 'all' ? 'active' : '';
            button.setAttribute('data-label', label.name);
            button.style.backgroundColor = label.color;
            button.textContent = label.name.charAt(0).toUpperCase() + label.name.slice(1);

            button.addEventListener('click', () => {
                document.querySelectorAll('.filters button').forEach(btn => 
                    btn.classList.remove('active'));
                button.classList.add('active');
                this.renderEvents(label.name === 'all' ? null : label.name);
            });

            this.filtersContainer.appendChild(button);
        });
    }

    updateEventCounts() {
        const visibleCount = document.querySelectorAll(
            '.event:not([style*="display: none"]):is([data-confidence="high"], [data-confidence="medium"])'
        ).length;
        
        const totalCount = document.querySelectorAll(
            '.event:is([data-confidence="high"], [data-confidence="medium"])'
        ).length;
        
        document.getElementById('visibleCount').textContent = visibleCount;
        document.getElementById('totalCount').textContent = totalCount;
    }
    
    setupNavigation() {
        // Text search with debounce
        let searchTimeout;
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const searchTerm = e.target.value.toLowerCase();
                this.renderEvents(null, searchTerm);
            }, 300);
        });

        // Date navigation
        const dateInput = document.getElementById('dateInput');
        dateInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.jumpToDate(dateInput.value);
            }
        });

        // Navigation buttons
        document.getElementById('jumpStart').addEventListener('click', () => this.jumpToStart());
        document.getElementById('jumpEnd').addEventListener('click', () => this.jumpToEnd());
    }

    jumpToDate(targetYear) {
        targetYear = parseInt(targetYear);
        if (isNaN(targetYear)) {
            document.getElementById('dateInput').value = '';
            return;
        }

        const targetTime = parseTimeToSortableValue(targetYear.toString());
        const events = Array.from(document.querySelectorAll('.event'));
        const targetEvent = events.find(event => 
            parseFloat(event.getAttribute('data-sortable-time')) >= targetTime
        );

        if (targetEvent) {
            this.scrollToEvent(targetEvent);
            this.highlightEvent(targetEvent);
            document.getElementById('dateInput').value = `${targetYear}`;
        } else {
            // If no later events exist, jump to last event
            const lastEvent = events[events.length - 1];
            if (lastEvent) {
                this.scrollToEvent(lastEvent);
                document.getElementById('dateInput').value = `${targetYear}`;
            }
        }
    }

    jumpToStart() {
        const firstEvent = document.querySelector('.event');
        if (firstEvent) {
            this.scrollToEvent(firstEvent);
        }
    }

    jumpToEnd() {
        const lastEvent = document.querySelector('.event:last-child');
        if (lastEvent) {
            this.scrollToEvent(lastEvent);
        }
    }

    scrollToEvent(eventElement) {
        const headerHeight = document.querySelector('.header').offsetHeight;
        const elementPosition = eventElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
        
        window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
        });
    }

    highlightEvent(eventElement) {
        eventElement.classList.add('highlight');
        setTimeout(() => eventElement.classList.remove('highlight'), 2000);
    }
}