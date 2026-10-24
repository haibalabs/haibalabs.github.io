import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_ID_PATTERN, WORLD_COLLECTION, newEventId, syncTarget, toSyncDoc, mergeDecision, pushDecision, incomingProblem, acknowledgement } from '../../modules/sync-identity.js';

const id = (n) => `evt_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const events = (...ids) => ids.map((event_id, i) => ({ event_id, name: `Event ${i}` }));

describe('syncTarget — which datasets may sync', () => {
  it('maps the known world snapshot to events_main', () => {
    const target = syncTarget('canonical-t2.json', null, events(id(1), id(2)));
    assert.deepEqual(target, { collection: WORLD_COLLECTION, reason: null, duplicateIds: [] });
  });

  it('maps a dataset declaring the world dataset_id, whatever its file name', () => {
    assert.equal(syncTarget('snapshots/t3.json', { dataset_id: 'world-history' }, events(id(1))).collection, 'events_main');
  });

  it('ignores the path and query string of a known file', () => {
    assert.equal(syncTarget('/history/canonical-t2.json?x=1', null, events(id(1))).collection, 'events_main');
  });

  it('refuses unknown datasets, including the legacy default', () => {
    for (const file of ['events.json', 'events_sample.json', 'my-timeline.json']) {
      const target = syncTarget(file, null, events(id(1)));
      assert.equal(target.collection, null, file);
      assert.match(target.reason, /not a recognized shared dataset/);
    }
  });

  it('refuses a known dataset with missing or invalid IDs', () => {
    const target = syncTarget('canonical-t2.json', null, events(id(1), undefined, 'evt_1'));
    assert.equal(target.collection, null);
    assert.match(target.reason, /2 events have no valid event ID/);
  });

  it('refuses a known dataset with duplicate IDs and lists them', () => {
    const target = syncTarget('canonical-t2.json', null, events(id(1), id(1), id(2)));
    assert.equal(target.collection, null);
    assert.deepEqual(target.duplicateIds, [id(1)]);
    assert.match(target.reason, /shared by more than one event/);
  });
});

describe('newEventId — IDs for events created in the browser', () => {
  it('matches the canonical event_id pattern and is unique', () => {
    const a = newEventId(), b = newEventId();
    assert.match(a, EVENT_ID_PATTERN);
    assert.notEqual(a, b);
  });
});

describe('toSyncDoc — fields written to Firestore', () => {
  it('drops local sync state and keeps event content', () => {
    const doc = toSyncDoc({
      event_id: id(1), name: 'A', locations: [{ name: 'X' }],
      dirty: true, syncedRevision: 5, isNew: true, localTimestamp: 1, remoteTimestamp: 2,
      sourceTimestamp: 3, lastModified: 4, userId: 'u', writeId: 'w',
    });
    assert.deepEqual(doc, { event_id: id(1), name: 'A', locations: [{ name: 'X' }] });
  });
});

describe('mergeDecision — applying a server revision', () => {
  it('adds events the browser does not have', () => assert.equal(mergeDecision(undefined, 10), 'add'));

  it('accepts a newer revision into an untouched event, including one never synced', () => {
    assert.equal(mergeDecision({ dirty: false, syncedRevision: null }, 10), 'accept');
    assert.equal(mergeDecision({ dirty: false, syncedRevision: 5 }, 10), 'accept');
  });

  it('ignores revisions the event already reflects', () => {
    assert.equal(mergeDecision({ dirty: false, syncedRevision: 10 }, 10), 'unchanged');
    assert.equal(mergeDecision({ dirty: true, syncedRevision: 10 }, 9), 'unchanged');
  });

  it('reports a conflict when both sides changed', () => {
    assert.equal(mergeDecision({ dirty: true, syncedRevision: 5 }, 10), 'conflict');
    assert.equal(mergeDecision({ dirty: true, syncedRevision: null }, 10), 'conflict');
  });
});

describe('pushDecision — writing only over the revision an edit was based on', () => {
  it('writes when the server has no document', () => {
    assert.equal(pushDecision({ syncedRevision: null }, null), 'write');
    assert.equal(pushDecision({ syncedRevision: 100 }, null), 'write');
  });

  it('writes when the server still has the base revision', () => {
    assert.equal(pushDecision({ syncedRevision: 100 }, 100), 'write');
  });

  it('refuses to overwrite a newer server revision', () => {
    assert.equal(pushDecision({ syncedRevision: 100 }, 150), 'conflict');
  });

  it('refuses to overwrite a server document the edit never saw', () => {
    assert.equal(pushDecision({ syncedRevision: null }, 150), 'conflict');
  });
});

describe('incomingProblem — server documents that cannot be merged', () => {
  it('accepts a valid key that matches the stored event_id', () => {
    assert.equal(incomingProblem(id(1), { event_id: id(1) }), null);
  });

  it('rejects keys that are not event IDs', () => {
    assert.match(incomingProblem('Battle of Hastings', { event_id: 'Battle of Hastings' }), /not a valid event ID/);
  });

  it('rejects a document whose stored event_id differs from its key', () => {
    assert.match(incomingProblem(id(1), { event_id: id(2) }), /different event_id/);
    assert.match(incomingProblem(id(1), {}), /different event_id/);
  });
});

describe('acknowledgement — local state after a push commits', () => {
  const pushed = (extra = {}) => ({ event_id: id(1), name: 'Mine', dirty: true, syncedRevision: 100, ...extra });

  it('adopts the revision of its own write and clears the dirty flag', () => {
    const local = pushed();
    const sent = toSyncDoc(local);
    const ack = acknowledgement(local, sent, 'wA', { data: { ...sent, writeId: 'wA' }, revision: 200 });
    assert.deepEqual(ack, { syncedRevision: 200, dirty: false });
  });

  it('keeps the old base when another write replaced this one before the read-back', () => {
    // A writes at 200, B writes different content at 300, then A reads back B's document.
    const local = pushed();
    const sent = toSyncDoc(local);
    const ack = acknowledgement(local, sent, 'wA', { data: { event_id: id(1), name: 'Theirs', writeId: 'wB' }, revision: 300 });
    assert.deepEqual(ack, { syncedRevision: 100, dirty: false });
    const after = { ...local, ...ack };
    // the next pull takes B's content instead of treating it as already applied
    assert.equal(mergeDecision(after, 300), 'accept');
    // and a further local edit cannot silently overwrite B
    assert.equal(pushDecision({ ...after, dirty: true }, 300), 'conflict');
  });

  it('keeps an event that was never synced unsynced when another write replaced it', () => {
    const local = pushed({ syncedRevision: null });
    const ack = acknowledgement(local, toSyncDoc(local), 'wA', { data: { event_id: id(1), writeId: 'wB' }, revision: 300 });
    assert.equal(ack.syncedRevision, null);
    assert.equal(mergeDecision({ ...local, ...ack }, 300), 'accept');
  });

  it('keeps the old base when the document is gone or has no revision', () => {
    const local = pushed();
    assert.equal(acknowledgement(local, toSyncDoc(local), 'wA', { data: undefined, revision: null }).syncedRevision, 100);
    assert.equal(acknowledgement(local, toSyncDoc(local), 'wA', { data: { writeId: 'wA' }, revision: null }).syncedRevision, 100);
  });

  it('stays dirty when the event changed while the push was in flight', () => {
    const local = pushed();
    const sent = toSyncDoc(local);
    local.name = 'Edited during push';
    const ack = acknowledgement(local, sent, 'wA', { data: { ...sent, writeId: 'wA' }, revision: 200 });
    assert.deepEqual(ack, { syncedRevision: 200, dirty: true });
    assert.equal(pushDecision({ ...local, ...ack }, 200), 'write');
  });

  it('stays dirty when a nested field changed in place while the push was in flight', () => {
    const local = pushed({ locations: [{ name: 'Paris' }] });
    const sent = toSyncDoc(local);
    local.locations[0].name = 'Lyon';
    const ack = acknowledgement(local, sent, 'wA', { data: { ...sent, writeId: 'wA' }, revision: 200 });
    assert.equal(ack.dirty, true);
    assert.equal(sent.locations[0].name, 'Paris');
  });
});
