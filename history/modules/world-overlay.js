// world-overlay.js
// Approved edits every visitor sees (history-dp docs/site/WORLD-EDITS.md, Publishing to visitors), read from the public
// Firestore document world_overlay/current and applied over the loaded world events after the
// released images, locations and labels. A patch applies only to an event whose field still holds a
// value the patch was approved from, so a rebuilt or already folded dataset is never overwritten by
// mistake. The overlay names edits, never people. Writes are in review-store.js.
import { compactLocations, editVerification, eventFieldValue, sameValue, setEventField } from './world-edits.js';

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
 * Edited and added events get community_edited: true and revised_at, the latest approval time, for
 * their mark.
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
        const event = { ...structuredClone(entry.record), community_edited: true, revised_at: entry.approved_at };
        byId.set(eventId, event);
        added.push(event);
    }
    let patched = 0;
    const stale = [];
    for (const [eventId, fields] of Object.entries(overlay.patches ?? {})) {
        const event = byId.get(eventId);
        if (!event) continue;
        // every location is compared at the position the author saw, before any removal shifts the rest
        const loadedValues = Object.fromEntries(Object.keys(fields).map(field => [field, eventFieldValue(event, field)]));
        for (const [field, patch] of Object.entries(fields)) {
            const loaded = loadedValues[field];
            if (sameValue(loaded, patch.value)) continue;
            if (!sourceValues(patch).some(value => sameValue(loaded, value))) {
                stale.push({ event_id: eventId, field });
                continue;
            }
            const last = patch.chain?.at(-1);
            setEventField(event, field, patch.value, last ? editVerification(last) : 'community_edit');
            event.community_edited = true;
            if (last?.approved_at && !(event.revised_at > last.approved_at)) event.revised_at = last.approved_at;
            patched++;
        }
        compactLocations(event);
    }
    return { added, patched, stale };
}
