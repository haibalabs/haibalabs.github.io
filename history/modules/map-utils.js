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
export async function showLocationOnMap(locationName, map, markersLayer, geocodeCache) {
  console.log('Showing location:', locationName);

  // Clear existing markers so you can see just the new location
  markersLayer.clearLayers();

  const coords = await getCoordinates(locationName, geocodeCache);
  if (!coords) {
    console.log('Showing location:', locationName);
    return;
  }

  const marker = L.marker(coords).bindPopup(locationName);
  markersLayer.addLayer(marker);

  // Zoom in on this location. Adjust zoom level to your liking.
  map.setView(coords, 6);
}

export function formatLocations(locations) {
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

export function getMapLocation(locations) {
  if (!locations || locations.length === 0) return null;
  
  // Handle new format
  if (typeof locations[0] === 'object') {
      const firstLoc = locations[0];
      
      if (firstLoc.city && firstLoc.city !== "Unknown") {
          if (firstLoc.region && firstLoc.region !== "Unknown" && 
              firstLoc.country && firstLoc.country !== "Unknown") {
              return `${firstLoc.city}, ${firstLoc.region}, ${firstLoc.country}`;
          }
          if (firstLoc.country && firstLoc.country !== "Unknown") {
              return `${firstLoc.city}, ${firstLoc.country}`;
          }
          return firstLoc.city;
      }
      
      if (firstLoc.region && firstLoc.region !== "Unknown" &&
          firstLoc.country && firstLoc.country !== "Unknown") {
          return `${firstLoc.region}, ${firstLoc.country}`;
      }
      
      if (firstLoc.country && firstLoc.country !== "Unknown") {
          return firstLoc.country;
      }
      
      return firstLoc.name || null;
  }
  
  // Handle old format
  return locations[0] ? `${locations[0]}` : null;
}