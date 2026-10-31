// world-labels.js
// Place labels every visitor sees (releases/README.md), exported by history-dp place_labels.py: one
// display label per place, such as "Marrakech, Morocco", so a place reads the same way on every event.
// They apply only when the bytes the page loaded have the bound hash; the written names come back when
// the file is removed. A location's label is looked up by its place_id when it is shown, so a place the
// location release merged (world-locations.js) shows its own label.

export const LABEL_RELEASE_URL = 'releases/released-place-labels-v1.json';

let labels = new Map();

/**
 * Why the label file cannot be applied to the loaded data, or null if it can.
 *
 * @param {object} release - the parsed place label file
 * @param {string} loadedSha256 - SHA-256 of the bytes the loaded events were parsed from
 * @returns {string|null}
 */
export function labelProblem(release, loadedSha256) {
    if (release?.version !== 1 || release.kind !== 'world_place_label_sidecar') return 'The label file is not a version 1 place label release.';
    if (loadedSha256 !== release.source?.events_sha256) return 'The loaded events file is not the one these labels were made for.';
    if (!release.labels || typeof release.labels !== 'object' || Array.isArray(release.labels)) return 'The label file is malformed.';
    for (const [placeId, label] of Object.entries(release.labels)) {
        if (label !== null && (typeof label !== 'string' || !label.trim())) return `The label file has a label the site cannot show (${placeId}).`;
    }
    return null;
}

// Shows the file's labels. Call only when labelProblem() returns null.
export function setPlaceLabels(release) {
    labels = new Map(Object.entries(release.labels));
}

export function clearPlaceLabels() {
    labels = new Map();
}

/**
 * The label shown for a location: its place's label, null when the location names no place, or
 * undefined when its place has none, so the written name is shown.
 *
 * @param {object} location - an event location
 * @returns {string|null|undefined}
 */
export function placeLabel(location) {
    return location?.place_id && labels.has(location.place_id) ? labels.get(location.place_id) : undefined;
}
