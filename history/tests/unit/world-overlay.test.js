import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    conflictingFields, emptyOverlay, newEventRecord, overlayBytes, publishedValue, recordSha256, revertChanges,
    withApproval, wordDiff,
} from '../../modules/world-edits.js';
import { applyOverlay, overlayProblem } from '../../modules/world-overlay.js';

const EVT = 'evt_0a1b2c3d-0000-4000-8000-000000000001';
const NEW_EVT = 'evt_0a1b2c3d-0000-4000-8000-0000000000cc';
const AT = '2026-10-31T12:00:00.000Z';
const edit = (id, changes, extra = {}) => ({
    edit_id: `edt_${id}`, kind: 'update', event_id: EVT, event_name: 'Max Schmeling knocks out Joe Louis', revision: 1,
    content_sha256: 'b'.repeat(64), changes, author: { uid: 'editor', email: 'editor@example.test' }, ...extra,
});
const event = () => ({
    event_id: EVT, name: 'Max Schmeling knocks out Joe Louis', enhanced_time: '1936-06-19',
    enhanced_description: 'Schmeling knocks out Louis on June 13, 1936.', figures: ['Max Schmeling'], categories: ['sports'],
});
const approved = (e, fields) => ({ ...e, status: 'published', fields: Object.fromEntries(fields.map(f => [f, { status: 'approved' }])) });

describe('withApproval — publishing an approved edit to the overlay', () => {
    it('creates a patch from the value the author saw, with an anonymous receipt', async () => {
        const e = edit('1', { name: { before: 'Max Schmeling knocks out Joe Louis', after: 'Schmeling defeats Louis' } });
        const overlay = await withApproval(null, e, ['name'], AT);
        assert.equal(overlay.version, 1);
        assert.deepEqual(overlay.patches[EVT].name, {
            base: 'Max Schmeling knocks out Joe Louis', prior_bases: [], value: 'Schmeling defeats Louis',
            chain: [{ edit_id: 'edt_1', revision: 1, approved_at: AT, before: 'Max Schmeling knocks out Joe Louis', after: 'Schmeling defeats Louis' }],
        });
        // the public overlay names edits and times, never the author or the approver
        assert.doesNotMatch(JSON.stringify(overlay), /editor@example\.test|"editor"|approved_by|uid|email/);
    });
    it('publishes only the approved fields', async () => {
        const e = edit('1', { name: { before: 'A', after: 'B' }, enhanced_time: { before: '1936-06-19', after: '1936-06-13' } });
        const overlay = await withApproval(emptyOverlay(), e, ['enhanced_time'], AT);
        assert.deepEqual(Object.keys(overlay.patches[EVT]), ['enhanced_time']);
    });
    it('composes successive approvals of a field into one patch from the dataset value', async () => {
        const first = await withApproval(null, edit('1', { name: { before: 'A', after: 'B' } }), ['name'], AT);
        const second = await withApproval(first, edit('2', { name: { before: 'B', after: 'C' } }), ['name'], AT);
        const patch = second.patches[EVT].name;
        assert.equal(second.version, 2);
        assert.equal(patch.base, 'A');
        assert.equal(patch.value, 'C');
        assert.deepEqual(patch.chain.map(s => [s.edit_id, s.before, s.after]), [['edt_1', 'A', 'B'], ['edt_2', 'B', 'C']]);
        assert.equal(first.patches[EVT].name.value, 'B', 'the earlier overlay is not changed');
    });
    it('records an approval on top of a conflicting one as starting from the published value', async () => {
        const first = await withApproval(null, edit('1', { name: { before: 'A', after: 'B' } }), ['name'], AT);
        const late = edit('2', { name: { before: 'A', after: 'D' } });
        assert.deepEqual(conflictingFields(late, first), ['name']);
        const next = await withApproval(first, late, ['name'], AT);
        assert.deepEqual(next.patches[EVT].name.chain.at(-1), { edit_id: 'edt_2', revision: 1, approved_at: AT, before: 'B', after: 'D' });
    });
    it('publishes a new event whole, once', async () => {
        const create = edit('3', {
            name: { before: null, after: 'Founding of Example Town' }, enhanced_time: { before: null, after: 'May 1, 1820' },
            enhanced_description: { before: null, after: 'The town is incorporated.' },
        }, { kind: 'create', event_id: NEW_EVT });
        const overlay = await withApproval(null, create, ['name'], AT);
        const record = newEventRecord(create);
        assert.deepEqual(overlay.created[NEW_EVT], { record, record_sha256: await recordSha256(record), edit_id: 'edt_3', revision: 1, approved_at: AT });
        assert.equal(record.name, 'Founding of Example Town');
        assert.deepEqual(record.locations, []);
        await assert.rejects(withApproval(overlay, create, [], AT), /already published/);
    });
    it('refuses a field the edit doesn\'t change, and measures the overlay\'s size', async () => {
        await assert.rejects(withApproval(null, edit('1', { name: { before: 'A', after: 'B' } }), ['figures'], AT), /doesn't change/);
        assert.ok(overlayBytes(emptyOverlay()) < 100);
    });
});

describe('conflictingFields and publishedValue — judging an edit against what visitors see', () => {
    it('finds the fields another approval changed since the edit was written', async () => {
        const overlay = await withApproval(null, edit('1', { name: { before: 'A', after: 'B' } }), ['name'], AT);
        assert.deepEqual(conflictingFields(edit('2', { name: { before: 'B', after: 'C' }, enhanced_time: { before: 'x', after: 'y' } }), overlay), []);
        assert.deepEqual(conflictingFields(edit('3', { name: { before: 'A', after: 'C' } }), overlay), ['name']);
        assert.equal(publishedValue(overlay, EVT, 'enhanced_time', 'x'), 'x');
    });
    it('reads a published new event\'s values for later edits to it', async () => {
        const create = edit('3', { name: { before: null, after: 'New' }, enhanced_time: { before: null, after: '1820' },
            enhanced_description: { before: null, after: 'Text.' } }, { kind: 'create', event_id: NEW_EVT });
        const overlay = await withApproval(null, create, [], AT);
        assert.equal(publishedValue(overlay, NEW_EVT, 'name', null), 'New');
        assert.deepEqual(conflictingFields(create, overlay), []);
    });
});

describe('revertChanges — undoing an approval as a new edit', () => {
    it('goes back to the value before the approval, from the value published now', async () => {
        const e1 = edit('1', { name: { before: 'A', after: 'B' } });
        const e2 = edit('2', { name: { before: 'B', after: 'C' } });
        let overlay = await withApproval(null, e1, ['name'], AT);
        overlay = await withApproval(overlay, e2, ['name'], AT);
        assert.deepEqual(revertChanges(approved(e2, ['name']), overlay), { name: { before: 'C', after: 'B' } });
        assert.deepEqual(revertChanges(approved(e1, ['name']), overlay), { name: { before: 'C', after: 'A' } });
        overlay = await withApproval(overlay, edit('4', { name: { before: 'C', after: 'B' } }), ['name'], AT);
        assert.deepEqual(revertChanges(approved(e2, ['name']), overlay), {}, 'nothing left once reverted');
    });
    it('ignores fields that were not approved', async () => {
        const e = edit('1', { name: { before: 'A', after: 'B' }, enhanced_time: { before: '1', after: '2' } });
        const overlay = await withApproval(null, e, ['name'], AT);
        const stored = { ...e, status: 'published', fields: { name: { status: 'approved' }, enhanced_time: { status: 'rejected' } } };
        assert.deepEqual(Object.keys(revertChanges(stored, overlay)), ['name']);
    });
});

describe('applyOverlay — the approved edits on a visitor\'s page', () => {
    it('applies a patch to an event still holding its base, and marks it community edited', async () => {
        const overlay = await withApproval(null, edit('1', {
            enhanced_description: { before: 'Schmeling knocks out Louis on June 13, 1936.', after: 'Schmeling knocks out Louis on June 19, 1936.' },
            figures: { before: [{ name: 'Max Schmeling' }], after: [{ name: 'Max Schmeling' }, { name: 'Joe Louis', wikipedia_url: 'https://en.wikipedia.org/wiki/Joe_Louis' }] },
        }), ['enhanced_description', 'figures'], AT);
        const events = [event()];
        assert.equal(overlayProblem(overlay), null);
        const result = applyOverlay(events, overlay);
        assert.equal(result.patched, 2);
        assert.equal(events[0].enhanced_description, 'Schmeling knocks out Louis on June 19, 1936.');
        assert.equal(events[0].figures[1].wikipedia_url, 'https://en.wikipedia.org/wiki/Joe_Louis');
        assert.equal(events[0].community_edited, true);
    });
    it('moves an event holding an earlier approved value forward, and skips one already folded', async () => {
        let overlay = await withApproval(null, edit('1', { name: { before: 'Max Schmeling knocks out Joe Louis', after: 'B' } }), ['name'], AT);
        overlay = await withApproval(overlay, edit('2', { name: { before: 'B', after: 'C' } }), ['name'], AT);
        const atB = [{ ...event(), name: 'B' }];
        assert.equal(applyOverlay(atB, overlay).patched, 1);
        assert.equal(atB[0].name, 'C');
        const folded = [{ ...event(), name: 'C' }];
        assert.deepEqual(applyOverlay(folded, overlay), { added: [], patched: 0, stale: [] });
        assert.equal(folded[0].community_edited, undefined);
    });
    it('leaves a field the dataset has since changed, and reports it', async () => {
        const overlay = await withApproval(null, edit('1', { name: { before: 'Old name', after: 'New name' } }), ['name'], AT);
        const events = [event()];
        assert.deepEqual(applyOverlay(events, overlay).stale, [{ event_id: EVT, field: 'name' }]);
        assert.equal(events[0].name, 'Max Schmeling knocks out Joe Louis');
    });
    it('adds a published new event once, and lets the dataset win once it holds the event', async () => {
        const create = edit('3', { name: { before: null, after: 'Founding of Example Town' }, enhanced_time: { before: null, after: 'May 1, 1820' },
            enhanced_description: { before: null, after: 'The town is incorporated.' } }, { kind: 'create', event_id: NEW_EVT });
        const overlay = await withApproval(null, create, [], AT);
        const { added } = applyOverlay([event()], overlay);
        assert.equal(added.length, 1);
        assert.equal(added[0].name, 'Founding of Example Town');
        assert.equal(added[0].community_edited, true);
        const holding = [event(), { event_id: NEW_EVT, name: 'Founding of Example Town (folded)' }];
        assert.equal(applyOverlay(holding, overlay).added.length, 0);
    });
    it('refuses an overlay it doesn\'t know', () => {
        assert.match(overlayProblem(null), /not a known version/);
        assert.match(overlayProblem({ version: 1, patches: null, created: {} }), /malformed/);
    });
});

describe('wordDiff — what the review page highlights in a description', () => {
    it('marks only the changed words', () => {
        assert.deepEqual(wordDiff('Knocks out Louis on June 13, 1936.', 'Knocks out Louis on June 19, 1936.'), [
            { kind: 'same', text: 'Knocks out Louis on June ' }, { kind: 'removed', text: '13, ' }, { kind: 'added', text: '19, ' },
            { kind: 'same', text: '1936.' },
        ]);
    });
    it('handles empty sides', () => {
        assert.deepEqual(wordDiff(null, 'New text'), [{ kind: 'added', text: 'New text' }]);
        assert.deepEqual(wordDiff('Old', ''), [{ kind: 'removed', text: 'Old' }]);
    });
});
