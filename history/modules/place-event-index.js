import { isValidCoordinates } from './map-utils.js';
import { eventYear } from './date-handlers.js';

const longitude = value => ((value + 180) % 360 + 360) % 360 - 180;
export function containsPoint(bounds, [lat, lng]) {
    if (!bounds) return true;
    const { south, north, west, east } = bounds;
    if (![south, north, west, east].every(Number.isFinite) || south > north) return false;
    if (lat < south || lat > north) return false;
    if (Math.abs(east - west) >= 360) return true;
    const w = longitude(west), e = longitude(east), x = longitude(lng);
    return w <= e ? x >= w && x <= e : x >= w || x <= e;
}

// One entry per place/coordinate pair: conflicting saved points are never averaged.
export class PlaceEventIndex {
    constructor(events = []) {
        this.events = new Map();
        this.ids = new WeakMap();
        this.places = new Map();
        this.points = new Map();
        this.eventPoints = new Map();
        this.unmapped = new Set();
        this.years = new Map();
        // A persisted ID shared by several records identifies none of them: each such record
        // gets its own session-only identity, and the shared ID is reported in duplicateIds.
        const idCounts = new Map();
        for (const event of events) {
            if (event.event_id) idCounts.set(event.event_id, (idCounts.get(event.event_id) ?? 0) + 1);
        }
        this.duplicateIds = new Set([...idCounts].filter(([, n]) => n > 1).map(([id]) => id));
        if (this.duplicateIds.size) {
            console.warn(`Event IDs shared by more than one record: ${[...this.duplicateIds].join(', ')}`);
        }
        events.forEach((event, i) => {
            const id = !event.event_id ? `session:${i}`
                : this.duplicateIds.has(event.event_id) ? `session-duplicate:${i}` : event.event_id;
            this.events.set(id, event);
            this.ids.set(event, id);
            this.years.set(id, eventYear(event));
            const points = [];
            for (const location of event.locations || []) {
                if (!location || typeof location !== 'object') continue;
                const placeId = location.place_id || `session-place:${JSON.stringify([location.name, location.city, location.region, location.country])}`;
                if (!this.places.has(placeId)) this.places.set(placeId, new Set());
                this.places.get(placeId).add(id);
                const geography = location.geography;
                const coordinates = isValidCoordinates(location.corrected) ? location.corrected
                    : ['reused', 'corrected', 'resolved'].includes(geography?.status) && isValidCoordinates(geography.coordinates)
                        ? geography.coordinates : null;
                if (!coordinates) continue;
                const precision = geography?.precision || 'unknown';
                const key = JSON.stringify([placeId, coordinates, precision]);
                if (!this.points.has(key)) this.points.set(key, {
                    key, placeId, coordinates, precision,
                    approximate: !['exact', 'site'].includes(precision),
                    name: location.name || location.city || location.country || 'Unnamed place',
                    eventIds: new Set()
                });
                const point = this.points.get(key);
                point.eventIds.add(id);
                if (!points.includes(point)) points.push(point);
            }
            this.eventPoints.set(id, points);
            if (!points.length) this.unmapped.add(id);
        });
    }
    idFor(event) { return this.ids.get(event); }
    query({ bounds = null, placeId = null, unmappedOnly = false, includeApproximate = true } = {}) {
        if (unmappedOnly) return new Set(this.unmapped);
        if (!bounds && !placeId && includeApproximate) return new Set(this.events.keys());
        const ids = new Set();
        for (const point of this.points.values()) {
            if ((!placeId || point.placeId === placeId) && (includeApproximate || !point.approximate) && containsPoint(bounds, point.coordinates)) {
                for (const id of point.eventIds) ids.add(id);
            }
        }
        return ids;
    }
}
