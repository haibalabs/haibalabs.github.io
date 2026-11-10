import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { eventSortableValue, eventTiebreak, eventYear } from '../../modules/date-handlers.js';

const SCRIPT = fileURLToPath(new URL('../../tools/sort-keys.mjs', import.meta.url));
const run = (input, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' });

const EVENTS = [
    { enhanced_time: '1066-10-14' },
    { enhanced_time: '44 BCE' },
    { enhanced_time: 'c. 3200 BCE' },
    { enhanced_time: '4 billion years ago', sort_years_ago: 4e9, sort_tiebreak: 2 },
    { enhanced_time: '' },
    { enhanced_time: 'no date at all' },
];

test('the bridge returns the site\'s own keys, one line per event, in input order', () => {
    const input = EVENTS.map((event, i) => JSON.stringify({ event_id: `evt_${i}`, event_version: `v${i}`, event })).join('\n') + '\n';
    const result = run(input);
    assert.equal(result.status, 0, result.stderr);
    const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, EVENTS.length);
    rows.forEach((row, i) => {
        assert.equal(row.event_id, `evt_${i}`);
        assert.equal(row.event_version, `v${i}`);
        for (const [key, helper] of [['year', eventYear], ['sortable', eventSortableValue], ['tiebreak', eventTiebreak]]) {
            const expected = helper(EVENTS[i]);
            assert.deepEqual(row[key], Number.isFinite(expected) ? { finite: true, value: expected } : { finite: false }, `${key} of event ${i}`);
        }
    });
});

test('a value the date code cannot place comes back tagged, never as null or zero', () => {
    // an empty date has no year or sortable value; an unrecognized one is placed by the site at year 0
    const result = run(JSON.stringify({ event_id: 'evt_x', event: { enhanced_time: '' } }) + '\n');
    const row = JSON.parse(result.stdout);
    assert.deepEqual(row.year, { finite: false });
    assert.deepEqual(row.sortable, { finite: false });
    assert.deepEqual(row.tiebreak, { finite: true, value: 0 });
    assert.equal(row.event_version, null);
});

test('the date code\'s warnings never reach the output lines', () => {
    const result = run(JSON.stringify({ event_id: 'evt_odd', event: { enhanced_time: 'no date at all' } }) + '\n');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.equal(JSON.parse(result.stdout).event_id, 'evt_odd');
    assert.match(result.stderr, /Unrecognized date format/);
});

test('a malformed line fails the run with its line number', () => {
    const result = run(JSON.stringify({ event_id: 'evt_ok', event: { enhanced_time: '1900' } }) + '\nnot json\n');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /line 2: not JSON/);
    const missing = run(JSON.stringify({ event: { enhanced_time: '1900' } }) + '\n');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /line 1: needs event_id and event/);
});

test('--describe names the Node version and hashes every file the keys depend on', () => {
    const result = run('', ['--describe']);
    assert.equal(result.status, 0, result.stderr);
    const description = JSON.parse(result.stdout);
    assert.equal(description.node, process.version);
    assert.deepEqual(Object.keys(description.files).sort(), ['modules/date-handlers.js', 'tools/sort-keys.mjs']);
    for (const hash of Object.values(description.files)) assert.match(hash, /^[0-9a-f]{64}$/);
});
