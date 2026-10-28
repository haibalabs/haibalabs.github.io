// event-id.js
// Permanent IDs for events created in the browser (personal timelines). No browser or Firebase
// imports, so it is unit-tested in Node.

export const EVENT_ID_PATTERN = /^evt_[0-9a-f-]{36}$/;

export function newEventId() {
    return `evt_${crypto.randomUUID()}`;
}
