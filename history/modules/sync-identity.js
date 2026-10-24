// sync-identity.js
// Whether a loaded dataset may sync to Firestore, and how a server revision merges into a local
// event. No browser or Firebase imports, so the rules here are unit-tested in Node.

export const EVENT_ID_PATTERN = /^evt_[0-9a-f-]{36}$/;

// The world dataset syncs to one collection whatever its snapshot file is called. Until exports
// carry a dataset_id, known snapshot files are listed here; any other file does not sync.
export const WORLD_COLLECTION = 'events_main';
export const WORLD_DATASET_ID = 'world-history';
export const WORLD_DATASET_FILES = ['canonical-t2.json'];

// Fields that describe local sync state; they are never written to Firestore.
const LOCAL_FIELDS = ['dirty', 'syncedRevision', 'isNew', 'localTimestamp', 'remoteTimestamp',
    'sourceTimestamp', 'lastModified', 'userId'];

export function newEventId() {
    return `evt_${crypto.randomUUID()}`;
}

/**
 * The Firestore collection a dataset syncs to, or null with the reason sync is unavailable.
 *
 * @param {string} file - data file the events were loaded from
 * @param {object|null} metadata - the file's metadata block, if any
 * @param {object[]} events
 * @returns {{ collection: string|null, reason: string|null, duplicateIds: string[] }}
 */
export function syncTarget(file, metadata, events) {
    const name = String(file ?? '').split('/').pop().split('?')[0];
    const counts = new Map();
    let invalid = 0;
    for (const event of events) {
        if (!EVENT_ID_PATTERN.test(event.event_id ?? '')) invalid++;
        else counts.set(event.event_id, (counts.get(event.event_id) ?? 0) + 1);
    }
    const duplicateIds = [...counts].filter(([, n]) => n > 1).map(([id]) => id);

    let reason = null;
    if (metadata?.dataset_id !== WORLD_DATASET_ID && !WORLD_DATASET_FILES.includes(name)) {
        reason = 'This dataset is not a recognized shared dataset, so its changes cannot be synced.';
    } else if (invalid) {
        reason = `${invalid} event${invalid === 1 ? ' has' : 's have'} no valid event ID, so changes cannot be synced.`;
    } else if (duplicateIds.length) {
        reason = `${duplicateIds.length} event ID${duplicateIds.length === 1 ? ' is' : 's are'} shared by more than one event `
            + `(${duplicateIds.slice(0, 3).join(', ')}${duplicateIds.length > 3 ? ', …' : ''}), so changes cannot be synced.`;
    }
    return { collection: reason ? null : WORLD_COLLECTION, reason, duplicateIds };
}

/**
 * The event as stored in Firestore: every field except local sync state.
 *
 * @param {object} event
 * @returns {object}
 */
export function toSyncDoc(event) {
    const out = { ...event };
    for (const field of LOCAL_FIELDS) delete out[field];
    return out;
}

/**
 * How a server revision applies to the local event with the same ID.
 * - 'add': no local event has this ID
 * - 'unchanged': the local event already reflects this revision or a later one
 * - 'conflict': the local event has unsynced changes and the server changed it too
 * - 'accept': the local event is untouched, so the server revision replaces it
 *
 * @param {object|undefined} local
 * @param {number} revision - server lastModified, in milliseconds
 * @returns {'add'|'unchanged'|'conflict'|'accept'}
 */
export function mergeDecision(local, revision) {
    if (!local) return 'add';
    if (local.syncedRevision != null && revision <= local.syncedRevision) return 'unchanged';
    return local.dirty ? 'conflict' : 'accept';
}
