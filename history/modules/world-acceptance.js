import { recordSha256 } from './world-edits.js';

const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

// Validate before normalization or approved edits add display fields to the records.
export async function acceptedEventIds(data) {
    const index = data.metadata?.event_visibility;
    if (!index) return new Set();
    if (index.schema_version !== 'factory-event-visibility/v1'
        || index.snapshot_id !== data.metadata.snapshot_id || !Array.isArray(index.records)
        || !Array.isArray(data.events)) return new Set();
    const ids = new Set(), positions = new Set();
    const counts = new Map();
    for (const event of data.events) counts.set(event.event_id, (counts.get(event.event_id) ?? 0) + 1);
    for (const row of index.records) {
        if (!row || ids.has(row.event_id) || positions.has(row.record_index)) return new Set();
        ids.add(row.event_id); positions.add(row.record_index);
    }
    const accepted = new Set();
    for (const row of index.records) {
        const event = data.events[row.record_index];
        if (!Number.isInteger(row.record_index) || row.record_index < 0
            || !event || event.event_id !== row.event_id || counts.get(row.event_id) !== 1
            || row.verdict !== 'accepted' || !Array.isArray(row.scope)
            || !['source', 'date', 'event'].every(scope => row.scope.includes(scope))
            || !digest(row.acceptance_sha256) || !digest(row.reviewed_event_version)
            || !digest(row.event_sha256)) continue;
        if (await recordSha256(event) === row.event_sha256) accepted.add(row.event_id);
    }
    return accepted;
}
