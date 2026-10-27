import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLocations, locationProblem, revertLocations } from '../../modules/world-locations.js';
import { attachPreviewImages, sha256Hex } from '../../modules/world-images.js';
import { parseKeepingNumbers, recordSha256 } from './fingerprint.js';

const CANONICAL_BYTES = readFileSync(new URL('../../canonical-t2.json', import.meta.url));
const RELEASE = JSON.parse(readFileSync(new URL('../../releases/released-locations-v1.json', import.meta.url), 'utf8'));
const SYNTHETIC = JSON.parse(readFileSync(new URL('../fixtures/released-locations-synthetic.json', import.meta.url), 'utf8'));

// The checks every location release must pass against the data file it is bound to, including the
// record and location fingerprints the browser cannot recompute (it relies on the byte hash instead).
async function checkLocationRelease(release) {
  const sha = await sha256Hex(CANONICAL_BYTES);
  const events = parseKeepingNumbers(CANONICAL_BYTES).events;
  assert.equal(locationProblem(release, sha, events.length), null);
  for (const r of release.records) {
    const event = events[r.record_index];
    assert.equal(recordSha256(event), r.baseline_record_sha256, `record ${r.record_index}`);
    assert.equal(event.event_id, r.event_id, `record ${r.record_index}`);
    for (const change of r.locations) {
      assert.equal(recordSha256(event.locations[change.location_index]), change.before_sha256, `record ${r.record_index} location ${change.location_index}`);
    }
  }
}

// A small loaded dataset: originals as the file has them, and the events the app holds after loading,
// whose locations the location verifier has annotated.
function dataset() {
  const originals = [0, 1, 2].map(i => ({
    event_id: `evt_${i}`, name: `Event ${i}`, enhanced_time: '1900',
    locations: [{ name: `Place ${i}`, city: '', region: '', country: '', historical_name: '', place_id: `plc_old_${i}`,
      geography: { status: 'missing', precision: 'unknown', coordinates: null } }],
  }));
  const events = originals.map(o => ({ ...structuredClone(o), dirty: false, syncedRevision: null,
    locations: o.locations.map(l => ({ ...structuredClone(l), verified: false, corrected: null })) }));
  return { originals, events };
}
const release = (records, places = { plc_new: { status: 'resolved', precision: 'settlement', coordinates: [48.8, 2.3], verification: 'test' } }) => ({
  version: 1, kind: 'world_location_sidecar', source: { events_sha256: 'abc' }, places, records,
});
const change = (index, extra = {}) => ({ record_index: index, event_id: `evt_${index}`, event_name: `Event ${index}`, enhanced_time: '1900',
  locations: [{ location_index: 0, place_id: 'plc_new' }], ...extra });

describe('released-locations-v1.json and the synthetic fixture', () => {
  it('the repository release is bound to the default canonical-t2.json', () => checkLocationRelease(RELEASE));
  it('the synthetic fixture passes the same checks, fingerprints included', () => checkLocationRelease(SYNTHETIC));
  it('the synthetic fixture says it is synthetic', () => {
    assert.equal(SYNTHETIC.source.batches[0].batch_id, 'synthetic-test-fixture');
    assert.ok(Object.values(SYNTHETIC.places).every(p => p.verification === 'synthetic_test_fixture'));
  });
});

describe('locationProblem — apply only to the exact data file reviewed', () => {
  it('accepts a valid release', () => assert.equal(locationProblem(release([change(1)]), 'abc', 3), null));
  it('refuses another file, a malformed file and repeated or invalid positions', () => {
    assert.match(locationProblem(release([change(1)]), 'other', 3), /not the one these locations were reviewed against/);
    assert.match(locationProblem({ ...release([change(1)]), kind: 'world_image_sidecar' }, 'abc', 3), /not a version 1 location release/);
    assert.match(locationProblem({ ...release([change(1)]), records: 'x' }, 'abc', 3), /malformed/);
    assert.match(locationProblem(release([change(1), change(1)]), 'abc', 3), /invalid or repeated/);
    assert.match(locationProblem(release([change(5)]), 'abc', 3), /invalid or repeated/);
  });
  it('refuses a place it cannot show and a change to an unknown place', () => {
    for (const place of [{ status: 'ambiguous', precision: 'settlement', coordinates: [1, 2] }, { status: 'resolved', precision: 'street', coordinates: [1, 2] },
      { status: 'resolved', precision: 'site', coordinates: [100, 2] }, { status: 'resolved', precision: 'site', coordinates: null }]) {
      assert.match(locationProblem(release([change(1)], { plc_new: place }), 'abc', 3), /a place the site cannot show/);
    }
    assert.match(locationProblem(release([change(1, { locations: [{ location_index: 0, place_id: 'plc_missing' }] })]), 'abc', 3), /invalid change/);
  });
});

describe('applyLocations and revertLocations — all reviewed changes or none', () => {
  it('sets the new place and its geography, keeping the location\'s other fields', () => {
    const { originals, events } = dataset();
    const { applied, problems } = applyLocations(events, release([change(1)]), originals);
    assert.deepEqual(problems, []);
    assert.equal(applied.length, 1);
    assert.equal(events[1].locations[0].place_id, 'plc_new');
    assert.deepEqual(events[1].locations[0].geography, { status: 'resolved', precision: 'settlement', coordinates: [48.8, 2.3], verification: 'test' });
    assert.equal(events[1].locations[0].name, 'Place 1');
    assert.equal(events[0].locations[0].place_id, 'plc_old_0');
  });
  const refusals = [
    ['a different event ID', (e) => { e.event_id = 'evt_other'; }, /a different event/],
    ['a renamed event', (e) => { e.name = 'Renamed'; }, /a different event/],
    ['a personal event', (e) => { e.personal = true; }, /no world event/],
    ['an edited event', (e) => { e.dirty = true; }, /changed after loading/],
    ['a synced revision', (e) => { e.syncedRevision = 3; }, /changed after loading/],
    ['a moved location', (e) => { e.locations[0].place_id = 'plc_elsewhere'; }, /locations differ/],
    ['a missing location', (e) => { e.locations = []; }, /locations differ/],
  ];
  for (const [what, alter, reason] of refusals) {
    it(`refuses ${what}, and then changes nothing`, () => {
      const { originals, events } = dataset();
      alter(events[2]);
      const before = structuredClone(events[1]);
      const { applied, problems } = applyLocations(events, release([change(1), change(2)]), originals);
      assert.deepEqual(applied, []);
      assert.equal(problems[0].record_index, 2);
      assert.match(problems[0].reason, reason);
      assert.deepEqual(events[1], before);
    });
  }
  it('reverting restores exactly the loaded locations', () => {
    const { originals, events } = dataset();
    const before = structuredClone(events);
    const { applied } = applyLocations(events, release([change(1), change(2)]), originals);
    revertLocations(applied);
    assert.deepEqual(events, before);
  });
});

describe('released images still attach after a location release changes their event\'s place', () => {
  it('when compared with the places as loaded', () => {
    const { originals, events } = dataset();
    const { applied } = applyLocations(events, release([change(1)]), originals);
    const before = new Map(applied.map(a => [a.event, a.before]));
    const image = { record_index: 1, event_name: 'Event 1', enhanced_time: '1900', image_url: 'https://upload.wikimedia.org/x.jpg', image_role: 'map',
      caption: 'c', credit: 'c', license_name: 'Public domain', event_issue_ids: [] };
    // compared with the current, changed places, the image would be refused
    assert.match(attachPreviewImages(events, [image], originals).problems[0].reason, /locations differ/);
    const { attached, problems } = attachPreviewImages(events, [image], originals, (event) => before.get(event) ?? event.locations);
    assert.deepEqual(problems, []);
    assert.equal(attached.length, 1);
  });
});
