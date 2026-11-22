// place-search.js
// The place search both event forms use (location-picker.js): places the loaded world events already
// have a point for come first, with their "Place, Country" label (world-labels.js), then Wikidata items
// with coordinates. Picking one gives an event its point on the map. Wikidata's API allows
// cross-origin requests with origin=*.
// Offices, homes and small schools are often missing from Wikidata (Rachid, 2026-11-21), so the author
// can also search OpenStreetMap, or paste coordinates or a map link. Such a place has a point but no
// place_id or Wikidata ID, which nothing downstream requires (history-dp world_overlay.normalize_location).
import { placeLabel } from './world-labels.js';
import { locationText, normalizeLocation, PRECISIONS } from './world-edits.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
// Nominatim's usage policy forbids searching as the author types, so it runs only when asked; it
// allows cross-origin requests.
const NOMINATIM = 'https://nominatim.openstreetmap.org';

// Lower case without accents, for matching typed text ("asuncion" finds Asunción).
export const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * One entry per place the events have a point for, keyed by place_id, with how many events use it.
 *
 * @param {object[]} events
 * @returns {{ location: object, label: string, subtitle: string, count: number, source: 'local' }[]}
 */
export function localPlaces(events) {
    const byPlace = new Map();
    for (const event of events) {
        if (event.personal) continue;
        for (const raw of event.locations ?? []) {
            if (!raw?.place_id) continue;
            const found = byPlace.get(raw.place_id);
            if (found) {
                found.count++;
                continue;
            }
            const location = normalizeLocation(raw);
            if (!location?.point) continue;
            const label = placeLabel(raw) || locationText(location);
            byPlace.set(raw.place_id, { location, label, subtitle: location.precision ?? '', count: 1, source: 'local' });
        }
    }
    return [...byPlace.values()];
}

/**
 * The local places matching typed text: a label starting with it first, then one with a word starting
 * with it, each by how many events use the place.
 */
export function matchPlaces(places, text, limit = 5) {
    const query = fold(text);
    if (query.length < 2) return [];
    const scored = [];
    for (const place of places) {
        const label = fold(place.label);
        const rank = label.startsWith(query) ? 0 : label.split(/[\s,()-]+/).some(word => word.startsWith(query)) ? 1 : -1;
        if (rank >= 0) scored.push([rank, place]);
    }
    scored.sort((a, b) => a[0] - b[0] || b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));
    return scored.slice(0, limit).map(([, place]) => place);
}

/**
 * What a Wikidata description says the item is, as a point's precision: a city or village is a
 * settlement, a province or state a region, a country a country, anything else (a stadium, a
 * battlefield) a site.
 */
export function precisionFromDescription(description) {
    const text = fold(description);
    // "country in Central Europe", "sovereign state in …"; a "city in a country" names a city
    if (/^(country|sovereign state)\b/.test(text)) return 'country';
    if (/\b(city|town|village|municipality|commune|capital|hamlet|settlement|borough|comune)\b/.test(text)) return 'settlement';
    if (/\b(province|state of|region|county|prefecture|oblast|governorate|department|canton|district)\b/.test(text)) return 'region';
    return PRECISIONS[0];
}

const claimValue = (entity, property) => entity?.claims?.[property]?.find(claim => claim.rank !== 'deprecated')?.mainsnak?.datavalue?.value;

/**
 * Wikidata items matching typed text that have coordinates, with their country.
 *
 * @param {string} text
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ location: object, label: string, subtitle: string, source: 'wikidata' }[]>} empty when Wikidata can't be reached
 */
export async function searchWikidata(text, fetchImpl = fetch) {
    const query = String(text ?? '').trim();
    if (query.length < 2) return [];
    try {
        const search = await (await fetchImpl(`${WIKIDATA_API}?action=wbsearchentities&format=json&origin=*&language=en&uselang=en&type=item&limit=7&search=${encodeURIComponent(query)}`)).json();
        const ids = (search.search ?? []).map(item => item.id);
        if (!ids.length) return [];
        const items = (await (await fetchImpl(`${WIKIDATA_API}?action=wbgetentities&format=json&origin=*&languages=en&props=labels|descriptions|claims&ids=${ids.join('|')}`)).json()).entities ?? {};
        const countryIds = [...new Set(ids.map(id => claimValue(items[id], 'P17')?.id).filter(Boolean))];
        const countries = countryIds.length
            ? (await (await fetchImpl(`${WIKIDATA_API}?action=wbgetentities&format=json&origin=*&languages=en&props=labels&ids=${countryIds.join('|')}`)).json()).entities ?? {}
            : {};
        const results = [];
        for (const id of ids) {
            const item = items[id];
            const coordinates = claimValue(item, 'P625');
            if (!coordinates || (coordinates.globe && !coordinates.globe.endsWith('/Q2'))) continue;
            const name = item.labels?.en?.value ?? id;
            const description = item.descriptions?.en?.value ?? '';
            const countryId = claimValue(item, 'P17')?.id;
            const country = countryId === id ? '' : countries[countryId]?.labels?.en?.value ?? '';
            const precision = countryId === id ? 'country' : precisionFromDescription(description);
            const location = normalizeLocation({ name, country, point: [coordinates.latitude, coordinates.longitude], precision, wikidata: id });
            results.push({ location, label: locationText(location), subtitle: description, source: 'wikidata' });
        }
        return results;
    } catch {
        return [];
    }
}

// What an OpenStreetMap result is (Nominatim's addresstype), as a point's precision; anything else
// (a building, an address, a park) is a site.
const OSM_PRECISION = {
    country: 'country',
    state: 'region', province: 'region', region: 'region', state_district: 'region', county: 'region',
    city: 'settlement', town: 'settlement', village: 'settlement', hamlet: 'settlement', municipality: 'settlement',
    borough: 'settlement', city_district: 'settlement', suburb: 'settlement', quarter: 'settlement', neighbourhood: 'settlement',
};
// a bus stop named after the school next to it would be listed ahead of the school
const TRANSIT_STOPS = new Set(['bus_stop', 'platform', 'stop', 'stop_position', 'tram_stop']);

const osmCity = (address) => address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality ?? '';

/**
 * A Nominatim result as a location: its name, then its city when it is a site, its region when it is a
 * settlement, and its country.
 */
export function osmLocation(result) {
    const address = result?.address ?? {};
    const precision = OSM_PRECISION[result?.addresstype] ?? PRECISIONS[0];
    const name = result?.name || [address.house_number, address.road].filter(Boolean).join(' ') || String(result?.display_name ?? '').split(',')[0];
    return normalizeLocation({
        name,
        city: precision === 'site' ? osmCity(address) : '',
        region: precision === 'settlement' ? address.state ?? '' : '',
        country: precision === 'country' ? '' : address.country ?? '',
        point: [Number(result?.lat), Number(result?.lon)],
        precision,
    });
}

/**
 * OpenStreetMap places and addresses matching typed text, in English where OpenStreetMap has it.
 *
 * @returns {Promise<{ location: object, label: string, subtitle: string, source: 'osm' }[]>} empty when it can't be reached
 */
export async function searchOpenStreetMap(text, fetchImpl = fetch) {
    const query = String(text ?? '').trim();
    if (query.length < 2) return [];
    try {
        const results = await (await fetchImpl(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&accept-language=en&limit=7&q=${encodeURIComponent(query)}`)).json();
        return (Array.isArray(results) ? results : []).filter(result => !TRANSIT_STOPS.has(result.type)).flatMap(result => {
            const location = osmLocation(result);
            return location?.point ? [{ location, label: locationText(location), subtitle: result.display_name ?? '', source: 'osm' }] : [];
        });
    } catch {
        return [];
    }
}

/**
 * The named feature, city, region and country at a point, to fill in a pasted point's text fields;
 * null when OpenStreetMap can't be reached or has nothing there.
 */
export async function reverseOpenStreetMap([lat, lon], fetchImpl = fetch) {
    try {
        const result = await (await fetchImpl(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&accept-language=en&zoom=18&lat=${lat}&lon=${lon}`)).json();
        if (!result || result.error) return null;
        const address = result.address ?? {};
        return { name: result.name ?? '', city: osmCity(address), region: address.state ?? '', country: address.country ?? '' };
    } catch {
        return null;
    }
}

// --- pasted coordinates and map links ---

const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`;
// one coordinate: decimal degrees, or degrees, minutes and seconds, with a hemisphere letter before or after
const COORDINATE = String.raw`([NSEW])?\s*${NUMBER}\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'\s*)?(?:(\d+(?:\.\d+)?)\s*"\s*)?([NSEW])?`;
const COORDINATE_PAIR = new RegExp(String.raw`^\s*${COORDINATE}\s*(?:[,;]\s*|\s+)${COORDINATE}\s*$`, 'i');
const SHORT_MAP_LINK = /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\/p)\//i;

function coordinateValue([before, degrees, minutes, seconds, after]) {
    const letter = (before ?? after ?? '').toUpperCase();
    const value = Math.abs(Number(degrees)) + Number(minutes ?? 0) / 60 + Number(seconds ?? 0) / 3600;
    return { letter, value: degrees.startsWith('-') || letter === 'S' || letter === 'W' ? -value : value };
}

const pointIfValid = (lat, lon) => (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null);

/** "31.6296, -8.0506", "31.6296 N 8.0506 W" or Google's 31°37'46.6"N 8°03'02.2"W as [lat, lon]; null for anything else. */
export function parseCoordinates(text) {
    const value = String(text ?? '').replace(/[″“”]/g, '"').replace(/[′’]/g, "'");
    // two plain numbers ("1 2") are more likely the start of a name than a point
    if (!/[.°'"]/.test(value)) return null;
    const match = COORDINATE_PAIR.exec(value);
    if (!match) return null;
    let first = coordinateValue(match.slice(1, 6));
    let second = coordinateValue(match.slice(6, 11));
    if ('EW'.includes(first.letter || '-') && 'NS'.includes(second.letter || '-')) [first, second] = [second, first];
    if ((first.letter && !'NS'.includes(first.letter)) || (second.letter && !'EW'.includes(second.letter))) return null;
    return pointIfValid(first.value, second.value);
}

// a "lat,lon" query value, as Google, Apple and Bing links carry it
const pointFromParam = (value) => {
    const match = new RegExp(String.raw`^\s*${NUMBER}\s*,\s*${NUMBER}\s*$`).exec(value ?? '');
    return match ? pointIfValid(Number(match[1]), Number(match[2])) : null;
};

/**
 * The point a map link shows (Google Maps, OpenStreetMap, Apple Maps), and the place's name when the
 * link carries one. A Google place link's pin (!3d…!4d…) wins over where its view is centred (@…).
 *
 * @returns {{ point: number[], name: string }|null}
 */
export function parseMapLink(text) {
    let url;
    let href;
    let name = '';
    try {
        url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        href = decodeURIComponent(url.href);
        const place = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
        if (place) name = decodeURIComponent(place[1].replace(/\+/g, ' ')).trim();
    } catch {
        return null;
    }
    if (!/\./.test(url.hostname)) return null;
    if (parseCoordinates(name) || pointFromParam(name)) name = '';
    const pin = new RegExp(String.raw`!3d${NUMBER}!4d${NUMBER}`).exec(href);
    const view = new RegExp(String.raw`/@${NUMBER},${NUMBER}`).exec(href);
    const osmMap = new RegExp(String.raw`map=\d+(?:\.\d+)?/${NUMBER}/${NUMBER}`).exec(url.hash);
    const params = url.searchParams;
    const point = (pin && pointIfValid(Number(pin[1]), Number(pin[2])))
        || pointIfValid(Number(params.get('mlat') ?? NaN), Number(params.get('mlon') ?? NaN))
        || ['q', 'query', 'll', 'sll', 'center', 'destination', 'daddr', 'cp'].map(key => pointFromParam(params.get(key)?.replace('~', ','))).find(Boolean)
        || (view && pointIfValid(Number(view[1]), Number(view[2])))
        || (osmMap && pointIfValid(Number(osmMap[1]), Number(osmMap[2])));
    if (!point) return null;
    if (!name && params.get('q') && !pointFromParam(params.get('q'))) name = params.get('q').trim();
    return { point, name };
}

/**
 * What typed text says when it is a point rather than a name: pasted coordinates or a map link, with
 * the place's name if the link has one; `short` for a shortened link (maps.app.goo.gl), which a
 * browser page can't follow; null for anything else.
 *
 * @returns {{ point: number[], name: string }|{ short: true }|null}
 */
export function pastedPoint(text) {
    const value = String(text ?? '').trim();
    if (SHORT_MAP_LINK.test(value)) return { short: true };
    const point = parseCoordinates(value);
    if (point) return { point, name: '' };
    return /^(https?:\/\/|www\.)|\/maps|openstreetmap\.org/i.test(value) ? parseMapLink(value) : null;
}

/**
 * The search both forms run as the author types: the loaded events' places, then Wikidata, without
 * the Wikidata items that are already listed; OpenStreetMap when the author asks for it.
 */
export class PlaceSearch {
    /**
     * @param {() => object[]} events - the loaded events, read when the first search runs
     * @param {{ wikidata?: typeof searchWikidata, openStreetMap?: typeof searchOpenStreetMap,
     *     reverse?: typeof reverseOpenStreetMap }} [options]
     */
    constructor(events, { wikidata = searchWikidata, openStreetMap = searchOpenStreetMap, reverse = reverseOpenStreetMap } = {}) {
        this.events = events;
        this.wikidata = wikidata;
        this.openStreetMap = openStreetMap;
        this.reverse = reverse;
        this.places = null;
    }

    local(text) {
        this.places ??= localPlaces(this.events());
        return matchPlaces(this.places, text);
    }

    // Called when the world events reload, so the next search sees their places.
    reset() {
        this.places = null;
    }

    async remote(text, local = []) {
        const seen = new Set(local.map(place => fold(place.label)));
        return (await this.wikidata(text)).filter(place => !seen.has(fold(place.label))).slice(0, 5);
    }

    /** OpenStreetMap's matches, without the places already listed or listed twice. */
    async osm(text, listed = []) {
        const seen = new Set(listed.map(place => fold(place.label)));
        return (await this.openStreetMap(text)).filter(place => {
            const label = fold(place.label);
            if (seen.has(label)) return false;
            seen.add(label);
            return true;
        }).slice(0, 5);
    }
}
