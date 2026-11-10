import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLIC_FILES = [
    'history/canonical-t2.json',
    'history/releases/released-images-v1.json',
    'history/releases/released-locations-v1.json',
    'history/releases/released-place-labels-v1.json',
];
const ACCEPTANCE_MODULE = 'history/modules/world-acceptance.js';
const MAX_BYTES = 128 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function expectedPublication(root) {
    const files = [];
    let data;
    for (const name of PUBLIC_FILES) {
        const bytes = await readFile(path.join(root, name));
        assert(bytes.length <= MAX_BYTES, `Expected artifact is too large: ${name}`);
        files.push({ name, sha256: hash(bytes), bytes: bytes.length });
        if (name === PUBLIC_FILES[0]) data = JSON.parse(bytes);
    }
    const index = data.metadata?.event_visibility;
    if (index !== undefined) {
        assert.equal(index.schema_version, 'factory-event-visibility/v1', 'Unsupported visibility schema');
        assert.equal(index.snapshot_id, data.metadata.snapshot_id, 'Visibility snapshot differs');
        assert(Array.isArray(index.records), 'Visibility records are missing');
        assert.equal(new Set(index.records.map(row => row.event_id)).size, index.records.length, 'Repeated indexed event');
        const bytes = await readFile(path.join(root, ACCEPTANCE_MODULE));
        files.push({ name: ACCEPTANCE_MODULE, sha256: hash(bytes), bytes: bytes.length });
    }
    return { files, data, index };
}

async function responseBytes(response) {
    assert(Number(response.headers.get('content-length') ?? 0) <= MAX_BYTES, 'Response exceeds byte ceiling');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        assert(size <= MAX_BYTES, 'Response exceeds byte ceiling');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

export async function observeFiles(files, baseUrl, { fetcher = fetch, timeoutMs = 20000 } = {}) {
    return Promise.all(files.map(async expected => {
        const url = new URL(expected.name, baseUrl).href;
        try {
            const response = await fetcher(url, {
                redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
                headers: { 'Cache-Control': 'no-cache' },
            });
            const bytes = await responseBytes(response);
            const sha256 = hash(bytes);
            return { name: expected.name, url, status: response.status, sha256, bytes: bytes.length,
                expected_sha256: expected.sha256, matches: response.status === 200 && sha256 === expected.sha256 };
        } catch (error) {
            return { name: expected.name, url, matches: false, error: error.message.slice(0, 500) };
        }
    }));
}

export async function waitForPublication(files, baseUrl, {
    maxWaitMs = 300000, intervalMs = 10000, fetcher = fetch, onAttempt = () => {},
} = {}) {
    const deadline = Date.now() + maxWaitMs;
    do {
        const rows = await observeFiles(files, baseUrl, { fetcher, timeoutMs: Math.max(1, Math.min(20000, deadline - Date.now())) });
        onAttempt(rows);
        if (rows.every(row => row.matches)) return rows;
        if (Date.now() >= deadline) break;
        await sleep(Math.min(intervalMs, deadline - Date.now()));
    } while (Date.now() < deadline);
    throw new Error('Deployment hashes did not match the expected commit within the bounded window; deployment may be stale or superseded');
}

export function sampleEvents(data, index) {
    const positions = [...new Set([0, Math.floor(index.records.length / 2), index.records.length - 1])].filter(i => i >= 0);
    return positions.map(i => {
        const row = index.records[i], event = data.events[row.record_index];
        assert(event?.event_id === row.event_id && typeof event.name === 'string' && event.name.trim(), 'Indexed sample binding differs');
        return { event_id: row.event_id, name: event.name };
    });
}

export async function checkBrowser(expected, baseUrl, output, report, { chromium } = {}) {
    chromium ??= (await import('@playwright/test')).chromium;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    report.browser = { requests: 0, blocked_writes: 0, page_errors: [], console_errors: [], samples: [] };
    const info = report.browser;
    await context.route('**/*', route => {
        info.requests++;
        if (!['GET', 'HEAD'].includes(route.request().method())) {
            info.blocked_writes++;
            return route.abort('blockedbyclient');
        }
        return route.fallback();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    page.on('pageerror', error => { if (info.page_errors.length < 20) info.page_errors.push(error.message.slice(0, 500)); });
    page.on('console', message => {
        if (message.type() === 'error' && info.console_errors.length < 20) info.console_errors.push(message.text().slice(0, 500));
    });
    try {
        await page.goto(new URL('history/?file=canonical-t2.json', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const proof = await page.evaluate(async () => {
            const response = await fetch('./canonical-t2.json', { cache: 'no-store' });
            if (!response.ok) throw new Error('Browser canonical fetch failed');
            const bytes = await response.arrayBuffer();
            const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
            const data = JSON.parse(new TextDecoder().decode(bytes));
            const { acceptedEventIds } = await import('./modules/world-acceptance.js');
            return { sha256, accepted: [...await acceptedEventIds(data)] };
        });
        assert.equal(proof.sha256, expected.files[0].sha256, 'Browser loaded another canonical version');
        assert.deepEqual([...proof.accepted].sort(), expected.index.records.map(row => row.event_id).sort(), 'Some indexed records fail deployed acceptance validation');
        info.validated_accepted_ids = proof.accepted;
        for (const event of sampleEvents(expected.data, expected.index)) {
            await page.locator('#searchInput').fill(event.name);
            const card = page.locator(`#timeline-content .event[data-event-id=${JSON.stringify(event.event_id)}]`);
            await card.waitFor({ state: 'visible', timeout: 30000 });
            assert.equal(await card.getAttribute('data-confidence'), 'accepted', 'Search card does not carry verified acceptance');
            assert((await card.innerText()).includes(event.name), 'Rendered event title differs');
            info.samples.push({ ...event, visible: true, confidence: 'accepted' });
        }
    } finally {
        try { await page.screenshot({ path: path.join(output, 'browser.png'), fullPage: false }); }
        finally { await browser.close(); }
    }
}

export async function checkPublication(options) {
    const { expectedRoot, baseUrl, commit, output } = options;
    const url = new URL(baseUrl);
    assert((url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
        && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('/'), 'Use an HTTPS base URL (or an isolated loopback fixture)');
    assert(/^[0-9a-f]{40}$/.test(commit), 'Expected commit must be a full Git SHA');
    await mkdir(output, { recursive: true });
    const report = { schema_version: 'factory-publication-smoke/v1', expected_commit: commit, base_url: baseUrl,
        started_at: new Date().toISOString(), status: 'checking', attempts: [], publication_performed: false };
    try {
        const expected = await expectedPublication(expectedRoot);
        report.expected_files = expected.files;
        await waitForPublication(expected.files, baseUrl, { ...options,
            onAttempt: rows => report.attempts.push({ observed_at: new Date().toISOString(), files: rows }) });
        if (expected.index === undefined) {
            report.status = 'skipped_legacy_visibility';
            report.reason = 'Expected commit has no factory event visibility index; artifact hashes match, accepted-event visibility is not asserted';
        } else if (expected.index.records.length === 0) {
            report.status = 'skipped_empty_visibility';
            report.reason = 'No indexed accepted events to exercise';
        } else {
            await checkBrowser(expected, baseUrl, output, report, options);
            report.final_files = await observeFiles(expected.files, baseUrl, options);
            assert(report.final_files.every(row => row.matches), 'Deployment changed during browser verification');
            report.status = 'passed';
        }
        return report;
    } catch (error) {
        report.status = 'failed'; report.error = error.message.slice(0, 1000);
        throw error;
    } finally {
        report.finished_at = new Date().toISOString();
        await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ status: report.status, report: path.join(output, 'report.json'), error: report.error }));
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const args = process.argv.slice(2), values = {};
    for (let i = 0; i < args.length; i += 2) {
        assert(['--expected-root', '--base-url', '--commit', '--output'].includes(args[i]) && args[i + 1], 'Unknown or incomplete argument');
        assert(!(args[i] in values), 'Repeated argument'); values[args[i]] = args[i + 1];
    }
    await checkPublication({ expectedRoot: path.resolve(values['--expected-root'] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')),
        baseUrl: values['--base-url'] ?? 'https://haibalabs.github.io/', commit: values['--commit'],
        output: path.resolve(values['--output'] ?? 'publication-smoke') });
}
