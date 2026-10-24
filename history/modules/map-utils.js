let initialized = false;

/**
 * Initialize the map with some optional constraints (minZoom, maxZoom, etc.).
 * Returns an object with { map, markersLayer, geocodeCache } for reuse.
 */
export function initMap() {
  if (initialized) {
    throw new Error('Map is already initialized.');
  }

  // Create map instance
  const map = L.map('map', {
    // Adjust minZoom, maxZoom, etc. if you want to see if that’s affecting your tiles
    minZoom: 2,
    maxZoom: 7,
    center: [20, 0],
    zoom: 3,
  });

  // Add a basic tile layer (primary)
  const primaryTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  // Optional: a fallback layer if primary fails
  const fallbackTileLayer = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  });

  primaryTileLayer.on('tileerror', () => {
    console.log('Primary tile server error, switching to fallback');
    map.removeLayer(primaryTileLayer);
    fallbackTileLayer.addTo(map);
  });

  // Initialize marker layer
  const markersLayer = L.layerGroup().addTo(map);

  document.querySelector('.leaflet-control-zoom-in').innerHTML = '<i class="fa-light fa-plus"></i>';
  document.querySelector('.leaflet-control-zoom-out').innerHTML = '<i class="fa-light fa-minus"></i>';

  // Simple map bounds—adjust or remove to test bounding issues:
  map.setMaxBounds([
    [-90, -180],
    [90, 180]
  ]);

  // A cache to avoid repeated geocoding
  const geocodeCache = new Map();

  initialized = true;
  return { map, markersLayer, geocodeCache };
}

/**
 * Geocode a location using the Nominatim API. Uses a simple rate-limit trick.
 */
export async function getCoordinates(locationName, geocodeCache) {
  if (Array.isArray(locationName)) {
      return isValidCoordinates(locationName) ? locationName : null;
  }
  // Return from cache if available
  if (geocodeCache.has(locationName)) {
      return geocodeCache.get(locationName);
  }

  // If location is marked as unknown in cache
  if (geocodeCache.has(`unknown:${locationName}`)) {
      return null;
  }

  try {
      const params = new URLSearchParams({
          format: 'json',
          q: locationName,
          limit: 5,
          'accept-language': 'en'
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data && data.length > 0) {
          // Sort by importance
          data.sort((a, b) => b.importance - a.importance);
          const best = data[0];
          const coords = [parseFloat(best.lat), parseFloat(best.lon)];
          geocodeCache.set(locationName, coords);
          return coords;
      }
      // Cache unknown locations to prevent repeated lookups
      geocodeCache.set(`unknown:${locationName}`, null);
      return null;
  } catch (error) {
      console.error('Geocoding error:', error);
      return null;
  }
}

/**
 * Show a location on the map by geocoding and placing a marker.
 */
export async function showLocationOnMap(locationName, map, markersLayer, geocodeCache, name) {
  // a text node, so Leaflet never parses the event name as HTML
  const text = document.createTextNode(name ?? '');
  // Clear existing markers so you can see just the new location
  markersLayer.clearLayers();

  // Handle coordinate arrays directly
  if (Array.isArray(locationName)) {
    const marker = L.marker(locationName).bindTooltip(text, { permanent: true, direction: 'right' });
    markersLayer.addLayer(marker);
    map.setView(locationName, 6);
    return;
  }

  const coords = await getCoordinates(locationName, geocodeCache);
  if (!coords) {
    console.log('Location not found:', locationName);
    return;
  }

  const marker = L.marker(coords).bindTooltip(text, { permanent: true, direction: 'right' });
  markersLayer.addLayer(marker);

  // Force map update before changing view
  map.invalidateSize({
      animate: true,
      pan: false
  });

  // Small delay before setting view
  await new Promise(resolve => setTimeout(resolve, 50));  

  // Zoom in on this location. Adjust zoom level to your liking.
  map.setView(coords, 6, {
    animate: true,
    duration: 1
  });
}

export function getLocationKey(location) {
  if (typeof location !== 'object') return String(location);

  const parts = new Set();
  
  // Add name first if it exists
  if (location.name) parts.add(location.name);

  // Add components only if they're not already part of the name
  ['city', 'region', 'country'].forEach(field => {
    const value = location[field];
    if (!value || value.toLowerCase().includes('various') || ['unknown', 'n/a'].includes(value.trim().toLowerCase())) return;
    
    // Check if this component is already included in any existing part
    if ([...parts].every(part => !part.toLowerCase().includes(value.toLowerCase()))) {
      parts.add(value);
    }
  });

  return [...parts].join(", ");
}

export function formatLocations(locations) {
  if (!locations || locations.length === 0) 
    return "";
  if (locations[0].name) 
    return locations[0].name;
  return getLocationKey(locations[0]);
//  return locations.map(loc => getLocationKey(loc)).join("; ");
}

export function getMapLocation(locations) {
  if (!locations || locations.length === 0) return null;
  const location = locations[0];
  
  // Return coordinates array if available
  if (isValidCoordinates(location.corrected)) {
    return location.corrected;
  }

  if (isValidCoordinates(location.geography?.coordinates)) {
    return location.geography.coordinates;
  }
  
  // Otherwise return string location
  return location.corrected || getLocationKey(location);
}

export function isValidCoordinates(value) {
  return Array.isArray(value) && value.length === 2 &&
    value.every(Number.isFinite) && Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180;
}

export class LocationVerifier {
  constructor() {
      this.locationMappings = new Map();
      this.isInitialized = false;
  }

  async loadUnverifiedLocations(file) {
    try {
      const response = await fetch(file);
      if (!response.ok) {
        console.warn('Unverified locations file not found - treating all locations as verified');
        return;
      }

      const data = await response.json();
      
      data.forEach(loc => {
          this.locationMappings.set(loc.standardized_location, {
              corrected: loc.corrected_location || null
          });
      });
      this.isInitialized = true;
    } catch (error) {
      console.error('Error loading unverified locations:', error);
    }
  }

  verifyEventLocation(event) {
      if (!event.locations || !event.locations.length || !this.isInitialized) 
        return;

      event.locations = event.locations.map(raw => {
          const location = typeof raw === 'string' ? { name: raw } : { ...raw };
          const mapping = this.locationMappings.get(getLocationKey(location)) ||
              this.locationMappings.get(location.name);
          const corrected = mapping?.corrected || location.corrected || null;
          // A new manual override invalidates coordinates from an older snapshot.
          if (corrected && JSON.stringify(corrected) !== JSON.stringify(location.geography?.correction)) {
              if (location.geography) {
                  location.geography = { ...location.geography, status: 'corrected',
                      coordinates: isValidCoordinates(corrected) ? corrected : null,
                      correction: corrected, precision: 'unknown' };
              }
          }
          return { ...location,
              verified: location.geography ? location.geography.status === 'corrected' : Boolean(!mapping) || Boolean(corrected),
              corrected };
      });
  }
}
