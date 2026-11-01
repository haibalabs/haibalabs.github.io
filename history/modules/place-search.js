// place-search.js
// The place search both event forms use (location-picker.js): places the loaded world events already
// have a point for come first, with their "Place, Country" label (world-labels.js), then Wikidata items
// with coordinates. Picking one gives an event its point on the map. Wikidata's API allows
// cross-origin requests with origin=*.
import { placeLabel } from './world-labels.js';
import { locationText, normalizeLocation, PRECISIONS } from './world-edits.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

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

/**
 * The search both forms run as the author types: the loaded events' places, then Wikidata, without
 * the Wikidata items that are already listed.
 */
export class PlaceSearch {
    /**
     * @param {() => object[]} events - the loaded events, read when the first search runs
     * @param {{ wikidata?: typeof searchWikidata }} [options]
     */
    constructor(events, { wikidata = searchWikidata } = {}) {
        this.events = events;
        this.wikidata = wikidata;
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
}
