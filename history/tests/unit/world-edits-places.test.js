import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    changesFor, editProblem, eventFieldValue, imageNeedsConfirmation, isEditField, locationIndex, locationText, newEventChanges,
    newEventRecord, normalizeImage, normalizeLocation, toEventLocation, UPLOAD_LICENSE, UPLOAD_RIGHTS, withApproval,
} from '../../modules/world-edits.js';
import { applyOverlay } from '../../modules/world-overlay.js';

// Location and image edits (WORLD-EDITS.md, Location edits and The image record).
const EVT = 'evt_0a1b2c3d-0000-4000-8000-000000000001';
const AT = '2026-10-31T12:00:00.000Z';
const ARENA = { name: 'Allianz Arena', city: 'Munich', region: '', country: 'Germany', historical_name: '', point: [48.2188, 11.6247], precision: 'site', wikidata: 'Q131' };
const datasetLocation = (name, point, extra = {}) => ({
    name, city: '', region: '', country: '', historical_name: '', place_id: `plc_${name}`,
    geography: { status: 'reused', precision: 'approximate', coordinates: point, verification: 'not_independently_verified' }, ...extra,
});
const event = () => ({
    event_id: EVT, name: 'Paris Saint-Germain wins the 2025 UEFA Champions League', enhanced_time: 'May 31, 2025',
    enhanced_description: 'PSG beat Inter 5–0.', figures: [], categories: ['people'],
    locations: [datasetLocation('Munich', [48.137, 11.575]), datasetLocation('Paris', [48.857, 2.352])],
});
const edit = (changes, extra = {}) => ({
    edit_id: 'edt_1', kind: 'update', event_id: EVT, event_name: 'PSG', revision: 2, content_sha256: 'b'.repeat(64), changes, ...extra,
});
const commons = { source: 'commons', image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg', source_url: 'https://commons.wikimedia.org/wiki/File:A.jpg', file_page: 'File:A.jpg', credit: 'Jane Doe', license_name: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0' };

describe('location fields — one per position', () => {
    it('names positions 0 to 4 only', () => {
        assert.equal(locationIndex('location[1]'), 1);
        assert.equal(locationIndex('location[5]'), null);
        assert.equal(isEditField('location[4]'), true);
        assert.equal(isEditField('locations'), false);
    });

    it('reads an event location as its text, point and place, dropping what it did not record', () => {
        const value = normalizeLocation(datasetLocation('Munich', [48.137, 11.575]));
        assert.deepEqual(value, { name: 'Munich', city: '', region: '', country: '', historical_name: '', point: [48.137, 11.575], precision: 'approximate', place_id: 'plc_Munich' });
        assert.equal(normalizeLocation({ name: ' ', city: '' }), null);
        assert.equal(normalizeLocation({ name: 'Somewhere', point: [120, 0] }).point, null);
        // the data file's "unknown" is no precision at all
        assert.equal(normalizeLocation({ name: 'Somewhere', geography: { precision: 'unknown', coordinates: [1, 2] } }).precision, null);
    });

    it('lands an approved point as corrected, with where it came from', () => {
        const location = toEventLocation(ARENA, 'community_edit:edt_1@r2');
        assert.deepEqual(location.geography, { status: 'corrected', precision: 'site', coordinates: [48.2188, 11.6247], verification: 'community_edit:edt_1@r2' });
        assert.deepEqual(normalizeLocation(location), ARENA);
        // a point with no precision recorded keeps none, so the map draws a dot, never a ring (Rachid, 10-31)
        assert.equal('precision' in toEventLocation({ ...ARENA, precision: null }, 'x').geography, false);
    });

    it('keeps every precision the map knows through an edit and back', () => {
        for (const precision of ['site', 'settlement', 'approximate', 'region', 'country', 'polity', null]) {
            const place = normalizeLocation({ ...ARENA, precision });
            assert.deepEqual(normalizeLocation(toEventLocation(place, 'x')), place, String(precision));
        }
        // a name-only change to a polity's place republishes it as a polity
        const empire = datasetLocation('Ottoman Empire', [39, 35], { geography: { status: 'resolved', precision: 'polity', coordinates: [39, 35] } });
        const renamed = { ...normalizeLocation(empire), historical_name: 'Sublime State' };
        assert.equal(toEventLocation(renamed, 'x').geography.precision, 'polity');
    });

    it('proposes only the positions that changed: the second place changed, a third added', () => {
        const values = { 'location[0]': event().locations[0], 'location[1]': ARENA, 'location[2]': { name: 'Inter Milan home', city: 'Milan', country: 'Italy' } };
        const changes = changesFor(event(), values);
        assert.deepEqual(Object.keys(changes), ['location[1]', 'location[2]']);
        assert.equal(changes['location[1]'].before.place_id, 'plc_Paris');
        assert.equal(changes['location[2]'].before, null);
    });

    it('proposes a removal as null, which a new event may not have', () => {
        const changes = changesFor(event(), { 'location[0]': null });
        assert.deepEqual(changes['location[0]'].after, null);
        assert.equal(editProblem({ changes }), null);
        assert.match(editProblem({ kind: 'create', changes: { name: { before: null, after: 'A' }, enhanced_time: { before: null, after: '1900' }, enhanced_description: { before: null, after: 'B' }, 'location[0]': { before: null, after: null } } }), /empty place/);
    });

    it('needs a name, a city or a country, and plain text', () => {
        assert.match(editProblem({ changes: { 'location[0]': { before: null, after: normalizeLocation({ region: 'Bavaria' }) } } }), /name, a city or a country/);
        assert.match(editProblem({ changes: { 'location[0]': { before: null, after: normalizeLocation({ name: '<b>Arena</b>' }) } } }), /plain text/);
    });
});

describe('image field — the record visitors will see', () => {
    it('reads a released image as a "release" record', () => {
        const withImage = { ...event(), image_url: 'https://upload.wikimedia.org/b.jpg', image_preview: { caption: 'The final', credit: 'X', license_name: 'CC0', role: 'event_photo' } };
        const image = eventFieldValue(withImage, 'image');
        assert.equal(image.source, 'release');
        assert.equal(image.caption, 'The final');
        assert.equal(eventFieldValue(event(), 'image'), null);
    });

    it('accepts a Commons link and a link from another site, and needs an upload to carry its file, credit and grant', () => {
        assert.equal(editProblem({ changes: { image: { before: null, after: normalizeImage(commons) } } }), null);
        assert.equal(editProblem({ changes: { image: { before: null, after: normalizeImage({ source: 'link', image_url: 'https://news.example/p.jpg' }) } } }), null);
        assert.match(editProblem({ changes: { image: { before: null, after: normalizeImage({ source: 'link', image_url: 'http://news.example/p.jpg' }) } } }), /https/);
        const upload = { source: 'upload', credit: 'Me', rights_statement: UPLOAD_RIGHTS, license_name: UPLOAD_LICENSE, asset: { path: 'edit_uploads/u/edt_1/r1-x.webp', sha256: 'a'.repeat(64), bytes: 10, width: 4, height: 3 } };
        assert.equal(editProblem({ changes: { image: { before: null, after: normalizeImage(upload) } } }), null);
        assert.match(editProblem({ changes: { image: { before: null, after: normalizeImage({ ...upload, credit: '' }) } } }), /credit/);
        assert.match(editProblem({ changes: { image: { before: null, after: normalizeImage({ ...upload, rights_statement: 'sure' }) } } }), /may share/);
        assert.equal(editProblem({ changes: { image: { before: normalizeImage(commons), after: null } } }), null);
    });

    it('asks a reviewer to confirm every image except a Commons file with a free license', () => {
        assert.equal(imageNeedsConfirmation(normalizeImage(commons)), false);
        assert.equal(imageNeedsConfirmation(normalizeImage({ ...commons, license_name: 'Public domain' })), false);
        assert.equal(imageNeedsConfirmation(normalizeImage({ ...commons, license_name: 'Fair use' })), true);
        assert.equal(imageNeedsConfirmation(normalizeImage({ source: 'link', image_url: 'https://news.example/p.jpg' })), true);
        assert.equal(imageNeedsConfirmation(null), false);
    });

    it('counts an image as Commons only when it is served from Commons with a Commons file page', () => {
        // the author's browser writes the record, so a free license_name alone doesn't skip the check
        assert.equal(imageNeedsConfirmation(normalizeImage({ ...commons, image_url: 'https://news.example/p.jpg' })), true);
        assert.equal(imageNeedsConfirmation(normalizeImage({ ...commons, source_url: 'https://news.example/page' })), true);
        assert.equal(imageNeedsConfirmation(normalizeImage({ ...commons, file_page: null })), true);
    });

    it('treats a caption-only change on the same picture as a real change', () => {
        const before = normalizeImage(commons);
        const changes = changesFor({ ...event(), image_url: commons.image_url, image_preview: { source: 'commons', source_url: commons.source_url, credit: 'Jane Doe', license_name: 'CC BY-SA 4.0', license_url: commons.license_url } },
            { image: { ...commons, caption: 'Fans in Munich' } });
        assert.equal(changes.image.after.caption, 'Fans in Munich');
        assert.equal(changes.image.before.caption, null);
        assert.equal(before.caption, null);
    });
});

describe('approving places and images', () => {
    it('publishes the confirmed image the reviewer gave instead of the proposal', async () => {
        const proposed = normalizeImage({ source: 'link', image_url: 'https://news.example/p.jpg' });
        const e = edit({ image: { before: null, after: proposed } });
        const confirmed = { ...proposed, credit: 'Press Agency', license_name: 'Used with permission' };
        const overlay = await withApproval(null, e, ['image'], AT, { image: confirmed });
        assert.equal(overlay.patches[EVT].image.value.credit, 'Press Agency');
        assert.equal(overlay.patches[EVT].image.chain[0].after.license_name, 'Used with permission');
    });

    it('publishes a new event with its places and image, or without its image', async () => {
        const e = edit({
            name: { before: null, after: 'PSG wins' }, enhanced_time: { before: null, after: 'May 31, 2025' },
            enhanced_description: { before: null, after: 'PSG beat Inter.' },
            ...newEventChanges({ 'location[0]': ARENA, image: commons }),
        }, { kind: 'create' });
        const record = newEventRecord(e);
        assert.equal(record.locations[0].geography.verification, 'community_edit:edt_1@r2');
        assert.equal(record.image_url, commons.image_url);
        assert.equal(record.image_preview.credit, 'Jane Doe');
        const overlay = await withApproval(null, e, Object.keys(e.changes), AT, { image: null });
        assert.equal(overlay.created[EVT].record.image_url, undefined);
        assert.equal(overlay.created[EVT].record.locations.length, 1);
    });

    it('applies a place at its position and removes another, comparing each before any shift', async () => {
        const first = event().locations[0];
        const e = edit({
            'location[0]': { before: normalizeLocation(first), after: null },
            'location[1]': { before: normalizeLocation(event().locations[1]), after: normalizeLocation(ARENA) },
        });
        const overlay = await withApproval(null, e, ['location[0]', 'location[1]'], AT);
        const visitor = event();
        const { patched, stale } = applyOverlay([visitor], overlay);
        assert.deepEqual([patched, stale], [2, []]);
        assert.equal(visitor.locations.length, 1);
        assert.equal(visitor.locations[0].name, 'Allianz Arena');
        assert.equal(visitor.locations[0].geography.status, 'corrected');
        // every page load starts from the data file, so the next visitor gets the same result
        const next = event();
        assert.deepEqual(applyOverlay([next], overlay).stale, []);
        assert.deepEqual(next.locations.map(l => l.name), ['Allianz Arena']);
    });

    it('shows an approved image as released images are shown, and hides one removed', async () => {
        const added = await withApproval(null, edit({ image: { before: null, after: normalizeImage(commons) } }), ['image'], AT);
        const visitor = event();
        applyOverlay([visitor], added);
        assert.equal(visitor.image_url, commons.image_url);
        assert.equal(visitor.image_preview.license_name, 'CC BY-SA 4.0');
        const removed = await withApproval(added, edit({ image: { before: normalizeImage(commons), after: null } }, { edit_id: 'edt_2' }), ['image'], AT);
        const later = event();
        applyOverlay([later], removed);
        assert.equal(later.image_url, undefined);
    });
});

describe('location text', () => {
    it('names each part once, also when the name already carries its city and country', () => {
        assert.equal(locationText(ARENA), 'Allianz Arena, Munich, Germany');
        assert.equal(locationText({ name: 'Rabat, Rabat-Salé-Kénitra, Morocco', city: 'Rabat', region: 'Rabat-Salé-Kénitra', country: 'Morocco' }),
            'Rabat, Rabat-Salé-Kénitra, Morocco');
        assert.equal(locationText({ name: 'Paris', city: 'Paris', country: 'France' }), 'Paris, France');
        assert.equal(locationText(null), '');
    });
});
