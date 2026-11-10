import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedEventIds } from '../../modules/world-acceptance.js';
import { recordSha256 } from '../../modules/world-edits.js';

async function fixture() {
  const event = { event_id: 'evt_fixture', name: 'Harem conspiracy', enhanced_time: '1155 BC', confidence: 'low' };
  return { metadata: { snapshot_id: 'test', event_visibility: {
    schema_version: 'factory-event-visibility/v1', snapshot_id: 'test', records: [{
      record_index: 0, event_id: event.event_id, event_sha256: await recordSha256(event),
      reviewed_event_version: 'a'.repeat(64), acceptance_sha256: 'b'.repeat(64),
      verdict: 'accepted', scope: ['source', 'date', 'event'],
    }],
  } }, events: [event, { ...event, event_id: 'evt_unaccepted' }] };
}

test('acceptance is separate from unchanged intake confidence', async () => {
  const data = await fixture(), before = structuredClone(data);
  assert.deepEqual([...await acceptedEventIds(data)], ['evt_fixture']);
  assert.deepEqual(data, before);
  delete data.metadata.event_visibility;
  assert.deepEqual([...await acceptedEventIds(data)], []);
});

test('changed record, scope, receipt, identity, snapshot or repeated entries fail closed', async () => {
  for (const change of ['text', 'scope', 'receipt', 'identity', 'snapshot', 'duplicate', 'duplicate_event']) {
    const data = await fixture(), row = data.metadata.event_visibility.records[0];
    if (change === 'text') data.events[0].name += ' changed';
    if (change === 'scope') row.scope = ['source'];
    if (change === 'receipt') row.acceptance_sha256 = '';
    if (change === 'identity') row.event_id = 'other';
    if (change === 'snapshot') data.metadata.snapshot_id = 'changed';
    if (change === 'duplicate') data.metadata.event_visibility.records.push({ ...row });
    if (change === 'duplicate_event') data.events.push({ ...data.events[0] });
    assert.deepEqual([...await acceptedEventIds(data)], [], change);
  }
});

test('browser canonical hash matches the Python RFC 8785 fixture', async () => {
  const value = {text: 'Thera — 火', numbers: [1.0, -0.0, 1e-7, 1e21], '😀': true, '\uffff': null};
  assert.equal(await recordSha256(value), '63c131b24edeba7e56a573e754f1634863433179bfa935a657388e4a4b9de5ec');
});
