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

async function loadWikipediaContent(title) {
    const api = 'https://en.wikipedia.org/w/api.php';
    const params = new URLSearchParams({
        action: 'parse',  // Use parse instead of query
        page: decodeURIComponent(title),
        format: 'json',
        prop: 'text|sections',  // Get both text and section structure
        redirects: 1,
        origin: '*'
    });

    const response = await fetch(`${api}?${params}`);
    const data = await response.json();
    
    // The content will be in data.parse.text['*']
    let content = data.parse.text['*'];
    
    // Replace relative image URLs with absolute ones
    content = content.replace(/src="\/\//g, 'src="https://');
    content = content.replace(/srcset="\/\//g, 'srcset="https://');
    
    // Replace any src="/..." that doesn't start with a second slash
    content = content.replace(/src="\/(?!\/)/g, 'src="https://en.wikipedia.org/');
    content = content.replace(/srcset="\/(?!\/)/g, 'srcset="https://en.wikipedia.org/');

    // Handle wiki-relative URLs
    content = content.replace(/href="\/wiki\//g, 'href="https://wikipedia.org/wiki/');

    return {
        title: data.parse.title,
        content: content,
        sections: data.parse.sections
    };
}

async function handleInfoClick(url) {
    // Extract the title from Wikipedia URL
    const title = url.split('/wiki/')[1];
    console.log('Wikipedia title:', title);  // Debug title
    
    const infoPanel = document.getElementById('info-panel');
    const infoFrame = document.getElementById('info-frame');
    const mapPanel = document.getElementById('map-panel');
    const timelineWrapper = document.querySelector('.timeline-wrapper');
    
    try {
        // Fetch content while showing loading state
        showInfoPanelLoading();
        const content = await loadWikipediaContent(title);
        console.log('Processed content:', content);  // Debug processed content
        
        // Create clean HTML with just the content we want
        const cleanContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: 'Roboto', Arial, sans-serif;
                    line-height: 1.6;
                    padding: 2rem;
                    max-width: 800px;
                    margin: 0 auto;
                    color: #333;
                }
                h1 { 
                    font-family: 'EB Garamond', serif;
                    color: #2c1810;
                    margin-bottom: 1rem;
                    font-size: 2em;
                }
                h2, h3, h4 {
                    font-family: 'EB Garamond', serif;
                    color: #433630;
                    margin-top: 1.5rem;
                    margin-bottom: 1rem;
                }
                .mw-parser-output > p {
                    margin: 1em 0;
                }
                /* Hide edit links and other wiki UI elements */
                .mw-editsection,
                .navigation-not-searchable,
                .metadata,
                .reference,
                .reflist,
                .navbox {
                    display: none;
                }
                /* Style lists */
                .mw-parser-output ul {
                    list-style-type: disc;
                    margin: 1em 0;
                    padding-left: 2em;
                }
                .mw-parser-output li {
                    margin: 0.5em 0;
                }
                /* Indent subsections */
                .mw-parser-output h3 {
                    margin-left: 1em;
                }
                .mw-parser-output h4 {
                    margin-left: 2em;
                }
                .wiki-link {
                    color: #2196F3;
                    text-decoration: none;
                    display: inline-block;
                    margin-top: 2rem;
                    padding: 0.5rem 1rem;
                    border: 1px solid #2196F3;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                }
                .wiki-link:hover {
                    background: #2196F3;
                    color: white;
                }
            /* Additional style to ensure images display properly */
            .mw-parser-output img {
                max-width: 100%;
                height: auto;
                display: block;
                margin: 1em auto;
            }

            /* hide any other Wikipedia UI elements we don't want */
            .nomobile,
            .side-box,
            .infobox,
            .gallery,
            .stack.mw-stack.stack-clear-right,
            .mw-stack,
            .sidebar-pretitle,
            .metadata,
            .navbox,
            .shortdescription,
            .mw-editsection,
            .reference,
            .reflist,
            .refbegin,
            .navigation-not-searchable {
                display: none !important;
            }
            /* Hide specific sections including their headers and content */
            h2#Notes,
            h2#References,
            h2#See_also,
            h2#External_links,
            h2#Sources,
            h3#Citations,
            h3#Further_reading,
            #Notes ~ *,
            #References ~ *,
            #See_also ~ *,
            #External_links ~ *,
            #Sources ~ * {
                display: none !important;
            }

            /* Also hide the heading spans */
            h2[id^="Notes"],
            h2[id^="References"],
            h2[id^="See_also"],
            h2[id^="External_links"],
            h3[id^="Citations"],
            h3[id^="Further_reading"],
            h2[id^="Sources"] {
                display: none !important;
            }
            </style>
        </head>
        <body>
            <h1>${content.title}</h1>
            <div class="mw-parser-output">
                ${content.content}
            </div>
            <a class="wiki-link" href="${url}" target="_blank">
                View on Wikipedia ↗
            </a>
        </body>
        </html>
    `;

    //    infoFrame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(cleanContent);
        infoFrame.srcdoc = cleanContent;
    } catch (error) {
        console.error('Error loading Wikipedia content:', error);
        // Show error state
        showInfoPanelError();
    }
    
    // Handle panel display
    if (!infoPanel.classList.contains('open')) {
        infoPanel.classList.add('open');
        timelineWrapper.classList.add('panel-open');
    }
    infoPanel.classList.add('top-panel');
    mapPanel.classList.remove('top-panel');
}

function showInfoPanelLoading() {
    const infoFrame = document.getElementById('info-frame');
    const loadingHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    font-family: 'Roboto', Arial, sans-serif;
                }
                .loader {
                    border: 3px solid #f3f3f3;
                    border-radius: 50%;
                    border-top: 3px solid #2196F3;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <div class="loader"></div>
        </body>
        </html>
    `;
    infoFrame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml);
}

function showInfoPanelError() {
    const infoFrame = document.getElementById('info-frame');
    const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    font-family: 'Roboto', Arial, sans-serif;
                    color: #d32f2f;
                }
            </style>
        </head>
        <body>
            <div>Error loading content. Please try again later.</div>
        </body>
        </html>
    `;
    infoFrame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml);
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
                        <p>Click on an event's scroll 📜 to view additional information.</p>
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
