// world-images.js
// Debug-only preview of independently reviewed world-event images (previews/README.md). Each
// preview record names the position of its event in one exact events.json, identified by its
// SHA-256. Images are attached only when the loaded data file has that hash, every index is valid
// and unique, and the event at each position still has the recorded name and date; otherwise
// nothing is attached and the reason is reported. There is no fallback matching by title. The
// default site data carries no images, and nothing here runs unless an admin turns it on.

export const PREVIEW_URL = 'previews/reviewed-images-v1.json';

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
 * @param {string} loadedSha256 - SHA-256 of the loaded data file's bytes
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
    return null;
}

/**
 * Attaches preview images to the events they were reviewed for. Call only when previewProblem()
 * returns null.
 *
 * @param {object[]} events - the loaded world events, in file order
 * @param {object[]} records - preview records (previews/reviewed-images-v1.json)
 * @returns {{ attached: object[], skipped: { record_index: number, reason: string }[] }}
 */
export function attachPreviewImages(events, records) {
    const attached = [];
    const skipped = [];
    for (const record of records) {
        const event = events[record.record_index];
        let reason = null;
        if (!event || event.personal) reason = 'no world event at that position';
        else if (event.name !== record.event_name || event.enhanced_time !== record.enhanced_time) reason = 'a different event at that position';
        else if (event.image_url) reason = 'the event already has an image';
        if (reason) {
            skipped.push({ record_index: record.record_index, reason });
            continue;
        }
        event.image_url = record.image_url;
        event.image_preview = {
            caption: record.caption,
            role: record.image_role,
            credit: record.credit,
            license_name: record.license_name,
            license_url: record.license_url,
            source_url: record.source_url,
            under_review: (record.event_issue_ids ?? []).length > 0,
        };
        attached.push(event);
    }
    return { attached, skipped };
}

// Removes the images attachPreviewImages added.
export function detachPreviewImages(attached) {
    for (const event of attached) {
        delete event.image_url;
        delete event.image_preview;
    }
}
