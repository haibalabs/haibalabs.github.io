// Lab test only: a place's outline looked up live from OpenStreetMap's place search (Nominatim) when
// an event is selected, to show what outlines could look like before the pipeline stores them. Nominatim
// allows one request a second and asks callers to cache, so lookups wait their turn a second apart and
// are kept for the page's life. It searches by name, so a result is used only if it is an area whose
// bounding box holds our point; anything else keeps the ring.
const SEARCH = 'https://nominatim.openstreetmap.org/search';
const cache = new Map();
let queue = Promise.resolve();

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function enqueue(task) {
    const result = queue.then(task);
    queue = result.catch(() => {}).then(() => pause(1100));
    return result;
}

const known = value => (value && value !== 'N/A' ? value : '');

// "Marrakech" + "Morocco" → "Marrakech, Morocco"; a name that already names its country is kept as is.
export function outlineQuery(location) {
    const name = known(location.name);
    const country = known(location.country);
    return country && !name.includes(country) ? `${name}, ${country}` : name;
}

async function search(query, [lat, lon]) {
    const url = new URL(SEARCH);
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', polygon_geojson: 1, polygon_threshold: 0.0005, limit: 5, 'accept-language': 'en' });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    for (const result of await response.json()) {
        if (!/Polygon/.test(result.geojson?.type ?? '')) continue;
        const [south, north, west, east] = result.boundingbox.map(Number);
        if (lat >= south && lat <= north && lon >= west && lon <= east) return { geojson: result.geojson, name: result.name || result.display_name };
    }
    return null;
}

// Resolves to { geojson, name } or null.
export function lookupOutline(query, coordinates) {
    if (!query) return Promise.resolve(null);
    if (!cache.has(query)) {
        cache.set(query, enqueue(() => search(query, coordinates)).catch(error => {
            console.error(`Map lab: outline lookup for "${query}" failed`, error);
            return null;
        }));
    }
    return cache.get(query);
}
