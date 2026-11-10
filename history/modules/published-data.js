// published-data.js
// The published world data (format: team-status/factory-v1/preproduction/t106/shard-format.md): a
// manifest, event shards, place buckets and the manual corrections file. Loading turns them into the
// events a data file gives, so the rest of the site runs unchanged: the location verifier applies the
// corrections, each placed location then takes its reviewed place by the release rule
// (world-locations.js), and labels go by place_id (world-labels.js).
//
// The browser doesn't hash these files: they are named by their hash and never change, and the factory's
// observer checks the served bytes against the manifest once per deployment. Loading checks only that
// every file is the one the manifest lists, by its count and identity.

import { imagePreview } from './world-images.js';
import { placeLocation } from './world-locations.js';

export const MANIFEST_URL = 'data/manifest.json';
const MANIFEST_FORMAT = 'historiline-manifest/v1';
const EVENTS_FORMAT = 'historiline-events/v1';
const PLACES_FORMAT = 'historiline-places/v1';

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
    return response.json();
}

/**
 * Fetches the current release: its manifest, revalidated on every visit, then every event shard and
 * place bucket it lists, which browsers may cache forever.
 *
 * @param {string} [manifestUrl]
 * @returns {Promise<{ manifest: object, manifestUrl: string, shards: object[], buckets: object[], correctionsUrl: string }>}
 */
export async function fetchPublished(manifestUrl = MANIFEST_URL) {
    const manifest = await fetchJson(manifestUrl, { cache: 'no-cache' });
    if (manifest?.format !== MANIFEST_FORMAT) throw new Error('The manifest is not a version 1 published release.');
    const base = new URL('.', new URL(manifestUrl, location.href));
    const fileUrl = (folder, sha256) => new URL(`${folder}/${sha256}.json`, base).href;
    const [shards, buckets] = await Promise.all([
        Promise.all(manifest.shards.map(entry => fetchJson(fileUrl('events', entry.sha256)))),
        Promise.all(manifest.places.files.map(entry => fetchJson(fileUrl('places', entry.sha256)))),
    ]);
    manifest.shards.forEach((entry, i) => {
        const shard = shards[i];
        if (shard?.format !== EVENTS_FORMAT || shard.shard !== entry.id || shard.events?.length !== entry.count) {
            throw new Error(`Event shard ${entry.id} is not the one the manifest lists.`);
        }
    });
    manifest.places.files.forEach((entry, i) => {
        const bucket = buckets[i];
        if (bucket?.format !== PLACES_FORMAT || bucket.bucket !== entry.bucket || bucket.places?.length !== entry.count) {
            throw new Error(`Place bucket ${entry.bucket} is not the one the manifest lists.`);
        }
    });
    return { manifest, manifestUrl, shards, buckets, correctionsUrl: fileUrl('corrections', manifest.corrections.sha256) };
}

// A place row's reviewed place, in the shape a location release gives (world-locations.js).
function releasedPlace(row) {
    const place = { status: row.status, coordinates: row.point, precision: row.precision };
    if (row.verification !== undefined) place.verification = row.verification;
    return place;
}

/**
 * The fetched release as the event manager loads it (EventManager.loadPublished), plus its place labels.
 *
 * @param {{ manifest: object, manifestUrl: string, shards: object[], buckets: object[] }} published
 * @returns {{ manifestUrl: string, timestamp: number, events: object[], acceptedIds: Set<string>,
 *     placeLocations: (events: object[]) => void, labels: { labels: Object<string, string|null> } }}
 */
export function publishedWorld({ manifest, manifestUrl, shards, buckets }) {
    const places = new Map();
    for (const bucket of buckets) {
        for (const row of bucket.places) places.set(row.index, row);
    }
    const placeRow = (index, eventId) => {
        const row = places.get(index);
        if (!row) throw new Error(`Event ${eventId} names place ${index}, which no bucket has.`);
        return row;
    };

    // A present null label names no place; an absent one leaves the written name (world-labels.js).
    const labels = {};
    for (const row of places.values()) {
        if ('label' in row) labels[row.place_id] = row.label;
    }

    const events = [];
    const acceptedIds = new Set();
    const placements = new Map();
    for (const shard of shards) {
        for (const served of shard.events) {
            // visible is the build's own account of what the site decides from confidence and accepted
            const { visible: _visible, accepted, locations, image, ...event } = served;
            if (accepted === true) acceptedIds.add(event.event_id);
            const placed = [];
            event.locations = (locations ?? []).map((location, index) => {
                // the placement status and its reason stay in the release; the site shows the location as before
                const { place, placed: placedIndex, placement, reason: _reason, lookup_cause: _cause, ...fields } = location;
                if (placement === 'placed') {
                    const target = placeRow(placedIndex, event.event_id);
                    placed.push({ index, placeId: target.place_id, place: releasedPlace(target) });
                }
                return { ...fields, place_id: placeRow(place, event.event_id).place_id };
            });
            if (image) {
                event.image_url = image.image_url;
                event.image_preview = imagePreview(image);
            }
            events.push(event);
            if (placed.length) placements.set(event.event_id, placed);
        }
    }

    // After the location verifier: a manual correction that disagrees with the reviewed place keeps the
    // location as loaded, written place_id and all.
    const placeLocations = (loaded) => {
        for (const event of loaded) {
            const placed = placements.get(event.event_id);
            if (!placed) continue;
            event.locations = event.locations.map((location, index) => {
                const change = placed.find(p => p.index === index);
                return change ? placeLocation(location, change.placeId, change.place) : location;
            });
        }
    };

    return { manifestUrl, timestamp: Date.parse(manifest.created_at), events, acceptedIds, placeLocations, labels: { labels } };
}
