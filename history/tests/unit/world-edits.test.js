import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    canonicalJson, changesFor, contentSha256, editorStatus, editProblem, isOpen, newEditId,
    normalizeFigures, normalizeField, normalizeWikipediaUrl, toEditDoc,
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
});
