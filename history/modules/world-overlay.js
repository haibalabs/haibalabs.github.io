// world-overlay.js
// Approved edits every visitor sees (WORLD-EDITS.md, Publishing to visitors), read from the public
// Firestore document world_overlay/current and applied over the loaded world events after the
// released images, locations and labels. A patch applies only to an event whose field still holds a
// value the patch was approved from, so a rebuilt or already folded dataset is never overwritten by
// mistake. The overlay names edits, never people. Writes are in review-store.js.
import { normalizeField, sameValue } from './world-edits.js';

/**
 * Why the overlay can't be applied, or null if it can.
 *
 * @param {object|null} overlay
 * @returns {string|null}
 */
export function overlayProblem(overlay) {
    if (!overlay || !Number.isInteger(overlay.version)) return 'The published edits are not a known version.';
    const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    if (!isMap(overlay.patches) || !isMap(overlay.created)) return 'The published edits are malformed.';
    return null;
}

// Every value a patch may be applied from: its base, earlier bases, and each approved state along
// its chain (an older page holding B still moves forward to C after A→B→C).
function sourceValues(patch) {
    return [patch.base, ...(patch.prior_bases ?? []), ...(patch.chain ?? []).flatMap(step => [step.before, step.after])];
}

/**
 * Adds the published new events and applies the patches to the loaded world events, in place.
 * Edited and added events get community_edited: true, for their mark.
 *
 * @param {object[]} events - the loaded world events, in file order
 * @param {object} overlay - world_overlay/current; call only when overlayProblem() returns null
 * @returns {{ added: object[], patched: number, stale: { event_id: string, field: string }[] }}
 */
export function applyOverlay(events, overlay) {
    const byId = new Map(events.filter(event => event.event_id).map(event => [event.event_id, event]));
    const added = [];
    for (const [eventId, entry] of Object.entries(overlay.created ?? {})) {
        // once the dataset holds the event, it wins; later changes to it are ordinary patches
        if (byId.has(eventId)) continue;
        const event = { ...structuredClone(entry.record), community_edited: true };
        byId.set(eventId, event);
        added.push(event);
    }
    let patched = 0;
    const stale = [];
    for (const [eventId, fields] of Object.entries(overlay.patches ?? {})) {
        const event = byId.get(eventId);
        if (!event) continue;
        for (const [field, patch] of Object.entries(fields)) {
            const loaded = normalizeField(field, event[field]);
            if (sameValue(loaded, patch.value)) continue;
            if (!sourceValues(patch).some(value => sameValue(loaded, value))) {
                stale.push({ event_id: eventId, field });
                continue;
            }
            event[field] = structuredClone(patch.value);
            event.community_edited = true;
            patched++;
        }
    }
    return { added, patched, stale };
}
