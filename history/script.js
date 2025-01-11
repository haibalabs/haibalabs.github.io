import { parseTimeToSortableValue, formatHistoricalDate } from './date-handlers.js';

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
 * Joins the list of locations into a single string.
 * @param {Array} locations - List of locations.
 * @returns {string} - Comma-separated locations or an empty string.
 */
function formatLocations(locations) {
    if (!locations || locations.length === 0) return "";
    return locations.join(", ");
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
        const foundYear = extractYear(targetEvent.querySelector('.event-time').textContent);
        dateInput.value = `${targetYear} (showing ${foundYear > 0 ? foundYear + ' AD' : Math.abs(foundYear) + ' BCE'})`;
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

            const lastYear = extractYear(lastEvent.querySelector('.event-time').textContent);
            dateInput.value = `${targetYear} (no later events, showing ${lastYear > 0 ? lastYear + ' AD' : Math.abs(lastYear) + ' BCE'})`;
        }
    }
}

// Initialize map with restricted zoom and interaction
let map = L.map('map', {
    minZoom: 1,
    maxZoom: 6,
    zoomControl: false,      // Disable zoom controls
    dragging: false,         // Disable panning
    touchZoom: false,        // Disable touch zoom
    doubleClickZoom: false,  // Disable double click zoom
    scrollWheelZoom: false,  // Disable scroll zoom
    boxZoom: false,          // Disable box zoom
    keyboard: false,         // Disable keyboard navigation
    tap: false              // Disable mobile taps
}).setView([20, 0], 3);     // Center on world view

let markersLayer = L.layerGroup().addTo(map);  // Layer for markers

// Set bounds to prevent unnecessary tile loading
map.setMaxBounds([
    [-90, -180], // Southwest
    [90, 180]    // Northeast
]);

// Create a cache for geocoding results
const geocodeCache = new Map();

// Create primary and fallback tile layers
const primaryTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 6,
    minZoom: 1,
    noWrap: true,
    bounds: map.getBounds(),
    updateWhenIdle: true
});

const fallbackTileLayer = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 6,
    minZoom: 1,
    noWrap: true,
    bounds: map.getBounds(),
    updateWhenIdle: true
});

// Start with primary layer
primaryTileLayer.addTo(map);

// Add error handling
primaryTileLayer.on('tileerror', function(e) {
    console.log('Primary tile server error, switching to fallback');
    map.removeLayer(primaryTileLayer);
    fallbackTileLayer.addTo(map);
});

fallbackTileLayer.on('tileerror', function(e) {
    console.log('Fallback tile server error');
});

// Handle layer loading timeout
let tileTimeout = setTimeout(() => {
    if (!primaryTileLayer.isLoading()) return;
    console.log('Tile loading timeout, switching to fallback');
    map.removeLayer(primaryTileLayer);
    fallbackTileLayer.addTo(map);
}, 5000); // 5 second timeout

primaryTileLayer.on('load', function() {
    clearTimeout(tileTimeout);
});

// Modified geocoding function with caching and rate limiting
async function getCoordinates(locationName) {
    // Check cache first
    if (geocodeCache.has(locationName)) {
        return geocodeCache.get(locationName);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        const params = new URLSearchParams({
            format: 'json',
            q: locationName,
            addressdetails: 1,
            namedetails: 1,
            featuretype: 'city',
            'accept-language': 'en',
            limit: 5  // Get a few results to find the best one
        });

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?${params.toString()}`
        );
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.length > 0) {
            // Sort by importance (higher is better) and pick the most important one
            const bestMatch = data.sort((a, b) => b.importance - a.importance)[0];
            
            const coords = [parseFloat(bestMatch.lat), parseFloat(bestMatch.lon)];
            geocodeCache.set(locationName, coords);
            return coords;
        }
        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

// Modified function to handle location clicks
async function showLocationsOnMap(eventData) {
    const mapPanel = document.getElementById('map-panel');
    if (!mapPanel.classList.contains('open')) {
        mapPanel.classList.add('open');
        document.querySelector('.timeline-wrapper').classList.add('map-open');
        map.invalidateSize();
    }

    markersLayer.clearLayers();
    const bounds = [];
    const locationsProcessed = new Set(); // Track unique locations

    for (const location of eventData.locations) {
        // Skip if we've already processed this location
        if (locationsProcessed.has(location)) continue;
        locationsProcessed.add(location);

        const coords = await getCoordinates(location);
        if (coords) {
            const marker = L.marker(coords)
                .bindPopup(`${eventData.name}<br>${location}`);
            markersLayer.addLayer(marker);
            bounds.push(coords);
        }
    }

    // Fit map to show all markers with some padding
    if (bounds.length === 1) {
        // Single location - zoom closer
        map.setView(bounds[0], 6);  // Use zoom level 6 for single cities
    } else if (bounds.length > 1) {
        // Multiple locations - fit all markers
        map.fitBounds(bounds, { 
            padding: [50, 50],
            maxZoom: 8,
            minZoom: 4
        });
    }
}

function updateTimelineSpacing() {
    const header = document.querySelector('.header');
    const headerHeight = header.offsetHeight;
    document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
}

// Call initially
updateTimelineSpacing();

// Update on window resize
window.addEventListener('resize', updateTimelineSpacing);

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
                    timeDiv.innerHTML += `<span class="event-location clickable">📍 ${locationText}</span>`;
                    
                    const locationSpan = timeDiv.querySelector('.event-location');
                    locationSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showLocationsOnMap(event);
                    });
                }

                timelineContainer.appendChild(eventDiv);
            });

            // Update the counters after rendering
            updateEventCounts();
        }

        // Update map panel toggle to handle the timeline wrapper class
        document.getElementById('toggle-map').addEventListener('click', () => {
            const mapPanel = document.getElementById('map-panel');
            const timelineWrapper = document.querySelector('.timeline-wrapper');
            const isOpen = mapPanel.classList.contains('open');
            
            if (isOpen) {
                mapPanel.classList.remove('open');
                timelineWrapper.classList.remove('map-open');
            } else {
                mapPanel.classList.add('open');
                timelineWrapper.classList.add('map-open');
            }
            
            map.invalidateSize(); // Refresh map size after panel toggle
        });

        // Initialize
        renderFilters();
        renderEvents();

        // Initialize navigation
        setupNavigation();

        // Add confidence toggle functionality - disabled for now
        // document.getElementById('confidenceToggle').addEventListener('change', function(e) {
        //     document.body.classList.toggle('hide-low-confidence', !e.target.checked);
        // });

        // Update spacing after rendering
        updateTimelineSpacing();
    })
    .catch(error => console.error('Error loading events:', error));
