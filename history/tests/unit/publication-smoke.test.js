import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PUBLIC_FILES, observeFiles, waitForPublication, sampleEvents, checkPublication } from '../check-published.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const file = { name: 'history/canonical-t2.json', sha256: digest('expected') };

test('deployed byte mismatch, HTTP errors and redirects never count as matching', async () => {
    for (const fetcher of [
        async () => new Response('different'),
        async () => new Response('expected', { status: 404 }),
        async (_url, options) => { assert.equal(options.redirect, 'error'); throw new Error('redirect refused'); },
    ]) {
        assert.equal((await observeFiles([file], 'https://example.test/', { fetcher }))[0].matches, false);
    }
});

test('bounded polling can recover propagation delay and fails a superseding artifact', async () => {
    let attempts = 0;
    const rows = await waitForPublication([file], 'https://example.test/', {
        maxWaitMs: 1000, intervalMs: 1,
        fetcher: async () => new Response(++attempts === 1 ? 'old' : 'expected'),
    });
    assert.equal(attempts, 2); assert(rows[0].matches);
    await assert.rejects(waitForPublication([file], 'https://example.test/', {
        maxWaitMs: 5, intervalMs: 1, fetcher: async () => new Response('newer deployment'),
    }), /stale or superseded/);
});

test('response byte ceiling rejects oversized content before reading it', async () => {
    const rows = await observeFiles([file], 'https://example.test/', {
        fetcher: async () => new Response('expected', { headers: { 'Content-Length': String(129 * 1024 * 1024) } }),
    });
    assert.equal(rows[0].matches, false); assert.match(rows[0].error, /byte ceiling/);
});

test('samples bind indexed IDs to exact event positions and names', () => {
    const data = { events: Array.from({ length: 10 }, (_, i) => ({ event_id: `evt_${i}`, name: `Event ${i}` })) };
    const index = { records: data.events.map((event, record_index) => ({ event_id: event.event_id, record_index })) };
    assert.deepEqual(sampleEvents(data, index).map(x => x.event_id), ['evt_0', 'evt_5', 'evt_9']);
    index.records[5].record_index = 4;
    assert.throws(() => sampleEvents(data, index), /binding differs/);
});

async function fixture(t, index) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'publication-smoke-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const canonical = { metadata: { snapshot_id: 'fixture', ...(index === undefined ? {} : { event_visibility: index }) }, events: [] };
    const bodies = new Map();
    for (const name of PUBLIC_FILES) {
        const body = JSON.stringify(name === PUBLIC_FILES[0] ? canonical : { records: [] });
        await mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await writeFile(path.join(root, name), body); bodies.set('/' + name, body);
    }
    return { expectedRoot: root, output: path.join(root, 'output'), baseUrl: 'https://example.test/', commit: 'a'.repeat(40),
        fetcher: async url => new Response(bodies.get(new URL(url).pathname)), maxWaitMs: 20, intervalMs: 1 };
}

test('legacy commit is explicitly skipped after exact artifact checks, not marked verified', async t => {
    const options = await fixture(t);
    const report = await checkPublication(options);
    assert.equal(report.status, 'skipped_legacy_visibility');
    assert.equal(report.browser, undefined);
    assert(report.attempts[0].files.every(x => x.matches));
    assert.equal(JSON.parse(await readFile(path.join(options.output, 'report.json'))).status, report.status);
});

test('malformed visibility index fails and writes an honest failed report', async t => {
    const options = await fixture(t, { schema_version: 'wrong', records: [] });
    await assert.rejects(checkPublication(options), /Unsupported visibility/);
    assert.equal(JSON.parse(await readFile(path.join(options.output, 'report.json'))).status, 'failed');
});
