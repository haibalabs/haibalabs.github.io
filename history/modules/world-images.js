// world-images.js
// Independently reviewed world-event images: the released set every visitor sees
// (releases/README.md) and the admin-only preview (previews/README.md). Each record names the
// position of its event in one exact events.json, identified by its SHA-256. Images are attached
// only when the bytes the page loaded have that hash, every index is valid and unique, and every
// target event is still the record loaded from the file: not replaced, not edited, with its file
// fields unchanged. If any check fails, nothing is attached and the reason is reported. There is no
// fallback matching by title. events.json itself carries no images.

export const PREVIEW_URL = 'previews/reviewed-images-v1.json';
// Reviewed images every visitor sees, with the same binding (releases/README.md).
export const RELEASE_URL = 'releases/released-images-v1.json';

// The image roles a record may have, with the label the viewer shows before the caption. A photo of
// the event itself needs none; every other role says what the image is. Other roles are refused.
export const ROLE_LABELS = {
    event_photo: null,
    event_aftermath: 'Aftermath',
    portrait: 'Portrait',
    site: 'Site',
    map: 'Map',
    symbol: 'Symbol',
    retrospective_illustration: 'Later illustration',
};

// Fields the app itself changes after loading: the timestamp it sets, and locations, which the
// location verifier annotates. Locations are compared by their identity fields instead.
const NORMALIZED_FIELDS = new Set(['lastModified', 'locations']);
const LOCATION_FIELDS = ['name', 'city', 'region', 'country', 'historical_name', 'place_id'];

/**
 * SHA-256 of some bytes, as lowercase hex.
 *
 * @param {ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Why the preview cannot be attached to the loaded data, or null if it can.
 *
 * @param {object} preview - the parsed preview file
 * @param {string} loadedSha256 - SHA-256 of the bytes the loaded events were parsed from
 * @param {number} eventCount - number of world events loaded from that file
 * @returns {string|null}
 */
export function previewProblem(preview, loadedSha256, eventCount) {
    if (loadedSha256 !== preview.source?.events_sha256) {
        return 'The loaded events file is not the one these preview images were reviewed against.';
    }
    const indexes = preview.records.map(r => r.record_index);
    const valid = indexes.every(i => Number.isInteger(i) && i >= 0 && i < eventCount);
    if (!valid || new Set(indexes).size !== indexes.length) return 'The preview file has invalid or repeated event positions.';
    if (!preview.records.every(r => Object.hasOwn(ROLE_LABELS, r.image_role))) return 'The preview file has an image role the site cannot label.';
    return null;
}

// Why a loaded event is no longer the file record a preview image was reviewed for, or null.
function eventProblem(event, record, original) {
    if (!event || event.personal) return 'no world event at that position';
    if (event.name !== record.event_name || event.enhanced_time !== record.enhanced_time) return 'a different event at that position';
    if (event.dirty || event.syncedRevision != null) return 'the event was changed after loading';
    if (event.image_url) return 'the event already has an image';
    for (const [key, value] of Object.entries(original)) {
        if (NORMALIZED_FIELDS.has(key)) continue;
        if (JSON.stringify(event[key]) !== JSON.stringify(value)) return `its ${key} differs from the reviewed file`;
    }
    const identity = (locations) => JSON.stringify((locations ?? []).map(l => LOCATION_FIELDS.map(f => (typeof l === 'string' && f === 'name' ? l : l?.[f]) ?? null)));
    if (identity(event.locations) !== identity(original.locations)) return 'its locations differ from the reviewed file';
    return null;
}

/**
 * Attaches every preview image to the event it was reviewed for, or none. Call only when
 * previewProblem() returns null.
 *
 * @param {object[]} events - the loaded world events, in file order
 * @param {object[]} records - preview records (previews/reviewed-images-v1.json)
 * @param {object[]} originals - the records of the reviewed file, as parsed from its bytes
 * @returns {{ attached: object[], problems: { record_index: number, reason: string }[] }}
 */
export function attachPreviewImages(events, records, originals) {
    const problems = [];
    for (const record of records) {
        const reason = eventProblem(events[record.record_index], record, originals[record.record_index]);
        if (reason) problems.push({ record_index: record.record_index, reason });
    }
    if (problems.length) return { attached: [], problems };
    const attached = records.map((record) => {
        const event = events[record.record_index];
        event.image_url = record.image_url;
        event.image_preview = {
            caption: record.caption,
            role: record.image_role,
            credit: record.credit,
            license_name: record.license_name,
            license_url: record.license_url,
            source_url: record.source_url,
            date_qualification: record.date_qualification ?? null,
            under_review: (record.event_issue_ids ?? []).length > 0,
        };
        return event;
    });
    return { attached, problems };
}

// Removes the images attachPreviewImages added.
export function detachPreviewImages(attached) {
    for (const event of attached) {
        delete event.image_url;
        delete event.image_preview;
    }
}
