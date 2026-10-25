import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachPreviewImages, detachPreviewImages, previewProblem, sha256Hex } from '../../modules/world-images.js';

const PREVIEW = JSON.parse(readFileSync(new URL('../../previews/reviewed-images-v1.json', import.meta.url), 'utf8'));
const EVENTS_BYTES = readFileSync(new URL('../../events.json', import.meta.url));

// A small dataset whose events sit at the positions the records name.
function dataset(records) {
  const events = [];
  for (const r of records) events[r.record_index] = { name: r.event_name, enhanced_time: r.enhanced_time };
  for (let i = 0; i < events.length; i++) events[i] ??= { name: `Filler ${i}`, enhanced_time: '1900' };
  return events;
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

describe('attachPreviewImages and detachPreviewImages', () => {
  it('attaches each image and its display details to the event at its position', () => {
    const records = [record(1), record(3, { image_role: 'event_aftermath', event_issue_ids: ['hold'] })];
    const events = dataset(records);
    const { attached, skipped } = attachPreviewImages(events, records);
    assert.equal(attached.length, 2);
    assert.deepEqual(skipped, []);
    assert.equal(events[1].image_url, records[0].image_url);
    assert.deepEqual(events[3].image_preview, {
      caption: 'Caption 3', role: 'event_aftermath', credit: 'Someone', license_name: 'Public domain',
      license_url: null, source_url: records[1].source_url, under_review: true,
    });
    assert.equal(events[0].image_url, undefined);
  });
  it('skips a position holding a different event, a personal event, or one that already has an image', () => {
    const records = [record(0), record(1), record(2)];
    const events = dataset(records);
    events[0].name = 'Renamed';
    events[1].personal = true;
    events[2].image_url = 'https://example.com/existing.jpg';
    const { attached, skipped } = attachPreviewImages(events, records);
    assert.equal(attached.length, 0);
    assert.deepEqual(skipped.map(s => s.reason), ['a different event at that position', 'no world event at that position', 'the event already has an image']);
    assert.equal(events[2].image_url, 'https://example.com/existing.jpg');
  });
  it('detaching removes exactly what was attached', () => {
    const records = [record(1)];
    const events = dataset(records);
    const { attached } = attachPreviewImages(events, records);
    detachPreviewImages(attached);
    assert.equal(events[1].image_url, undefined);
    assert.equal(events[1].image_preview, undefined);
  });
});
