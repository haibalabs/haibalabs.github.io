import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    canonicalJson, changesFor, contentSha256, editorStatus, editProblem, flagExport, isOpen, newEditId, newEventChanges,
    normalizeFigures, normalizeField, normalizeWikipediaUrl, toEditDoc, toFlagDoc,
} from '../../modules/world-edits.js';

const EVENT = {
    event_id: 'evt_0a1b2c3d-0000-4000-8000-000000000001',
    name: 'Max Schmeling knocks out Joe Louis',
    enhanced_time: '1936-06-19',
    enhanced_description: 'Schmeling knocks out Louis on June 13, 1936.',
    figures: ['Max Schmeling', 'Joe Louis'],
    categories: ['sports'],
    wikipedia_url: 'https://en.wikipedia.org/wiki/Joe_Louis_vs._Max_Schmeling',
};

describe('normalizeWikipediaUrl — one form for an article link', () => {
    it('accepts the forms people paste', () => {
        const cases = [
            ['en.wikipedia.org/wiki/Joe Louis', 'https://en.wikipedia.org/wiki/Joe_Louis'],
            ['http://en.wikipedia.org/wiki/Joe_Louis', 'https://en.wikipedia.org/wiki/Joe_Louis'],
            ['https://en.m.wikipedia.org/wiki/Joe_Louis', 'https://en.wikipedia.org/wiki/Joe_Louis'],
            ['https://de.wikipedia.org/wiki/M%C3%BCnchen', 'https://de.wikipedia.org/wiki/München'],
            [' https://en.wikipedia.org/wiki/Joe_Louis ', 'https://en.wikipedia.org/wiki/Joe_Louis'],
        ];
        for (const [raw, normalized] of cases) assert.equal(normalizeWikipediaUrl(raw), normalized, raw);
    });
    it('keeps "?", "#" and "%" in a title as part of the title, and is stable when repeated', () => {
        const cases = [
            ['https://en.wikipedia.org/wiki/Who%3F', 'https://en.wikipedia.org/wiki/Who%3F'],
            ['https://en.wikipedia.org/wiki/C%23_(programming_language)', 'https://en.wikipedia.org/wiki/C%23_(programming_language)'],
            ['https://en.wikipedia.org/wiki/100%25_Pure', 'https://en.wikipedia.org/wiki/100%25_Pure'],
            ['https://de.wikipedia.org/wiki/M%C3%BCnchen', 'https://de.wikipedia.org/wiki/München'],
            [`https://en.wikipedia.org/wiki/${encodeURIComponent('Who?')}`, 'https://en.wikipedia.org/wiki/Who%3F'],
        ];
        for (const [raw, normalized] of cases) {
            assert.equal(normalizeWikipediaUrl(raw), normalized, raw);
            assert.equal(normalizeWikipediaUrl(normalizeWikipediaUrl(raw)), normalized, `${raw} twice`);
            assert.equal(new URL(normalized).search, '', `${raw} has no query`);
            assert.equal(new URL(normalized).hash, '', `${raw} has no fragment`);
        }
    });
    it('refuses links that are not Wikipedia articles', () => {
        for (const raw of ['', null, 'https://example.com/wiki/X', 'https://en.wikipedia.org/w/index.php?title=X', 'not a url at all']) {
            assert.equal(normalizeWikipediaUrl(raw), null, String(raw));
        }
    });
});

describe('people — legacy names and linked people', () => {
    it('reads a plain name as a person without a link, and equal people compare equal', () => {
        assert.deepEqual(normalizeFigures(['Joe Louis']), [{ name: 'Joe Louis' }]);
        assert.equal(canonicalJson(normalizeFigures(['Joe Louis'])), canonicalJson(normalizeFigures([{ name: 'Joe Louis' }])));
    });
    it('treats linking a person as a real change', () => {
        const changes = changesFor(EVENT, { figures: ['Max Schmeling', { name: 'Joe Louis', wikipedia_url: 'en.wikipedia.org/wiki/Joe Louis' }] });
        assert.deepEqual(changes.figures.after[1], { name: 'Joe Louis', wikipedia_url: 'https://en.wikipedia.org/wiki/Joe_Louis' });
        assert.deepEqual(changes.figures.before, [{ name: 'Max Schmeling' }, { name: 'Joe Louis' }]);
    });
    it('drops empty names', () => {
        assert.deepEqual(normalizeFigures(['  ', { name: '' }, 'Arthur Donovan']), [{ name: 'Arthur Donovan' }]);
    });
});

describe('changesFor — only what changed, with what the author saw', () => {
    it('returns nothing for an unchanged form', () => {
        assert.deepEqual(changesFor(EVENT, {
            name: ` ${EVENT.name} `, enhanced_time: EVENT.enhanced_time, enhanced_description: EVENT.enhanced_description,
            figures: EVENT.figures, categories: ['sports'], wikipedia_url: 'en.wikipedia.org/wiki/Joe Louis vs. Max Schmeling',
        }), {});
    });
    it('records before and after for each changed field', () => {
        const changes = changesFor(EVENT, { enhanced_description: 'Schmeling knocks out Louis on June 19, 1936.', name: EVENT.name });
        assert.deepEqual(Object.keys(changes), ['enhanced_description']);
        assert.equal(changes.enhanced_description.before, EVENT.enhanced_description);
    });
    it('reads a missing value as null', () => {
        assert.equal(normalizeField('wikipedia_url', ''), null);
        assert.deepEqual(changesFor({ ...EVENT, wikipedia_url: null }, { wikipedia_url: '' }), {});
    });
});

describe('editProblem — browser checks before sending', () => {
    const change = (field, after) => ({ [field]: { before: EVENT[field] ?? null, after: normalizeField(field, after) } });
    it('needs at least one change', () => assert.match(editProblem({ changes: {} }), /Change at least one field/));
    it('rejects a date the timeline cannot place', () => assert.match(editProblem({ changes: change('enhanced_time', 'sometime') }), /not a date/));
    it('accepts a valid date', () => assert.equal(editProblem({ changes: change('enhanced_time', 'June 19, 1936') }), null));
    it('rejects HTML', () => assert.match(editProblem({ changes: change('enhanced_description', 'A <b>bold</b> claim') }), /plain text/));
    it('rejects a link that is not a Wikipedia article', () =>
        assert.match(editProblem({ changes: change('wikipedia_url', 'https://example.com/x') }), /Wikipedia article/));
    it('allows removing the Wikipedia link', () => assert.equal(editProblem({ changes: change('wikipedia_url', '') }), null));
    it('keeps the note and sources optional, with limits', () => {
        const changes = change('name', 'Schmeling defeats Louis');
        assert.equal(editProblem({ changes }), null);
        assert.match(editProblem({ changes, reason: 'x'.repeat(1001) }), /note/);
        assert.match(editProblem({ changes, sources: ['ftp://x'] }), /http/);
        assert.match(editProblem({ changes, sources: Array(6).fill('https://a.org') }), /at most 5/);
    });
});

describe('a new event — the same form, empty', () => {
    const values = {
        name: ' Founding of Example Town ', enhanced_time: 'May 1, 1820', enhanced_description: 'The town is incorporated.',
        figures: [], categories: [], wikipedia_url: '',
    };
    it('proposes every filled field with nothing before it', () => {
        assert.deepEqual(newEventChanges(values), {
            name: { before: null, after: 'Founding of Example Town' },
            enhanced_time: { before: null, after: 'May 1, 1820' },
            enhanced_description: { before: null, after: 'The town is incorporated.' },
        });
        const more = newEventChanges({ ...values, figures: [{ name: 'Ann Lee' }], categories: ['politics'] });
        assert.deepEqual(more.figures, { before: null, after: [{ name: 'Ann Lee' }] });
        assert.deepEqual(more.categories, { before: null, after: ['politics'] });
    });
    it('needs a name, a date and a description', () => {
        assert.equal(editProblem({ kind: 'create', changes: newEventChanges(values) }), null);
        assert.match(editProblem({ kind: 'create', changes: newEventChanges({ ...values, name: '' }) }), /needs a name/);
        assert.match(editProblem({ kind: 'create', changes: newEventChanges({ ...values, enhanced_time: '' }) }), /needs a date/);
        assert.match(editProblem({ kind: 'create', changes: newEventChanges({ ...values, enhanced_description: ' ' }) }), /needs a description/);
        assert.match(editProblem({ kind: 'create', changes: {} }), /needs a name/);
    });
    it('checks the filled fields like any edit', () => {
        assert.match(editProblem({ kind: 'create', changes: newEventChanges({ ...values, enhanced_time: 'sometime' }) }), /not a date/);
    });
});

describe('contentSha256 — the same content always hashes the same', () => {
    it('ignores key order and changes with content', async () => {
        const a = await contentSha256({ changes: { name: { before: 'A', after: 'B' } }, reason: '', sources: [] });
        const b = await contentSha256({ sources: [], reason: '', changes: { name: { after: 'B', before: 'A' } } });
        const c = await contentSha256({ changes: { name: { before: 'A', after: 'C' } } });
        assert.equal(a, b);
        assert.notEqual(a, c);
        assert.match(a, /^[0-9a-f]{64}$/);
    });
});

describe('editor statuses — four, whatever the internal state', () => {
    it('maps every internal state', () => {
        const cases = {
            submitted: 'waiting', flagged: 'waiting', ready: 'waiting', conflict: 'waiting',
            auto_rejected: 'rejected', sent_back: 'rejected', rejected: 'rejected',
            approved: 'accepted', published: 'accepted', merged: 'published', withdrawn: 'withdrawn',
        };
        for (const [status, shown] of Object.entries(cases)) assert.equal(editorStatus({ status }), shown, status);
    });
    it('lets the author revise waiting and rejected edits only', () => {
        assert.equal(isOpen({ status: 'ready' }), true);
        assert.equal(isOpen({ status: 'rejected' }), true);
        assert.equal(isOpen({ status: 'published' }), false);
        assert.equal(isOpen({ status: 'withdrawn' }), false);
    });
});

describe('toEditDoc — the stored edit', () => {
    it('starts as revision 1, submitted, with no review fields', async () => {
        const changes = changesFor(EVENT, { name: 'Schmeling defeats Louis' });
        const doc = toEditDoc({
            editId: newEditId(), event: EVENT, changes, reason: '', sources: [], sourceConflict: false,
            author: { uid: 'u1', email: 'e@x.org' }, datasetSha256: 'abc', contentSha: await contentSha256({ changes }), browserChecks: [],
        });
        assert.match(doc.edit_id, /^edt_[0-9a-f-]{36}$/);
        assert.equal(doc.status, 'submitted');
        assert.equal(doc.revision, 1);
        assert.equal(doc.event_id, EVENT.event_id);
        for (const key of ['review', 'fields', 'published', 'merged']) assert.equal(key in doc, false, key);
    });
    it('stores a new event as a create edit under its own new ID', async () => {
        const changes = newEventChanges({ name: 'Founding of Example Town', enhanced_time: '1820', enhanced_description: 'Incorporated.' });
        const doc = toEditDoc({
            editId: newEditId(), kind: 'create', event: { event_id: 'evt_0a1b2c3d-0000-4000-8000-0000000000cc', name: 'Founding of Example Town' },
            changes, reason: '', sources: [], sourceConflict: false, author: { uid: 'u1', email: 'e@x.org' },
            datasetSha256: 'abc', contentSha: await contentSha256({ changes }), browserChecks: [],
        });
        assert.equal(doc.kind, 'create');
        assert.equal(doc.event_id, 'evt_0a1b2c3d-0000-4000-8000-0000000000cc');
        assert.equal(doc.event_name, 'Founding of Example Town');
    });
});

describe('quick flags — what was flagged and what the editor saw', () => {
    const author = { uid: 'u1', email: 'editor@example.test' };
    const event = { ...EVENT, image_url: 'https://upload.wikimedia.org/a.jpg', locations: [{ name: 'Yankee Stadium', city: 'New York', country: 'United States' }] };

    it('keeps the chosen parts in menu order with what each showed, and changes no field', () => {
        const doc = toFlagDoc({ editId: 'edt_x', event, parts: ['article', 'image', 'location', 'entities'], note: '  wrong fight  ', author, datasetSha256: 'a'.repeat(64) });
        assert.equal(doc.kind, 'flag');
        assert.equal(doc.status, 'open');
        assert.equal('changes' in doc, false);
        assert.deepEqual(doc.flag.parts, ['image', 'location', 'entities', 'article']);
        assert.deepEqual(doc.flag.seen, {
            image: 'https://upload.wikimedia.org/a.jpg',
            location: ['Yankee Stadium, New York, United States'],
            entities: ['Max Schmeling', 'Joe Louis'],
            article: 'https://en.wikipedia.org/wiki/Joe_Louis_vs._Max_Schmeling',
        });
        assert.equal(doc.flag.note, 'wrong fight');
        assert.equal(editorStatus(doc), 'waiting');
    });

    it('records a missing value as null and caps the note', () => {
        const doc = toFlagDoc({ editId: 'edt_x', event: { ...EVENT, wikipedia_url: undefined }, parts: ['article', 'date'], note: 'x'.repeat(400), author });
        assert.deepEqual(doc.flag.seen, { article: null, date: '1936-06-19' });
        assert.equal(doc.flag.note.length, 280);
    });

    it('records the published release it was made on, for flags, edits and the export', () => {
        const release = 'c'.repeat(64);
        const flag = toFlagDoc({ editId: 'edt_r', event, parts: ['entities'], author, datasetSha256: null, releaseManifestSha256: release });
        assert.deepEqual(flag.dataset, { id: 'world-history', sha256: null, release_manifest_sha256: release, locations_release_sha256: null });
        const edit = toEditDoc({ editId: 'edt_s', event, changes: {}, reason: '', sources: [], sourceConflict: false, author,
            datasetSha256: null, releaseManifestSha256: release, contentSha: 'b'.repeat(64), browserChecks: [] });
        assert.equal(edit.dataset.release_manifest_sha256, release);
        const [exported] = flagExport([{ ...flag, created_at: null }], '2026-11-15T12:00:00.000Z').flags;
        assert.equal(exported.release_manifest_sha256, release);
        // a data file opened with ?file= has its own hash and no release
        assert.equal(toFlagDoc({ editId: 'edt_t', event, parts: ['date'], author, datasetSha256: 'a'.repeat(64) }).dataset.release_manifest_sha256, null);
    });

    it('exports only open flags, with the owners of their parts', () => {
        const open = { ...toFlagDoc({ editId: 'edt_a', event, parts: ['image', 'date'], author }), created_at: null };
        const fixed = { ...toFlagDoc({ editId: 'edt_b', event, parts: ['article'], author }), status: 'fixed' };
        const edit = toEditDoc({ editId: 'edt_c', event, changes: {}, reason: '', sources: [], sourceConflict: false, author, contentSha: 'b'.repeat(64), browserChecks: [] });
        const file = flagExport([open, fixed, edit], '2026-11-13T12:00:00.000Z');
        assert.equal(file.format, 'historiline-flags/v1');
        assert.deepEqual(file.flags.map(f => [f.edit_id, f.parts, f.owners]), [['edt_a', ['image', 'date'], ['Iris', 'Atlas']]]);
    });
});
