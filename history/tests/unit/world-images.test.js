import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { attachPreviewImages, CREDIT_LIMIT, detachPreviewImages, displayCaption, displayDate, IMAGE_ROLES, previewProblem, recordDisplayDate, sha256Hex, shortCredit } from '../../modules/world-images.js';

const PREVIEW = JSON.parse(readFileSync(new URL('../../previews/reviewed-images-v1.json', import.meta.url), 'utf8'));
const RELEASE = JSON.parse(readFileSync(new URL('../../releases/released-images-v1.json', import.meta.url), 'utf8'));
const SAMPLE = JSON.parse(readFileSync(new URL('../fixtures/released-images-sample.json', import.meta.url), 'utf8'));
const EVENTS_BYTES = readFileSync(new URL('../../events.json', import.meta.url));
// the default world dataset the release is bound to: an envelope { metadata, events }
const CANONICAL_BYTES = readFileSync(new URL('../../canonical-t2.json', import.meta.url));

import { parseKeepingNumbers, recordSha256 } from './fingerprint.js';

// The checks every release file must pass against the data file it is bound to.
async function checkRelease(release, bytes) {
  assert.equal(release.version, 1);
  assert.equal(await sha256Hex(bytes), release.source.events_sha256);
  const data = parseKeepingNumbers(bytes);
  const events = data.events ?? data;
  assert.equal(previewProblem(release, release.source.events_sha256, events.length), null);
  for (const r of release.records) {
    const event = events[r.record_index];
    assert.equal(recordSha256(event), r.baseline_record_sha256, `record ${r.record_index}`);
    assert.equal(event.name, r.event_name, `record ${r.record_index}`);
    assert.equal(event.enhanced_time, r.enhanced_time, `record ${r.record_index}`);
    assert.equal(event.image_url, undefined, `record ${r.record_index} already has an image`);
    for (const url of [r.image_url, r.source_url, r.license_url].filter(Boolean)) assert.match(url, /^https:\/\//);
    assert.ok(IMAGE_ROLES.has(r.image_role), `record ${r.record_index} role ${r.image_role}`);
    // an image that is not a photo of the event or its aftermath says what it shows and when
    if (!['event_photo', 'event_aftermath'].includes(r.image_role)) assert.ok(r.date_qualification?.trim(), `record ${r.record_index} needs a date qualification`);
    assert.ok(r.caption && r.credit && r.license_name);
    // events with open data issues may be released; the viewer notes they are still being reviewed
    assert.ok(Array.isArray(r.event_issue_ids) && r.event_issue_ids.every(id => /^issue_[0-9a-f]+$/.test(id)), `record ${r.record_index} issue ids`);
  }
}

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

describe('released-images-v1.json, the images every visitor sees', () => {
  it('is bound to the default canonical-t2.json, and every record matches its event exactly', () => checkRelease(RELEASE, CANONICAL_BYTES));
  it('the release check accepts the sample cohort and refuses a record whose fingerprint differs', async () => {
    await checkRelease(SAMPLE, EVENTS_BYTES);
    const altered = structuredClone(SAMPLE);
    altered.records[0].baseline_record_sha256 = '0'.repeat(64);
    await assert.rejects(checkRelease(altered, EVENTS_BYTES));
  });
  it('the sample cohort keeps the reviewed display fields of the preview records', () => {
    for (const r of SAMPLE.records) {
      const reviewed = PREVIEW.records.find(p => p.record_index === r.record_index);
      for (const field of ['image_url', 'source_url', 'image_role', 'caption', 'credit', 'license_name', 'license_url']) {
        assert.equal(r[field], reviewed[field], `record ${r.record_index} ${field}`);
      }
    }
  });
});

describe('record fingerprints — numbers as the file writes them', () => {
  it('keeps 45.0 distinct from 45, and reads strings, nesting and empty containers like JSON.parse', () => {
    const bytes = Buffer.from('{"b": [-45.0, 2, 1e-05], "a": "caf\\u00e9 \\"x\\"", "c": {}, "d": [], "e": [true, null]}');
    assert.equal(recordSha256(parseKeepingNumbers(bytes)), createHash('sha256')
      .update('{"a": "café \\"x\\"", "b": [-45.0, 2, 1e-05], "c": {}, "d": [], "e": [true, null]}').digest('hex'));
    const plain = JSON.parse(bytes);
    const kept = parseKeepingNumbers(bytes);
    assert.equal(kept.a, plain.a);
    assert.deepEqual([kept.c, kept.d, kept.e], [plain.c, plain.d, plain.e]);
  });
});

describe('shortCredit — keep the viewer\'s credit line short', () => {
  it('leaves a short credit alone', () => {
    assert.deepEqual(shortCredit('Bundesarchiv, Bild 183'), { text: 'Bundesarchiv, Bild 183', shortened: false });
  });
  it('ends a long credit at a word, within the limit, with an ellipsis', () => {
    const long = 'word '.repeat(200).trim();
    const { text, shortened } = shortCredit(long);
    assert.ok(shortened && text.endsWith('…') && text.length <= CREDIT_LIMIT + 1);
    assert.ok(!text.slice(0, -1).endsWith(' ') && long.startsWith(text.slice(0, -1)));
  });
  it('cuts a long credit with no spaces at the limit', () => {
    assert.equal(shortCredit('x'.repeat(1000)).text, `${'x'.repeat(CREDIT_LIMIT)}…`);
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
  it('accepts the contextual roles the review assigns, and refuses a role the site does not know', () => {
    for (const role of ['portrait', 'site', 'map', 'symbol', 'retrospective_illustration']) {
      assert.equal(previewProblem({ ...preview, records: [record(1, { image_role: role })] }, 'abc', 5), null, role);
    }
    for (const role of ['unknown', 'contemporary_event', undefined]) {
      assert.match(previewProblem({ ...preview, records: [record(1, { image_role: role })] }, 'abc', 5), /role the site does not know/);
    }
  });
});

describe('displayDate and displayCaption — the image date, plainly', () => {
  it('cleans the date shapes the source metadata uses', () => {
    const cases = [
      ['2023-04-29', '2023-04-29'], ['2014-06-28 13:40:57', '2014-06-28'], ['1864', '1864'], ['1925-05', '1925'],
      ['18 th century date QS:P,+1750-00-00T00:00:00Z/7', '18th century'], ['late 19th century', 'late 19th century'],
      ['circa 1550 date QS:P,+1550-00-00T00:00:00Z/9,P1480,Q5727902', 'c. 1550'], ['c. 1880s', 'c. 1880s'],
      ['between 1890 and 1900 date QS:P,+1890-00-00T00:00:00Z/9', '1890–1900'], ['1810/1867', '1810–1867'],
      ['before 1900 date QS:P,+1900-00-00T00:00:00Z/9', 'before 1900'],
      ['Taken on 5 October 2007, 10:21 (according to Exif data)', '2007'], ['Taken in October 1907', '1907'],
      ['7/4/2015', '2015'], ['Published on August 14, 1976', '1976'], ['27 - 29 September 1981', '1981'],
      ['between circa 1461 and circa 1470 date QS:P,+1450-00-00T00:00:00Z/7,P1480,Q5727902', 'c. 1461–1470'],
      ['1928–1929 circa', 'c. 1928–1929'], ['2007-01-01/2017-12-31', '2007–2017'],
      ['1847 (28 March 2010 (original upload date))', '1847'],
      ['20 November 2025 (upload date) - Taken on 27 April 2011', '2011'],
    ];
    for (const [raw, shown] of cases) assert.equal(displayDate(raw), shown, raw);
  });
  it('keeps an era and shows nothing rather than a year that changes the meaning', () => {
    assert.equal(displayDate('7th century BC'), '7th century BC');
    assert.equal(displayDate('500 BC'), '500 BC');
    const unsafe = [null, undefined, '', 'Unknown date', '06.11.06', '-0085-01-01', 'Since 1966', 'Ming Dynasty (1368-1644)',
      'Unknown date, photoshopped: 2010-04-16', 'Sommer 1945 oder Folgejahre', 'Late 2nd, early 3rd century AD',
      '1 August 2008 (original upload date)', '20:36, 12 April 2010 (UTC)', 'Published in London. by T. Cadel in 1786.',
      'circa 1505 date QS:P,+1505-00-00T00:00:00Z/9,P1480,Q5727902 (1893 facsimile) .'];
    for (const raw of unsafe) assert.equal(displayDate(raw), null, String(raw));
  });
  it('the release records Iris checked keep their meaning: era kept, no editing date, no lost "or later"', () => {
    const byPair = (prefix) => RELEASE.records.find(r => r.pair_id.startsWith(prefix));
    assert.equal(displayDate(byPair('c93e0770').image_date), '7th century BC');
    assert.equal(displayDate(byPair('02a4ae94').image_date), null);
    assert.equal(displayDate(byPair('0a01f6cb').image_date), null);
  });
  it('a reviewed display_date is shown as written, and an explicit null shows no date', () => {
    assert.equal(recordDisplayDate({ display_date: 'c. 1550', image_date: '2010-04-16' }), 'c. 1550');
    assert.equal(recordDisplayDate({ display_date: null, image_date: 'Unknown date, photoshopped: 2010-04-16' }), null);
    assert.equal(recordDisplayDate({ display_date: null, image_date: '1864' }), null);
    assert.equal(recordDisplayDate({ image_date: '1864' }), '1864');
  });
  it('the repository release has no shown date longer than a date', () => {
    for (const r of RELEASE.records) {
      const shown = displayDate(r.image_date);
      assert.ok(shown === null || (shown.length <= 32 && !/QS:|\d{2}:\d{2}/.test(shown)), `${r.record_index}: ${shown}`);
    }
  });
  it('drops a trailing "Image date" sentence from a caption, and nothing else', () => {
    assert.equal(displayCaption('Map showing Cherchen among Tarim mummy sites. Image date: 2023-04-29.'), 'Map showing Cherchen among Tarim mummy sites.');
    assert.equal(displayCaption('Engraving of the opening ceremony, 1876.'), 'Engraving of the opening ceremony, 1876.');
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
      license_url: null, source_url: records[1].source_url, date: null, under_review: true,
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
