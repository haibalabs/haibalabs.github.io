/**
 * Version number follows semantic versioning (MAJOR.MINOR.PATCH)
 * Update policy:
 * - MAJOR: Breaking changes (incompatible data structure changes, API changes)
 * - MINOR: New features (backwards-compatible additions)
 * - PATCH: Bug fixes and minor improvements (backwards-compatible)
 * @type {string}
 */
const VERSION = '0.2.2';

import { parseTimeToSortableValue, formatHistoricalDate, extractYear } from './date-handlers.js';
import { initMap, showLocationOnMap, getCoordinates } from './map-utils.js';

// Define prominent labels and their associated colors
const prominentLabels = [
    { name: "all", color: "gray" },
    { name: "art", color: "#4CAF50" },     // Green
    { name: "science", color: "#2196F3" },  // Blue
    { name: "politics", color: "#795548" }, // Brown
    { name: "war", color: "#F44336" },      // Red
    { name: "religion", color: "#9C27B0" }, // Purple
    { name: "culture", color: "#FF9800" },  // Orange
    { name: "exploration", color: "#009688" } // Teal
];

// Global variable to store total count of high/medium confidence events
let totalHighMediumCount = 0;

// Add toast function
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Remove the toast after animation
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

/**
 * Sort events by time and return a sorted index + time array.
 * @param {Array} events - The array of event objects.
 * @returns {Array} - Sorted array of { index, time } objects.
 */
function sortEventsByTime(events) {
    const sortedIndices = events
        .map((event, index) => ({
            index,
            time: parseTimeToSortableValue(event.enhanced_time) // Parse time to sortable value
        }))
        .sort((a, b) => a.time - b.time); // Sort by numeric time value

    return sortedIndices;
}

/**
 * Format locations for display, handling both old and new format
 * @param {Array} locations - Array of locations (either strings or objects)
 * @returns {string} - Formatted location string
 */
function formatLocations(locations) {
    if (!locations || locations.length === 0) return "";
    
    // Handle new format (array of location objects)
    if (typeof locations[0] === 'object') {
        return locations.map(loc => {
            // Use the full name if available, otherwise build from components
            if (loc.name) {
                return loc.name;
            }
            // Build from components if name is not available
            const parts = [];
            if (loc.city && loc.city !== "Unknown") parts.push(loc.city);
            if (loc.region && loc.region !== "Unknown") parts.push(loc.region);
            if (loc.country && loc.country !== "Unknown") parts.push(loc.country);
            return parts.join(", ");
        }).join("; ");
    }
    
    // Handle old format (array of strings)
    return locations.join(", ");
}

/**
 * Get location for map display, including full hierarchy for better geocoding
 * @param {Array} locations - Array of locations (either strings or objects)
 * @returns {string} - Location string for geocoding
 */
function getMapLocation(locations) {
    if (!locations || locations.length === 0) return null;
    
    // Handle new format
    if (typeof locations[0] === 'object') {
        const firstLoc = locations[0];
        // Always try to include full hierarchy for better geocoding
        const parts = [];
        
        if (firstLoc.city && firstLoc.city !== "Unknown") {
            if (firstLoc.region && firstLoc.region !== "Unknown" && 
                firstLoc.country && firstLoc.country !== "Unknown") {
                // Full hierarchy available
                return `${firstLoc.city}, ${firstLoc.region}, ${firstLoc.country}`;
            }
            // Partial hierarchy
            if (firstLoc.country && firstLoc.country !== "Unknown") {
                return `${firstLoc.city}, ${firstLoc.country}`;
            }
            // Just city
            return firstLoc.city;
        }
        
        // If no city, try region + country
        if (firstLoc.region && firstLoc.region !== "Unknown" &&
            firstLoc.country && firstLoc.country !== "Unknown") {
            return `${firstLoc.region}, ${firstLoc.country}`;
        }
        
        // Fallback to country
        if (firstLoc.country && firstLoc.country !== "Unknown") {
            return firstLoc.country;
        }
        
        // Last resort: use name field if everything else is unknown
        return firstLoc.name || null;
    }
    
    // Handle old format
    return locations[0] ? `${locations[0]}` : null;
}

function setupNavigation() {
    const searchInput = document.getElementById('searchInput');
    const dateInput = document.getElementById('dateInput');
    const jumpStart = document.getElementById('jumpStart');
    const jumpEnd = document.getElementById('jumpEnd');

    // Text search
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const searchTerm = e.target.value.toLowerCase();
            filterEvents(searchTerm);
        }, 300); // Debounce search for performance
    });

    // Date navigation
    dateInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            jumpToDate(dateInput.value);
        }
    });

    // Navigation buttons
    jumpStart.addEventListener('click', () => {
        const firstEvent = document.querySelector('.event');
        const headerHeight = document.querySelector('.header').offsetHeight;
        if (firstEvent) {
            const elementPosition = firstEvent.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    });

    jumpEnd.addEventListener('click', () => {
        const lastEvent = document.querySelector('.event:last-child');
        const headerHeight = document.querySelector('.header').offsetHeight;
        if (lastEvent) {
            const elementPosition = lastEvent.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    });
}

function handleInfoClick(url) {
    const infoPanel = document.getElementById('info-panel');
    const infoFrame = document.getElementById('info-frame');
    const mapPanel = document.getElementById('map-panel');
    const timelineWrapper = document.querySelector('.timeline-wrapper');
    
    // Load the URL
    infoFrame.src = url;
    
    // Open info panel if not already open
    if (!infoPanel.classList.contains('open')) {
        infoPanel.classList.add('open');
        timelineWrapper.classList.add('panel-open');
    }
    
    // Manage panel layering
    infoPanel.classList.add('top-panel');
    mapPanel.classList.remove('top-panel');
}

async function handleLocationClick(locationSpan, event, mapLocation) {
    try {
        const mapPanel = document.getElementById('map-panel');
        const infoPanel = document.getElementById('info-panel');
        const timelineWrapper = document.querySelector('.timeline-wrapper');
        
        // First ensure map panel is open
        if (!mapPanel.classList.contains('open')) {
            mapPanel.classList.add('open');
            timelineWrapper.classList.add('panel-open');
            // Wait for panel animation to complete
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Manage panel layering
        mapPanel.classList.add('top-panel');
        infoPanel.classList.remove('top-panel');

        const coords = await getCoordinates(mapLocation, geocodeCache);
        if (!coords) {
            // Toast handling...
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = `Location not found: ${mapLocation}`;
            mapPanel.appendChild(toast);
            
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 3000);

            locationSpan.classList.remove('clickable');
            locationSpan.classList.add('disabled');
            locationSpan.style.cursor = 'not-allowed';
            locationSpan.replaceWith(locationSpan.cloneNode(true));
        } else {
            await showLocationOnMap(mapLocation, map, markersLayer, geocodeCache);
        }
    } catch (error) {
        console.error('Error handling location:', error);
    }
}

function updateEventCounts() {
    // Count visible high/medium confidence events
    const visibleCount = document.querySelectorAll('.event:not([style*="display: none"]):is([data-confidence="high"], [data-confidence="medium"])').length;
    
    // Count total high/medium confidence events
    const totalCount = document.querySelectorAll('.event:is([data-confidence="high"], [data-confidence="medium"])').length;
    
    document.getElementById('visibleCount').textContent = visibleCount;
    document.getElementById('totalCount').textContent = totalCount;
}

function filterEvents(searchTerm) {
    const events = document.querySelectorAll('.event');
    let visibleCount = 0;

    events.forEach(event => {
        const text = event.textContent.toLowerCase();
        const isVisible = text.includes(searchTerm);
        event.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
    });

    updateEventCounts();
}

function jumpToDate(targetYear) {
    targetYear = parseInt(targetYear);
    
    if (isNaN(targetYear)) {
        dateInput.value = '';
        return;
    }

    // Convert target year to same format used for sorting
    const targetTime = parseTimeToSortableValue(targetYear.toString());
    const headerHeight = document.querySelector('.header').offsetHeight;

    // Find first event with time >= target
    const events = Array.from(document.querySelectorAll('.event'));
    const targetEvent = events.find(event => 
        parseFloat(event.getAttribute('data-sortable-time')) >= targetTime
    );

    if (targetEvent) {
        const elementPosition = targetEvent.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
        
        window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
        });

        targetEvent.classList.add('highlight');
        setTimeout(() => targetEvent.classList.remove('highlight'), 2000);
        
        // Show feedback using the actual date from the event
        const foundYear = extractYear(parseFloat(targetEvent.getAttribute('data-sortable-time')));
//        dateInput.value = `${targetYear} (showing ${foundYear > 0 ? foundYear + ' AD' : Math.abs(foundYear) + ' BCE'})`;
        dateInput.value = `${targetYear}`;
    } else {
        // Handle case where no later events exist
        const lastEvent = events[events.length - 1];
        if (lastEvent) {
            const elementPosition = lastEvent.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
            
            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });

            const lastYear = extractYear(parseFloat(lastEvent.getAttribute('data-sortable-time')));
//            dateInput.value = `${targetYear} (no later events, showing ${lastYear > 0 ? lastYear + ' AD' : Math.abs(lastYear) + ' BCE'})`;
            dateInput.value = `${targetYear}`;
        }
    }
}

const { map, markersLayer, geocodeCache } = initMap();

function updateTimelineSpacing() {
    const header = document.querySelector('.header');
    const headerHeight = header.offsetHeight;
    document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
}

// Call initially
updateTimelineSpacing();

// Update on window resize
window.addEventListener('resize', updateTimelineSpacing);

// Display version number
document.getElementById('versionNumber').textContent = VERSION;

// Get the file name from the URL (e.g., ?file=custom_events.json)
const params = new URLSearchParams(window.location.search);
const dataFile = params.get('file') || 'events.json'; // Default to 'events.json' if no parameter is provided

// Fetch events from the JSON file and render them
fetch(dataFile)
    .then(response => {
        if (!response.ok) {
            throw new Error(`Could not load data file: ${dataFile}`);
        }
        return response.json();
    })
    .then(events => {
        // by default for now we hide low confidence events
        document.body.classList.add('hide-low-confidence');

        // Calculate total high/medium confidence events once
        totalHighMediumCount = events.filter(e => e.confidence !== 'low').length;

        // Normalize time fields
        events.forEach(event => {
            if (!event.enhanced_time && event.time) {
                event.enhanced_time = event.time;
            }
        });

        const timelineContainer = document.getElementById('timeline');
        const filtersContainer = document.querySelector('.filters');

        // Sort the events by time
        const sortedEventIndices = sortEventsByTime(events);

        // Render Filters
        function renderFilters() {
            filtersContainer.innerHTML = ''; // Clear existing filters
            prominentLabels.forEach(label => {
                const button = document.createElement('button');
                button.className = label.name === 'all' ? 'active' : '';
                button.setAttribute('data-label', label.name);
                button.style.backgroundColor = label.color; // Apply color dynamically
                button.textContent = label.name.charAt(0).toUpperCase() + label.name.slice(1);

                // Add filter functionality
                button.addEventListener('click', () => {
                    document.querySelectorAll('.filters button').forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                    renderEvents(label.name === 'all' ? null : label.name);
                });

                filtersContainer.appendChild(button);
            });
        }

        function renderEvents(filteredLabel = null) {
            timelineContainer.innerHTML = ''; // Clear previous events
            
            sortedEventIndices.forEach(({ index }) => {
                const event = events[index];
                const sortableTime = parseTimeToSortableValue(event.enhanced_time);

                // Filter by label if specified
                if (filteredLabel && filteredLabel !== 'all' && 
                    (!event.categories || !event.categories.includes(filteredLabel))) {
                    return;
                }

                const eventDiv = document.createElement('div');
                eventDiv.className = 'event';
                eventDiv.setAttribute('data-confidence', event.confidence || 'medium');
                eventDiv.setAttribute('data-sortable-time', sortableTime); // Store the sortable value

                // Find the first matching category to determine color
                const primaryLabel = prominentLabels.find(label => 
                    event.categories && event.categories.includes(label.name)
                );
                const eventColor = primaryLabel ? primaryLabel.color : '#ccc';
                eventDiv.style.borderLeft = `5px solid ${eventColor}`;

                // Only show badge for medium confidence, with "uncertain" text
                const confidenceBadge = event.confidence === 'medium' ? 
                    `<span class="confidence-badge confidence-uncertain">uncertain</span>` : 
                    '';

                const formattedDate = formatHistoricalDate(event.enhanced_time);
                eventDiv.innerHTML = `
                    <div class="event-header">
                        ${event.name}
                        ${confidenceBadge}
                    </div>
                    <div class="event-time">
                        <span class="event-date">${formattedDate}</span>
                    </div>
                    <div class="event-description">${event.enhanced_description || event.description}</div>
                `;
            
                // Add location click handler
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
                            console.log('Map location:', mapLocation); // Debug log
                            await handleLocationClick(locationSpan, event, mapLocation);
                        }
                    });

                    timeDiv.appendChild(locationSpan);
                }

                // Add Wikipedia link if available
                if (event.wikipedia_url) {
                    const timeDiv = eventDiv.querySelector('.event-time');
                    const wikiSpan = document.createElement('span');
                    wikiSpan.className = 'wiki-link';
                    wikiSpan.textContent = '📜';
                    wikiSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        handleInfoClick(event.wikipedia_url);
                    });

                    timeDiv.appendChild(wikiSpan);
                }        

                timelineContainer.appendChild(eventDiv);
            });

            // Update the counters after rendering
            updateEventCounts();
        }

        // Update map panel toggle
        document.getElementById('toggle-map').addEventListener('click', () => {
            const mapPanel = document.getElementById('map-panel');
            const infoPanel = document.getElementById('info-panel');
            const timelineWrapper = document.querySelector('.timeline-wrapper');
            const isOpen = mapPanel.classList.contains('open');
            const isTop = mapPanel.classList.contains('top-panel');
            
            if (isOpen && isTop) {
                // Close only if it's on top
                mapPanel.classList.remove('open');
                mapPanel.classList.remove('top-panel');
                if (!infoPanel.classList.contains('open')) {
                    timelineWrapper.classList.remove('panel-open');
                }
            } else if (isOpen && !isTop) {
                // Bring to top if it's open but not on top
                mapPanel.classList.add('top-panel');
                infoPanel.classList.remove('top-panel');
            } else {
                // Open if it's closed
                mapPanel.classList.add('open');
                mapPanel.classList.add('top-panel');
                infoPanel.classList.remove('top-panel');
                timelineWrapper.classList.add('panel-open');
            }
            
            map.invalidateSize();
        });

        // Update info panel toggle
        document.getElementById('toggle-info').addEventListener('click', () => {
            const infoPanel = document.getElementById('info-panel');
            const mapPanel = document.getElementById('map-panel');
            const timelineWrapper = document.querySelector('.timeline-wrapper');
            const isOpen = infoPanel.classList.contains('open');
            const isTop = infoPanel.classList.contains('top-panel');
            
            if (isOpen && isTop) {
                // Close only if it's on top
                infoPanel.classList.remove('open');
                infoPanel.classList.remove('top-panel');
                if (!mapPanel.classList.contains('open')) {
                    timelineWrapper.classList.remove('panel-open');
                }
            } else if (isOpen && !isTop) {
                // Bring to top if it's open but not on top
                infoPanel.classList.add('top-panel');
                mapPanel.classList.remove('top-panel');
            } else {
                // Open if it's closed
                infoPanel.classList.add('open');
                infoPanel.classList.add('top-panel');
                mapPanel.classList.remove('top-panel');
                timelineWrapper.classList.add('panel-open');
                
                // Show help text if iframe is empty
                const infoFrame = document.getElementById('info-frame');
                if (!infoFrame.src) {
                    showInfoPanelHelp();
                }
            }
        });

        // Add this new function to show help text in the info panel
        function showInfoPanelHelp() {
            const infoFrame = document.getElementById('info-frame');
            const helpHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            font-family: 'Roboto', Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background-color: #f8f8f8;
                            color: #666;
                        }
                        .help-message {
                            text-align: center;
                            padding: 2rem;
                            font-size: 1.2rem;
                            line-height: 1.6;
                            max-width: 80%;
                        }
                        .scroll-icon {
                            font-size: 2rem;
                            margin: 1rem 0;
                            display: block;
                        }
                    </style>
                </head>
                <body>
                    <div class="help-message">
                        <span class="scroll-icon">📜</span>
                        <p>Click on an event's scroll icon to view additional historical information.</p>
                    </div>
                </body>
                </html>
            `;
            
            infoFrame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(helpHtml);
        }

        // Initialize
        renderFilters();
        renderEvents();

        // Initialize navigation
        setupNavigation();

        // Update spacing after rendering
        updateTimelineSpacing();
    })
    .catch(error => console.error('Error loading events:', error));
