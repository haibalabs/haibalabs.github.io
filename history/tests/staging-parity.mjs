// The staging comparison (scaling-design.md, moving over, steps 4 and 5): loads the site from today's data
// files and from the published release (?data=next), then compares every world event as the app holds it in
// memory. That covers display order, fields, visibility, accepted marks, images, each location's geography,
// place ID and label, and the map points. Zero differences are required, apart from the store-only
// provenance fields the published format doesn't serve.
//
// A deployed site, with live Firebase reads (both pages are read-only to the harness):
//   node tests/staging-parity.mjs --base-url https://haibalabs.github.io/ --out <dir>
// A local build, with Firebase stubbed and an optional frozen world_overlay document:
//   node tests/staging-parity.mjs --root <repo root> --data <published history/data dir> --port <n> --out <dir> [--overlay <json>]
//
// The harness reads the app's state by patching script.js in its own browser only; the site has no test hook.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fields inside a placed location's geography that the format keeps in the store (shard-format.md)
const STORE_ONLY_GEOGRAPHY = ['coordinate_source', 'correction_source', 'candidates', 'evidence', 'review_sha256', 'role',
    'semantic_limit', 'uncertainty'];

function options(argv) {
    const values = {};
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i].startsWith('--')) values[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    }
    return values;
}

// key order is not meaningful: the published files sort their keys
const canonical = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v));

function serve(root, port) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    return http.createServer((request, response) => {
        let file = decodeURIComponent(new URL(request.url, 'http://local').pathname);
        if (file.endsWith('/')) file += 'index.html';
        const target = path.join(root, file);
        if (!target.startsWith(root)) { response.writeHead(403); response.end(); return; }
        fs.readFile(target, (error, data) => {
            if (error) { response.writeHead(404); response.end(); return; }
            response.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream' });
            response.end(data);
        });
    }).listen(Number(port), '127.0.0.1');
}

async function snapshot(browser, { base, query, scriptSource, stub, dataDir }) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    if (stub) await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: stub }));
    await page.route('**/history/script.js', async route => {
        const source = (scriptSource ?? await (await route.fetch()).text())
            .replace('const eventManager = new EventManager(locationVerifier);', 'const eventManager = new EventManager(locationVerifier); window.__parity = { eventManager };')
            .replace('uiManager.timelineUI.worldReady();', 'uiManager.timelineUI.worldReady(); window.__parity.ready = true;');
        await route.fulfill({ contentType: 'text/javascript', body: source });
    });
    if (dataDir) {
        await page.route('**/history/data/**', route => {
            const file = path.join(dataDir, new URL(route.request().url()).pathname.replace(/^\/history\/data\//, ''));
            return fs.existsSync(file) ? route.fulfill({ path: file, contentType: 'application/json' }) : route.fulfill({ status: 404 });
        });
    }
    const started = Date.now();
    await page.goto(new URL(`history/index.html${query}`, base).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__parity?.ready === true, null, { timeout: 180000 });
    const loadMs = Date.now() - started;
    const state = await page.evaluate(async (storeOnly) => {
        const { eventManager } = window.__parity;
        const { placeLabel } = await import(new URL('modules/world-labels.js', location.href).href);
        const { PlaceEventIndex } = await import(new URL('modules/place-event-index.js', location.href).href);
        const skip = new Set(storeOnly);
        const world = eventManager.events.filter(event => !event.personal);
        const index = new PlaceEventIndex(world);
        const pick = (object, keys) => Object.fromEntries(keys.filter(key => object[key] !== undefined).map(key => [key, object[key]]));
        // display order: the events stay in load order, and sortedIndices orders them for the timeline
        const order = eventManager.sortedIndices.map(entry => eventManager.events[entry.index].event_id);
        const events = world.map(event => ({
            ...pick(event, ['event_id', 'name', 'enhanced_time', 'enhanced_description', 'categories', 'figures', 'confidence',
                'wikipedia_url', 'sort_years_ago', 'sort_tiebreak', 'image_url', 'image_preview']),
            accepted: eventManager.isAcceptedWorldEvent(event),
            visible: eventManager.isVisibleEvent(event),
            locations: (event.locations ?? []).map(location => ({
                ...pick(location, ['name', 'city', 'region', 'country', 'historical_name', 'corrected', 'verified', 'role', 'place_id']),
                geography: location.geography
                    ? Object.fromEntries(Object.entries(location.geography).filter(([key]) => !skip.has(key))) : null,
                label: placeLabel(location) === undefined ? '(written name)' : placeLabel(location),
            })),
            points: (index.eventPoints.get(index.idFor(event)) ?? []).map(p => [p.placeId, p.coordinates, p.precision, p.reviewed]),
        }));
        return { order, events };
    }, STORE_ONLY_GEOGRAPHY);
    await page.close();
    return { ...state, errors, loadMs };
}

function compare(old, next) {
    const report = { count: [old.events.length, next.events.length], order_differences: 0, field_differences: {}, examples: [] };
    old.order.forEach((id, i) => { if (next.order[i] !== id) report.order_differences += 1; });
    const byId = new Map(next.events.map(event => [event.event_id, event]));
    for (const event of old.events) {
        const other = byId.get(event.event_id);
        if (!other) { report.field_differences.missing = (report.field_differences.missing ?? 0) + 1; continue; }
        for (const key of new Set([...Object.keys(event), ...Object.keys(other)])) {
            if (canonical(event[key]) === canonical(other[key])) continue;
            report.field_differences[key] = (report.field_differences[key] ?? 0) + 1;
            if (report.examples.length < 25) report.examples.push({ event_id: event.event_id, key, old: event[key], next: other[key] });
        }
    }
    report.identical = report.count[0] === report.count[1] && report.order_differences === 0
        && Object.keys(report.field_differences).length === 0;
    return report;
}

async function main() {
    const args = options(process.argv.slice(2));
    if (!args.out || !(args['base-url'] || (args.root && args.data && args.port))) {
        console.error('Usage: --base-url <site> --out <dir>, or --root <repo> --data <dir> --port <n> --out <dir> [--overlay <json>]');
        process.exit(2);
    }
    fs.mkdirSync(args.out, { recursive: true });
    let server = null, stub = null, scriptSource = null, base = args['base-url'];
    if (!base) {
        const root = path.resolve(args.root);
        server = serve(root, args.port);
        base = `http://127.0.0.1:${args.port}/`;
        scriptSource = fs.readFileSync(path.join(root, 'history/script.js'), 'utf8');
        ({ firebaseStub: stub } = await import(new URL('./e2e/firebase-stub.js', import.meta.url).href));
        if (args.overlay) {
            const overlay = fs.readFileSync(args.overlay, 'utf8');
            stub = stub.replace('export const getDoc = async () => ({ exists: () => false, data: () => undefined });',
                `const OVERLAY = ${overlay};\nexport const getDoc = async () => ({ exists: () => true, data: () => structuredClone(OVERLAY) });`);
        }
    }
    const browser = await chromium.launch({ headless: true });
    try {
        const shared = { base, stub, scriptSource };
        const old = await snapshot(browser, { ...shared, query: '' });
        const next = await snapshot(browser, { ...shared, query: '?data=next', dataDir: args.data ? path.resolve(args.data) : null });
        const report = { base_url: base, overlay: args.overlay ?? (args['base-url'] ? 'live' : null),
            load_ms: { old: old.loadMs, next: next.loadMs }, errors: { old: old.errors.slice(0, 10), next: next.errors.slice(0, 10) },
            ...compare(old, next) };
        fs.writeFileSync(path.join(args.out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
        console.log(JSON.stringify({ identical: report.identical, count: report.count, order_differences: report.order_differences,
            field_differences: report.field_differences, load_ms: report.load_ms }));
        process.exitCode = report.identical ? 0 : 1;
    } finally {
        await browser.close();
        server?.close();
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
