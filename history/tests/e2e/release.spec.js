import { test, expect } from './cdn-cache.js';
import { createHash } from 'node:crypto';
import { firebaseStub } from './firebase-stub.js';

// The live release (world-release.js): the site loads the release world_release/current names, or the
// committed one; an admin makes the staging release live with one button (release-ui.js).

// The stub, with documents read from globalThis.__docs by path, the signed-in user from globalThis.__user,
// and transaction writes recorded in globalThis.__writes.
const stub = firebaseStub
    .replace('export const doc = () => ({});', 'export const doc = (db, ...path) => ({ path: path.join(\'/\') });')
    .replace('export const getDoc = async () => ({ exists: () => false, data: () => undefined });',
        'const snapOf = (path) => { const data = globalThis.__docs?.[path]; return { exists: () => data !== undefined, data: () => structuredClone(data) }; };\n'
        + 'export const getDoc = async (ref) => snapOf(ref.path);')
    .replace('export const runTransaction = async () => null;',
        'export const runTransaction = async (db, fn) => fn({ get: async (ref) => snapOf(ref.path), set: (ref, data) => { globalThis.__writes.push({ path: ref.path, data }); } });')
    .replace('export const serverTimestamp = () => 0;', 'export const serverTimestamp = () => \'SERVER_TIME\';')
    .replace('export const onAuthStateChanged = (auth, callback) => { queueMicrotask(() => callback(null)); return () => {}; };',
        'export const onAuthStateChanged = (auth, callback) => { queueMicrotask(() => callback(globalThis.__user ?? null)); return () => {}; };');

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const event = (id, name) => ({ event_id: id, event_version: `v_${id}`, name, enhanced_time: '1700', enhanced_description: `${name}.`,
    categories: ['politics'], figures: [], confidence: 'high', visible: true, wikipedia_url: '', locations: [] });
const shard = (file, events) => [file, JSON.stringify({ format: 'historiline-events/v1', shard: 'd000', family: 'dated', events })];
const manifest = (releaseId, shardSha) => JSON.stringify({ format: 'historiline-manifest/v1', release_id: releaseId,
    created_at: '2026-11-10T12:00:00Z', shards: [{ id: 'd000', count: 1, sha256: shardSha }],
    places: { buckets: 64, files: [{ bucket: 0, count: 0, sha256: 'p0' }] }, corrections: { sha256: 'c0' } });
const COMMITTED = manifest('release-a', 'ea'), NEXT = manifest('release-b', 'eb');
const A = sha256(COMMITTED), B = sha256(NEXT);
const FILES = Object.fromEntries([
    ['manifest.json', COMMITTED], ['manifest-next.json', NEXT], [`manifests/${A}.json`, COMMITTED], [`manifests/${B}.json`, NEXT],
    shard('events/ea.json', [event('evt_a', 'Release A event')]),
    shard('events/eb.json', [{ ...event('evt_b', 'Release B event'), figures: ['Nobody Such Person'] }]),
    ['places/p0.json', JSON.stringify({ format: 'historiline-places/v1', bucket: 0, places: [] })], ['corrections/c0.json', '[]'],
]);
const admin = { uid: 'u1', email: 'admin@example.test' };
const liveDoc = (version, manifestSha, releaseId) => ({ version, manifest_sha256: manifestSha, release_id: releaseId,
    previous_manifest_sha256: null, updated_at: 'SERVER_TIME' });

async function open(page, query, { docs = {}, user = null } = {}) {
    await page.addInitScript(([docs, user]) => { globalThis.__docs = docs; globalThis.__user = user; globalThis.__writes = []; }, [docs, user]);
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: stub }));
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod/, r => r.abort());
    await page.route('**/history/data/**', route => {
        const body = FILES[new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '')];
        return body === undefined ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'application/json', body });
    });
    await page.goto(`/history/index.html${query}`);
    await expect(page.locator('#timeline-content .event').first()).toBeVisible();
}
const shows = (page, id) => expect(page.locator(`#timeline-content .event[data-event-id="${id}"]`)).toBeVisible();

test('with no live release named, the site loads the committed one, without page errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page, '');
    await shows(page, 'evt_a');
    expect(errors).toEqual([]);
});

test('the site loads the release Firestore names as live, names it in the footer, and offers a search for a person with no article', async ({ page }) => {
    await open(page, '', { docs: { 'world_release/current': liveDoc(1, B, 'release-b') } });
    await shows(page, 'evt_b');
    await expect(page.locator('#releaseInfo')).toHaveText(` · release release-b (${B.slice(0, 8)})`);
    // the person's name is only a guess at an article title; Wikipedia has no such page
    await page.route('https://en.wikipedia.org/w/api.php**', route => route.fulfill({ json: { error: { code: 'missingtitle' } } }));
    await page.locator('.figure-mention', { hasText: 'Nobody Such Person' }).click();
    const search = page.frameLocator('#info-frame').locator('a.wiki-search');
    await expect(search).toHaveText('Search Wikipedia for “Nobody Such Person”');
    await expect(search).toHaveAttribute('href', /[?&]search=Nobody%20Such%20Person&/);
    await expect(page.frameLocator('#info-frame').locator('body')).not.toContainText('Content unavailable');
    // offline is not a missing article: the usual error, no search
    await page.unroute('https://en.wikipedia.org/w/api.php**');
    await page.route('https://en.wikipedia.org/w/api.php**', route => route.abort());
    await page.locator('.figure-mention', { hasText: 'Nobody Such Person' }).click();
    await expect(page.frameLocator('#info-frame').locator('body')).toContainText('Content unavailable');
});

test('a named release the site can\'t load falls back to the committed one', async ({ page }) => {
    await open(page, '', { docs: { 'world_release/current': liveDoc(1, 'f'.repeat(64), 'missing') } });
    await shows(page, 'evt_a');
});

test('an admin makes the staging release live with one button, after confirming; cancelling writes nothing', async ({ page }) => {
    await open(page, '?data=next', { user: admin, docs: { 'users/u1': { role: 'admin' }, 'world_release/current': liveDoc(1, A, 'release-a') } });
    const banner = page.locator('#staging-banner');
    await expect(banner).toContainText(`Live now: release release-a (${A.slice(0, 12)}).`);
    await banner.getByRole('button', { name: 'Make this live' }).click();
    await banner.getByRole('button', { name: 'Cancel' }).click();
    await expect(banner.getByRole('button', { name: 'Make this live' })).toBeVisible();
    await banner.getByRole('button', { name: 'Make this live' }).click();
    await expect(banner).toContainText('Make release release-b live for every visitor?');
    expect(await page.evaluate(() => globalThis.__writes.length)).toBe(0);
    await banner.getByRole('button', { name: 'Make it live' }).click();
    await expect(banner.getByRole('status')).toContainText('Release release-b is live.');
    await expect(banner).toContainText('This release is live.');
    await expect(banner.getByRole('button', { name: 'Make this live' })).toBeHidden();
    expect(await page.evaluate(() => globalThis.__writes)).toEqual([{ path: 'world_release/current', data: {
        version: 2, manifest_sha256: B, release_id: 'release-b', previous_manifest_sha256: A, updated_at: 'SERVER_TIME' } }]);
});
