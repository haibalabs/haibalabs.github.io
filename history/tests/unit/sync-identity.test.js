import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_ID_PATTERN, WORLD_COLLECTION, newEventId, syncTarget, toSyncDoc, mergeDecision } from '../../modules/sync-identity.js';

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
      sourceTimestamp: 3, lastModified: 4, userId: 'u',
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
