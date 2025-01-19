// ui-manager.js
import { formatHistoricalDate, parseTimeToSortableValue } from './date-handlers.js';
import { formatLocations, getMapLocation } from './map-utils.js';
import { PROMINENT_LABELS } from './config.js';

export class UIManager {
    constructor(eventManager, panelManager) {
        this.eventManager = eventManager;
        this.panelManager = panelManager;
        this.filtersContainer = document.querySelector('.filters');

        // initial filtering state
        this.currentFilter = null;
        this.currentSearch = '';
        this.filteredCount = 0;

        this.timelineContainer = document.getElementById('timeline-wrapper');
        this.timelineContainer.addEventListener('scroll', () => this.handleScroll());

        // Add virtual scrolling properties
        this.buffer = 5;       // Number of items to render above/below viewport

        this.resetWindow();

        // Add height tracking
        this.eventHeights = new Map(); // Cache for measured heights
        this.totalHeight = 0; // Total scrollable height

        // Add position tracking
        this.positions = new Map(); // Store cumulative positions
                
        // Initial spacing update
        this.updateTimelineSpacing();
        
        // Update spacing on window resize
        window.addEventListener('resize', () => this.updateTimelineSpacing());

        // Setup navigation controls
        this.setupNavigation();        

        // Add resize handler with debounce
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.needsFullMeasure = true; // Force remeasure
                this.renderEvents(); // Re-render with new measurements
            }, 150); // Debounce resize events
        });
    }

    resetWindow() {
        this.startIndex = 0;
        this.endIndex = 0;
        this.lastScrollPosition = 0;
        this.needsFullMeasure = true;
    }

    handleScroll() {
        const scrollTop = this.timelineContainer.scrollTop;
        const viewportHeight = this.timelineContainer.clientHeight;
        const scrollThreshold = viewportHeight * 0.2; // Update when scrolled 20% of viewport
        
        if (Math.abs(scrollTop - this.lastScrollPosition) > scrollThreshold) {
            this.lastScrollPosition = scrollTop;
            this.updateVisibleRange();
        }
    }

    handleNoResults(contentContainer, placeholder) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.innerHTML = `
            <div class="empty-message">
                <span class="empty-emoji">😕</span>
                <p>No events match the search or filtering criteria</p>
            </div>
        `;
        contentContainer.appendChild(noResultsDiv);
        placeholder.style.height = '0px';
    }

    performInitialMeasurement(filteredEvents, contentContainer) {
        // Render all events first without positioning
        filteredEvents.forEach(event => {
            const eventDiv = this.renderEvent(event);
            contentContainer.appendChild(eventDiv);
        });

        // Schedule measurement and re-render for next frame
        requestAnimationFrame(() => {
            // Measure actual rendered heights
            const renderedEvents = contentContainer.querySelectorAll('.event');
            renderedEvents.forEach((div, index) => {
                const height = div.getBoundingClientRect().height;
                const event = filteredEvents[index];
                this.eventHeights.set(event.name, height);
            });

            this.needsFullMeasure = false;
            this.calculatePositions(filteredEvents);

            this.updateVisibleRange();  // This will calculate correct range

            // Re-render with correct measurements
            this.renderEvents();
        });
    }

    renderEvents() {
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        this.filteredCount = filteredEvents.length;

        const contentContainer = document.getElementById('timeline-content');
        const placeholder = document.getElementById('timeline-placeholder');
    
        // Clear current content
        contentContainer.innerHTML = '';
    
        // no-results handling
        if (filteredEvents.length === 0) {
            this.handleNoResults(contentContainer, placeholder);
            return;
        }
    
        // Schedule measurement and re-render
        if (this.needsFullMeasure) {
            this.performInitialMeasurement(filteredEvents, contentContainer);
            return;
        }
    
        // Normal render with positions
        this.calculatePositions(filteredEvents);
        placeholder.style.height = `${this.totalHeight}px`;
    
        for (let i = this.startIndex; i < this.endIndex; i++) {
            if (i >= filteredEvents.length) break;
            
            const event = filteredEvents[i];
            const sortableTime = parseTimeToSortableValue(event.enhanced_time);
            const eventDiv = this.renderEvent(event, sortableTime);
            
            eventDiv.style.position = 'absolute';
            eventDiv.style.top = `${this.positions.get(i)}px`;
            
            contentContainer.appendChild(eventDiv);
        }
    
        this.updateEventCounts();
        this.updateTimelineSpacing();
    }

    calculatePositions(events) {    
        let currentPosition = 0;
        this.positions.clear();

        events.forEach((event, index) => {
            this.positions.set(index, currentPosition);
            const height = this.eventHeights.get(event.name);
            const totalSpacing = height;
            
            currentPosition += totalSpacing;
        });

        this.totalHeight = currentPosition;
    }

    updateVisibleRange() {
        const scrollTop = this.timelineContainer.scrollTop;
        const viewportHeight = this.timelineContainer.clientHeight;
        const bufferHeight = viewportHeight * 0.5; // 50% of viewport as buffer
        
        // Find visible range using pre-calculated positions
        let startIndex = 0;
        while (startIndex < this.positions.size && 
            this.positions.get(startIndex) < scrollTop - bufferHeight) {
            startIndex++;
        }

        let endIndex = startIndex;
        while (endIndex < this.positions.size && 
            this.positions.get(endIndex) < scrollTop + viewportHeight + bufferHeight) {
            endIndex++;
        }

        this.startIndex = Math.max(0, startIndex - 1);
        this.endIndex = Math.min(this.positions.size, endIndex + 1);
        this.renderEvents();
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
        eventDiv.style.borderLeft = `1px solid ${eventColor}`;

        const confidenceBadge = this.getConfidenceBadge(event);
        const formattedDate = formatHistoricalDate(event.enhanced_time);

        eventDiv.innerHTML = this.getEventHTML(event, formattedDate, confidenceBadge);
        this.addLocationHandler(eventDiv, event);
        this.addWikiHandler(eventDiv, event);

        return eventDiv;
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
                this.currentFilter = label.name === 'all' ? null : label.name;
                this.resetWindow();
                this.renderEvents();
            });

            this.filtersContainer.appendChild(button);
        });
    }

    updateEventCounts() {
        document.getElementById('visibleCount').textContent = this.filteredCount;
        document.getElementById('totalCount').textContent = this.eventManager.getHighMediumCount();    
    }
    
    setupNavigation() {
        // Text search with debounce
        let searchTimeout;
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.currentSearch = e.target.value.toLowerCase();
                this.resetWindow();
                this.renderEvents();
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
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        
        // Find the target index in our data rather than DOM
        const targetIndex = filteredEvents.findIndex(event => 
            parseTimeToSortableValue(event.enhanced_time) >= targetTime
        );

        if (targetIndex !== -1) {
            // Update window to include target event
            this.startIndex = Math.max(0, targetIndex - 1);
            this.endIndex = this.startIndex + 3; // Show a few events
            this.lastScrollPosition = this.positions.get(targetIndex) || 0;
            
            // Render the new window
            this.renderEvents();
            
            // Scroll to the position
            this.timelineContainer.scrollTo({
                top: this.lastScrollPosition,
                behavior: 'smooth'
            });

            document.getElementById('dateInput').value = `${targetYear}`;
        } else {
            // If no later events exist, jump to last event
            const lastIndex = filteredEvents.length - 1;
            if (lastIndex >= 0) {
                this.startIndex = Math.max(0, lastIndex - 2);
                this.endIndex = lastIndex + 1;
                this.lastScrollPosition = this.positions.get(lastIndex) || 0;
                this.needsFullMeasure = true; 
                this.renderEvents();
                
                this.timelineContainer.scrollTo({
                    top: this.lastScrollPosition,
                    behavior: 'smooth'
                });
                
                document.getElementById('dateInput').value = `${targetYear}`;
            }
        }
    }

    jumpToStart() {
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        if (filteredEvents.length > 0) {
            this.startIndex = 0;
            this.endIndex = 3; // Show first few events
            this.lastScrollPosition = 0;
            this.needsFullMeasure = true; 
            this.renderEvents();
            
            this.timelineContainer.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }
    }

    jumpToEnd() {
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        if (filteredEvents.length > 0) {
            const lastIndex = filteredEvents.length - 1;
            this.startIndex = Math.max(0, lastIndex - 2);
            this.endIndex = lastIndex + 1;
            this.lastScrollPosition = this.positions.get(lastIndex) || 0;
            this.needsFullMeasure = true; 
            this.renderEvents();
            
            this.timelineContainer.scrollTo({
                top: this.lastScrollPosition,
                behavior: 'smooth'
            });
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