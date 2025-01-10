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
 * Formats a historical date with BCE/CE support into "DD Month YYYY" format.
 * Handles removing time components and leading zeroes in years.
 * @param {string} date - The raw ISO 8601 date string.
 * @returns {string} - Formatted date in "DD Month YYYY" or "Unknown Date".
 */
function formatHistoricalDate(date) {
    if (!date) return "Unknown Date";

    // Already formatted dates
    if (date.includes('billion years ago') || 
        date.includes('million years ago') ||
        date.includes('BCE') ||
        date.includes('AD') ||
        date.includes('CE')) {
        return date;
    }

    // If it's just a year (e.g., "1498")
    if (/^\d+$/.test(date)) {
        return date;
    }

    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    // Handle dates with month and day
    // Example: "1534-10-17"
    try {
        const [year, month, day] = date.split("-");
        if (year && month && day) {
            const formattedYear = parseInt(year, 10);
            const formattedMonth = months[parseInt(month, 10) - 1];
            const formattedDay = parseInt(day, 10);
            return `${formattedDay} ${formattedMonth} ${formattedYear}`;
        }
        // If we just have a year and month
        if (year && month) {
            const formattedYear = parseInt(year, 10);
            const formattedMonth = months[parseInt(month, 10) - 1];
            return `${formattedMonth} ${formattedYear}`;
        }
        // If we just have a year
        if (year) {
            return year;
        }
    } catch (error) {
        console.error('Date parsing error:', error);
        return date;  // Return the original date if parsing fails
    }

    return date;  // Return the original if no other format matches
}

/**
 * Parse the event time to a sortable numeric value.
 * - Billion/million years ago converted to large negative numbers
 * - BCE/BC years converted to negative numbers
 * - CE/AD years converted to positive numbers
 * - Handles approximate dates with "c." prefix
 * - Handles dates with locations (e.g., "1969 - Jerusalem")
 * - Year ranges use the starting year
 * @param {string} time - The time string (e.g., "c. 1 BC", "13.8 billion years ago", "1969 - Jerusalem")
 * @returns {number} - The numeric representation of the year for sorting
 */
function parseTimeToSortableValue(time) {
    if (!time) return 0;
    
    // Convert the time to a string for safety
    time = String(time).toLowerCase();

    // is it a simple year number
    let targetYear = parseInt(time);
    
    if (!isNaN(targetYear)) {
        return targetYear;
    }
    
    // Handle full dates (e.g., "September 3, 1967", "March 4, 1961")
    try {
        const date = new Date(time.split('-')[0].trim());  // Split off any location part
        if (!isNaN(date.getTime())) {
            return date.getFullYear() + (date.getMonth() / 12) + (date.getDate() / 365);
        }
    } catch (e) {
        console.log('Date parsing error:', e);
    }
    
    // Handle "billion years ago" format
    if (time.includes('billion years ago')) {
        const billion = parseFloat(time.match(/\d+\.?\d*/)[0]);
        return -1 * billion * 1000000000;
    }
    
    // Handle "million years ago" format
    if (time.includes('million years ago')) {
        const million = parseFloat(time.match(/\d+\.?\d*/)[0]);
        return -1 * million * 1000000;
    }
    
    // Remove any "c." or "circa" prefixes
    time = time.replace(/^c\.\s+/, '').replace(/^circa\s+/, '');
    
    // Handle BC/BCE dates
    if (time.includes('bc') || time.includes('bce')) {
        let year = parseInt(time.match(/\d+/)[0]);
        return -1 * year;
    }
    
    // Handle AD/CE dates
    if (time.includes('ad') || time.includes('ce')) {
        let year = parseInt(time.match(/\d+/)[0]);
        return year;
    }
    
    // If it's just a year (e.g., "1969"), parse it directly
    const yearMatch = time.match(/\d+/);
    if (yearMatch) {
        return parseInt(yearMatch[0]);
    }
    
    return 0;
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
/*
// Add tile layer with caching
const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 5,
    minZoom: 3,
    noWrap: true,           // Prevent tile wrapping around the world
    bounds: map.getBounds(), // Only load tiles within bounds
    updateWhenIdle: true,    // Update tiles only when panning ends
}).addTo(map);
*/
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

// Update click handler in your event creation code
function addLocationClickHandler(eventDiv, eventData) {
    const timeDiv = eventDiv.querySelector('.event-time');
    const locationText = formatLocations(eventData.locations);
    
    if (locationText) {
        const dateText = formatHistoricalDate(eventData.enhanced_time);
        timeDiv.innerHTML = `
            <span class="event-date">${dateText}</span>
            ${locationText ? `<span class="event-location clickable">📍 ${locationText}</span>` : ''}
        `;
        
        const locationSpan = timeDiv.querySelector('.event-location');
        locationSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            showLocationsOnMap(eventData);
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

                const formattedDate = formatHistoricalDate(event.enhanced_time);
                const formattedLocations = formatLocations(event.locations);

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

                eventDiv.innerHTML = `
                    <div class="event-header">
                        ${event.name}
                        ${confidenceBadge}
                    </div>
                    <div class="event-time"></div>
                    <div class="event-description">${event.enhanced_description || event.description}</div>
                `;

                // Add location click handler
                addLocationClickHandler(eventDiv, event);

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
