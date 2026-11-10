// world-locations.js
// Accepted location batches every visitor sees (releases/README.md), exported by history-dp
// location_sidecar.py. Each record names an event of one exact world payload by position and ID,
// and the event locations it changes: each gets a new place_id and that place's reviewed geography.
// Changes are applied all or none, only when the bytes the page loaded have the bound hash and every
// target event and location is still the file's record. The payload's own locations come back when
// the file is removed. Apply after world images (world-images.js), which compare place IDs as loaded.

import { locationIdentity } from './world-images.js';

export const LOCATION_RELEASE_URL = 'releases/released-locations-v1.json';
export const LOCATION_PRECISIONS = new Set(['site', 'settlement', 'region', 'country', 'polity', 'approximate']);
export const LOCATION_STATUSES = new Set(['resolved']);

const validCoordinates = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
    && Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180;

/**
 * Why the location release cannot be applied to the loaded data, or null if it can.
 *
 * @param {object} release - the parsed released-locations file
 * @param {string} loadedSha256 - SHA-256 of the bytes the loaded events were parsed from
 * @param {number} eventCount - number of world events loaded from that file
 * @returns {string|null}
 */
export function locationProblem(release, loadedSha256, eventCount) {
    if (release?.version !== 1 || release.kind !== 'world_location_sidecar') return 'The location file is not a version 1 location release.';
    if (loadedSha256 !== release.source?.events_sha256) return 'The loaded events file is not the one these locations were reviewed against.';
    if (!Array.isArray(release.records) || !release.places || typeof release.places !== 'object') return 'The location file is malformed.';
    const indexes = release.records.map(r => r.record_index);
    const valid = indexes.every(i => Number.isInteger(i) && i >= 0 && i < eventCount);
    if (!valid || new Set(indexes).size !== indexes.length) return 'The location file has invalid or repeated event positions.';
    for (const [placeId, place] of Object.entries(release.places)) {
        if (!LOCATION_STATUSES.has(place?.status) || !LOCATION_PRECISIONS.has(place.precision) || !validCoordinates(place.coordinates)) {
            return `The location file has a place the site cannot show (${placeId}).`;
        }
    }
    for (const record of release.records) {
        const positions = (record.locations ?? []).map(l => l.location_index);
        if (!positions.length || new Set(positions).size !== positions.length
            || !record.locations.every(l => Number.isInteger(l.location_index) && Object.hasOwn(release.places, l.place_id))) {
            return `The location file has an invalid change at position ${record.record_index}.`;
        }
    }
    return null;
}

// Why a loaded event is no longer the file record its location change was reviewed for, or null.
function eventProblem(event, record, original) {
    if (!event || event.personal) return 'no world event at that position';
    if (event.event_id !== record.event_id || original?.event_id !== record.event_id) return 'a different event at that position';
    if (event.name !== record.event_name || event.enhanced_time !== record.enhanced_time) return 'a different event at that position';
    if (event.dirty || event.syncedRevision != null) return 'the event was changed after loading';
    if (locationIdentity(event.locations) !== locationIdentity(original.locations)) return 'its locations differ from the reviewed file';
    for (const change of record.locations) {
        if (!original.locations?.[change.location_index] || !event.locations?.[change.location_index]) return `it has no location ${change.location_index}`;
    }
    return null;
}

// A manual correction (location.corrected, from the site's corrections file) the map draws instead
// of the geography, when it disagrees with the released place. Such a location keeps its loaded
// values, so the map never shows the manual point with the release's precision or provenance.
const conflictsWithManualPoint = (location, place) => validCoordinates(location.corrected)
    && JSON.stringify(location.corrected) !== JSON.stringify(place.coordinates);

/**
 * Applies every location change to the event it was reviewed for, or none. Call only when
 * locationProblem() returns null. A location whose manual correction disagrees with its released
 * place is left as loaded and reported in kept.
 *
 * @param {object[]} events - the loaded world events, in file order
 * @param {object} release - the parsed released-locations file
 * @param {object[]} originals - the records of the reviewed file, as parsed from its bytes
 * @returns {{ applied: { event: object, before: object[] }[], kept: { record_index: number, location_index: number }[],
 *     problems: { record_index: number, reason: string }[] }}
 */
export function applyLocations(events, release, originals) {
    const problems = [];
    for (const record of release.records) {
        const reason = eventProblem(events[record.record_index], record, originals[record.record_index]);
        if (reason) problems.push({ record_index: record.record_index, reason });
    }
    if (problems.length) return { applied: [], kept: [], problems };
    const kept = [];
    const applied = release.records.map((record) => {
        const event = events[record.record_index];
        const before = event.locations;
        event.locations = before.map((location, index) => {
            const change = record.locations.find(c => c.location_index === index);
            if (!change) return location;
            const placed = placeLocation(location, change.place_id, release.places[change.place_id]);
            if (placed === location) kept.push({ record_index: record.record_index, location_index: index });
            return placed;
        });
        return { event, before };
    });
    return { applied, kept, problems };
}

/**
 * A location moved to its released place: that place's ID and a copy of its geography, unless the
 * location's manual correction disagrees with the place, when the location itself is returned.
 * Shared by the release file and published place buckets (published-data.js).
 *
 * @param {object} location - an event location as loaded and verified
 * @param {string} placeId - the released place's ID
 * @param {{ status: string, coordinates: number[], precision: string, verification?: string }} place
 * @returns {object}
 */
export function placeLocation(location, placeId, place) {
    if (conflictsWithManualPoint(location, place)) return location;
    return { ...location, place_id: placeId, geography: structuredClone(place) };
}

/**
 * The event positions a release file names, ignoring malformed entries, so one bad entry in one
 * release never costs the other release its kept records.
 *
 * @param {object|null} release
 * @returns {number[]}
 */
export function releasePositions(release) {
    return Array.isArray(release?.records)
        ? release.records.filter(r => r && typeof r === 'object' && Number.isInteger(r.record_index)).map(r => r.record_index)
        : [];
}

// Restores the locations applyLocations replaced.
export function revertLocations(applied) {
    for (const { event, before } of applied) event.locations = before;
}
