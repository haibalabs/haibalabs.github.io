import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachPreviewImages, detachPreviewImages, previewProblem, sha256Hex } from '../../modules/world-images.js';

const PREVIEW = JSON.parse(readFileSync(new URL('../../previews/reviewed-images-v1.json', import.meta.url), 'utf8'));
const EVENTS_BYTES = readFileSync(new URL('../../events.json', import.meta.url));

// A small file whose records sit at the positions the preview records name, and the events the app
// would load from it: copies, plus the fields the app adds or normalizes at load.
function dataset(records) {
  const originals = [];
  for (const r of records) {
    originals[r.record_index] = {
      name: r.event_name, enhanced_time: r.enhanced_time, enhanced_description: 'What happened.',
      wikipedia_url: 'https://en.wikipedia.org/wiki/X', lastModified: 1, locations: [{ name: 'Kansas City', country: 'United States' }],
    };
  }
  for (let i = 0; i < originals.length; i++) originals[i] ??= { name: `Filler ${i}`, enhanced_time: '1900' };
  const events = originals.map(o => ({
    ...structuredClone(o), dirty: false, syncedRevision: null, lastModified: 1729800000000, sourceTimestamp: 1729800000000,
    locations: (o.locations ?? []).map(l => ({ ...l, verified: true, corrected: null })),
  }));
  return { events, originals };
}
const record = (index, extra = {}) => ({
  record_index: index, event_name: `Event ${index}`, enhanced_time: '1933', image_url: `https://upload.wikimedia.org/x/${index}.jpg`,
  source_url: 'https://commons.wikimedia.org/wiki/File:X.jpg', image_role: 'event_photo', caption: `Caption ${index}`,
  credit: 'Someone', license_name: 'Public domain', license_url: null, event_issue_ids: [], ...extra,
});

describe('reviewed-images-v1.json, the preview fixture', () => {
  it('is bound to the repository\'s events.json by hash, and every record matches its event', async () => {
    assert.equal(await sha256Hex(EVENTS_BYTES), PREVIEW.source.events_sha256);
    const events = JSON.parse(EVENTS_BYTES);
    assert.equal(previewProblem(PREVIEW, PREVIEW.source.events_sha256, events.length), null);
    for (const r of PREVIEW.records) {
      assert.equal(events[r.record_index].name, r.event_name, `record ${r.record_index}`);
      assert.equal(events[r.record_index].enhanced_time, r.enhanced_time, `record ${r.record_index}`);
    }
  });
  it('has the nine reviewed records with https image, source and license links', () => {
    assert.equal(PREVIEW.records.length, 9);
    for (const r of PREVIEW.records) {
      for (const url of [r.image_url, r.source_url, r.license_url].filter(Boolean)) assert.match(url, /^https:\/\//);
      assert.ok(['event_photo', 'event_aftermath'].includes(r.image_role));
      assert.ok(r.caption && r.credit && r.license_name);
    }
  });
});

describe('previewProblem — attach only to the exact data file reviewed', () => {
  const preview = { source: { events_sha256: 'abc' }, records: [record(1), record(3)] };
  it('accepts the bound file', () => assert.equal(previewProblem(preview, 'abc', 5), null));
  it('refuses any other file, without falling back to title matching', () =>
    assert.match(previewProblem(preview, 'other', 5), /not the one these preview images were reviewed against/));
  it('refuses invalid or repeated positions', () => {
    assert.match(previewProblem({ ...preview, records: [record(1), record(1)] }, 'abc', 5), /invalid or repeated/);
    assert.match(previewProblem({ ...preview, records: [record(7)] }, 'abc', 5), /invalid or repeated/);
    assert.match(previewProblem({ ...preview, records: [record(-1)] }, 'abc', 5), /invalid or repeated/);
  });
});

describe('attachPreviewImages and detachPreviewImages — all reviewed records or none', () => {
  it('attaches each image and its display details to the event at its position', () => {
    const records = [record(1), record(3, { image_role: 'event_aftermath', event_issue_ids: ['hold'] })];
    const { events, originals } = dataset(records);
    const { attached, problems } = attachPreviewImages(events, records, originals);
    assert.equal(attached.length, 2);
    assert.deepEqual(problems, []);
    assert.equal(events[1].image_url, records[0].image_url);
    assert.deepEqual(events[3].image_preview, {
      caption: 'Caption 3', role: 'event_aftermath', credit: 'Someone', license_name: 'Public domain',
      license_url: null, source_url: records[1].source_url, under_review: true,
    });
    assert.equal(events[0].image_url, undefined);
  });
  it('tolerates what the app adds at load: the timestamp and the location verifier\'s annotations', () => {
    const records = [record(1)];
    const { events, originals } = dataset(records);
    assert.notEqual(events[1].lastModified, originals[1].lastModified);
    assert.equal(events[1].locations[0].verified, true);
    assert.deepEqual(attachPreviewImages(events, records, originals).problems, []);
  });
  const refusals = [
    ['a different event at that position', (e) => { e.name = 'Renamed'; }],
    ['a different date at that position', (e) => { e.enhanced_time = '1934'; }],
    ['a personal event', (e) => { e.personal = true; }, /no world event at that position/],
    ['an event edited in this session', (e) => { e.dirty = true; }, /changed after loading/],
    ['an event replaced by a synced revision', (e) => { e.syncedRevision = 2; }, /changed after loading/],
    ['an event that already has an image', (e) => { e.image_url = 'https://example.com/existing.jpg'; }, /already has an image/],
    ['a changed description', (e) => { e.enhanced_description = 'Something else.'; }, /enhanced_description differs/],
    ['a changed Wikipedia link', (e) => { e.wikipedia_url = 'https://en.wikipedia.org/wiki/Y'; }, /wikipedia_url differs/],
    ['a removed file field', (e) => { delete e.enhanced_description; }, /enhanced_description differs/],
    ['a moved location', (e) => { e.locations[0].name = 'Topeka'; }, /locations differ/],
    ['an added location', (e) => { e.locations.push({ name: 'Topeka' }); }, /locations differ/],
  ];
  for (const [what, change, reason = /a different event at that position/] of refusals) {
    it('refuses ' + what + ', and then attaches nothing at all', () => {
      const records = [record(1), record(3)];
      const { events, originals } = dataset(records);
      change(events[3]);
      const { attached, problems } = attachPreviewImages(events, records, originals);
      assert.deepEqual(attached, []);
      assert.equal(problems.length, 1);
      assert.equal(problems[0].record_index, 3);
      assert.match(problems[0].reason, reason);
      assert.equal(events[1].image_url, undefined);
      assert.equal(events[1].image_preview, undefined);
    });
  }
  it('reports every record that no longer matches', () => {
    const records = [record(0), record(1), record(2)];
    const { events, originals } = dataset(records);
    events[0].name = 'Renamed';
    events[2].dirty = true;
    const { problems } = attachPreviewImages(events, records, originals);
    assert.deepEqual(problems.map(p => p.record_index), [0, 2]);
  });
  it('detaching removes exactly what was attached', () => {
    const records = [record(1)];
    const { events, originals } = dataset(records);
    const before = structuredClone(events);
    const { attached } = attachPreviewImages(events, records, originals);
    detachPreviewImages(attached);
    assert.deepEqual(events, before);
  });
});
