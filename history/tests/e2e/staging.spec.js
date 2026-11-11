import { test, expect } from '@playwright/test';
import { firebaseStub } from './firebase-stub.js';

// The staging site (?data=next) loads the published release format and shares the live Firebase project,
// so it must refuse every write (scaling-design.md, moving over, step 5).

const WRITES = ['setDoc', 'updateDoc', 'deleteDoc', 'runTransaction', 'writeBatch', 'uploadBytes', 'deleteObject'];

// The stub, with every write function counting its calls instead of doing nothing.
const countingStub = WRITES.reduce((source, name) => source.replace(
    new RegExp(`export const ${name} = [^\\n]*`),
    name === 'writeBatch'
        ? 'export const writeBatch = () => { globalThis.__firebaseWrites = (globalThis.__firebaseWrites ?? 0) + 1; return { delete: () => {}, commit: async () => {} }; };'
        : `export const ${name} = async () => { globalThis.__firebaseWrites = (globalThis.__firebaseWrites ?? 0) + 1; return {}; };`,
), firebaseStub).replace('export const getAuth = () => ({ currentUser: null });',
    'export const getAuth = () => ({ currentUser: { uid: \'u1\', email: \'editor@example.test\' } });');

const legacy = (status, coordinates) => ({ status, coordinates, precision: 'approximate', verification: 'not_independently_verified' });
const event = (id, name, time, extra = {}) => ({ event_id: id, event_version: `v_${id}`, name, enhanced_time: time,
    enhanced_description: `${name}.`, categories: ['politics'], figures: [], confidence: 'high', visible: true,
    wikipedia_url: '', ...extra });
const RELEASE = {
    'events/e0.json': { format: 'historiline-events/v1', shard: 'd000', family: 'dated', events: [
        event('evt_first', 'First staged event', '1500', { accepted: true,
            locations: [{ name: 'Alpha', city: '', region: '', country: '', historical_name: '', place: 0, placement: 'legacy',
                geography: legacy('reused', [10, 20]) }] }),
    ] },
    'events/e1.json': { format: 'historiline-events/v1', shard: 'd001', family: 'dated', events: [
        event('evt_second', 'Second staged event', '1600', {
            locations: [{ name: 'Bravo', city: '', region: '', country: '', historical_name: '', place: 1, placement: 'placed',
                placed: 2, geography: legacy('reused', [1, 2]) }] }),
    ] },
    'places/p0.json': { format: 'historiline-places/v1', bucket: 0, places: [
        { index: 0, place_id: 'plc_alpha', label: 'Alpha Town, Somewhere' },
        { index: 1, place_id: 'plc_bravo' },
        { index: 2, place_id: 'plc_reviewed', label: 'Reviewed City, Land', status: 'resolved', point: [30, 40],
            precision: 'settlement', verification: 'batch_audit:fixture' },
    ] },
    'corrections/c0.json': [],
};
const MANIFEST = { format: 'historiline-manifest/v1', created_at: '2026-11-10T12:00:00Z',
    shards: [{ id: 'd000', count: 1, sha256: 'e0' }, { id: 'd001', count: 1, sha256: 'e1' }],
    places: { buckets: 64, files: [{ bucket: 0, count: 3, sha256: 'p0' }] }, corrections: { sha256: 'c0' } };

// files: more release files by path, such as a manifest-next.json and the release it was built on
async function openStaging(page, files = {}) {
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: countingStub }));
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod/, r => r.abort());
    const requests = [];
    const served = { ...RELEASE, ...files };
    await page.route('**/history/data/**', route => {
        const url = new URL(route.request().url());
        requests.push({ path: url.pathname, cache: route.request().headers()['cache-control'] ?? null });
        const rel = url.pathname.replace(/^\/history\/data\//, '');
        if (rel === 'manifest.json') return route.fulfill({ json: MANIFEST });
        return served[rel] ? route.fulfill({ json: served[rel] }) : route.fulfill({ status: 404 });
    });
    await page.goto('/history/index.html?data=next');
    await expect(page.locator('#timeline-content .event').first()).toBeVisible();
    return requests;
}

test('the staging site shows the published release, read-only, with its banner', async ({ page }) => {
    const requests = await openStaging(page);
    await expect(page.locator('#timeline-content .event[data-event-id="evt_first"]')).toBeVisible();
    await expect(page.locator('#timeline-content .event[data-event-id="evt_second"]')).toBeVisible();
    // an event of the visibility index is marked accepted, as on the live site
    await expect(page.locator('.event[data-event-id="evt_first"]')).toHaveAttribute('data-confidence', 'accepted');
    // a placed location shows its reviewed place: label and review title
    const placed = page.locator('.event[data-event-id="evt_second"] .event-location');
    await expect(placed).toContainText('Reviewed City, Land');
    await expect(placed).toHaveAttribute('title', /Reviewed location/);
    await expect(page.locator('.event[data-event-id="evt_first"] .event-location')).toContainText('Alpha Town, Somewhere');
    // read-only: a banner on screen, above the fixed header and map, and no editing controls
    const banner = page.locator('#staging-banner');
    await expect(banner).toContainText('Staging, read-only');
    await expect(banner).toBeInViewport();
    const onTop = await banner.evaluate(node => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    });
    expect(onTop).toBe(true);
    await expect(page.locator('.editing-toggle')).toBeHidden();
    await expect(page.locator('#suggest-event')).toBeHidden();
    // the manifest is revalidated on every visit; the hash-named files are not
    expect(requests.find(r => r.path.endsWith('/manifest.json'))).toBeTruthy();
    // a release that names no release it was built on says so and offers no new-events filter
    await expect(banner.locator('.staging-new')).toHaveText('New events can\'t be shown: this release names no release it was built on.');
    await expect(banner.locator('.staging-new-toggle')).toBeHidden();
});

test('the staging banner says when the new events cannot be found, and offers no filter', async ({ page }) => {
    // the release it was built on isn't served
    await openStaging(page, { 'manifest-next.json': { ...MANIFEST, previous_manifest: 'b'.repeat(64) } });
    const line = page.locator('#staging-banner .staging-new');
    await expect(line).toContainText('New events can\'t be shown: Could not load');
    await expect(line.getByRole('button')).toBeHidden();
    await expect(page.locator('#timeline-content .event')).toHaveCount(2);
});

test('the staging banner shows only the events new against the release it was built on, and all again', async ({ page }) => {
    const PARENT = 'a'.repeat(64);
    const files = {
        // the earlier release shares shard e0 by hash and serves evt_second in a shard the staged one replaced
        [`manifests/${PARENT}.json`]: { ...MANIFEST, release_id: 'release-earlier',
            shards: [{ id: 'd000', count: 1, sha256: 'e0' }, { id: 'd001', count: 1, sha256: 'old1' }] },
        'events/old1.json': { format: 'historiline-events/v1', shard: 'd001', family: 'dated',
            events: [event('evt_second', 'Second staged event, as it was', '1600')] },
        'events/new1.json': { format: 'historiline-events/v1', shard: 'd001', family: 'dated', events: [
            event('evt_second', 'Second staged event', '1600'),
            event('evt_new', 'New staged event', '1650'),
            event('evt_new_low', 'New low-confidence event', '1660', { confidence: 'low', visible: false }),
        ] },
        'manifest-next.json': { ...MANIFEST, release_id: 'release-next', previous_manifest: PARENT,
            shards: [{ id: 'd000', count: 1, sha256: 'e0' }, { id: 'd001', count: 3, sha256: 'new1' }] },
    };
    const requests = await openStaging(page, files);
    const line = page.locator('#staging-banner .staging-new');
    const toggle = line.getByRole('button');
    await expect(line).toContainText('New in this release: 1 event (1 more hidden as low confidence).');
    await expect(line).toHaveAttribute('title', 'Events in release release-next that are not in release release-earlier, the release it was built on.');
    const shown = () => page.locator('#timeline-content .event').evaluateAll(cards => cards.map(card => card.dataset.eventId));
    await expect.poll(shown).toEqual(['evt_first', 'evt_second', 'evt_new']);

    await toggle.click();
    await expect(line).toContainText('Showing only the 1 event new in this release (1 more hidden as low confidence).');
    await expect(toggle).toHaveText('Show all events');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(shown).toEqual(['evt_new']);
    await expect(page.locator('#visibleCount')).toHaveText('1');

    await toggle.click();
    await expect(toggle).toHaveText('Show only these');
    await expect.poll(shown).toEqual(['evt_first', 'evt_second', 'evt_new']);
    // of the earlier release only its manifest and the shard the staged one doesn't share were fetched
    const fetched = requests.map(r => r.path.replace('/history/data/', ''));
    expect(fetched.filter(path => path === 'events/e0.json')).toHaveLength(1);
    expect(fetched).toContain('events/old1.json');
});

// Calls every write entry point of the five stores that write to Firebase, and counts the writes that
// reach the (counting) Firebase SDK stub.
async function attemptEveryWrite(page) {
    return page.evaluate(async () => {
        const db = {}, auth = { currentUser: { uid: 'u1', email: 'editor@example.test' } }, app = {};
        const { EditStore } = await import('/history/modules/edit-store.js');
        const { EditUploads } = await import('/history/modules/edit-uploads.js');
        const { ReviewStore } = await import('/history/modules/review-store.js');
        const { TimelineStore } = await import('/history/modules/timeline-store.js');
        const { FirebaseImageStore } = await import('/history/modules/firebase-image-store.js');
        const edits = new EditStore(db, auth), uploads = new EditUploads(app), reviews = new ReviewStore(db, auth);
        const timelines = new TimelineStore(db, auth), images = new FirebaseImageStore(app);
        const edit = { edit_id: 'edit_1', event_id: 'evt_first', status: 'waiting', changes: {}, revision: 1, author_uid: 'u1' };
        const timeline = { id: 'tl_1', title: 'Mine' };
        const blob = new Blob(['x'], { type: 'image/webp' });
        const calls = {
            'EditStore.submit': () => edits.submit({ edit_id: 'edit_1', event_id: 'evt_first', changes: {} }),
            'EditStore.revise': () => edits.revise(edit, { changes: {}, reason: '', sources: [] }),
            'EditStore.withdraw': () => edits.withdraw(edit),
            'EditUploads.upload': () => uploads.upload('u1', 'edit_1', 1, { full: blob, mime: 'image/webp', width: 1, height: 1, sha256: 'a'.repeat(64) }),
            'EditUploads.publish': () => uploads.publish(edit, { path: 'edits/u1/edit_1/1.webp', sha256: 'a'.repeat(64) }),
            'ReviewStore.approve': () => reviews.approve(edit, ['name'], ''),
            'ReviewStore.reject': () => reviews.reject(edit, 'no'),
            'TimelineStore.create': () => timelines.create('Mine'),
            'TimelineStore.rename': () => timelines.rename('tl_1', 'Ours'),
            'TimelineStore.remove': () => timelines.remove(timeline),
            'TimelineStore.saveEvent': () => timelines.saveEvent(timeline, { event_id: 'p1', name: 'Mine', enhanced_time: '2000' }),
            'TimelineStore.deleteEvent': () => timelines.deleteEvent(timeline, 'p1'),
            'FirebaseImageStore.upload': () => images.upload({ kind: 'timeline', id: 'tl_1' }, { full: blob, thumb: blob, mime: 'image/webp' }),
            'FirebaseImageStore.remove': () => images.remove('timelines/tl_1/a.webp'),
        };
        const results = {};
        for (const [name, call] of Object.entries(calls)) {
            try { await call(); results[name] = 'resolved'; } catch (error) { results[name] = error.message; }
        }
        return { results, writes: globalThis.__firebaseWrites ?? 0 };
    });
}

test('the write check reaches Firebase on a page that is not read-only', async ({ page }) => {
    // the control for the next test: the same calls on the live path do write, so zero there means refused
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: countingStub }));
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod/, r => r.abort());
    await page.route('**/staging-control.json', route => route.fulfill({ json: [event('evt_control', 'Control event', '1700')] }));
    await page.goto('/history/index.html?file=staging-control.json');
    await expect(page.locator('#timeline-content .event').first()).toBeVisible();
    const results = await attemptEveryWrite(page);
    expect(results.writes).toBeGreaterThanOrEqual(10);
});

test('every write the site can make is refused on the staging site before it reaches Firebase', async ({ page }) => {
    await openStaging(page);
    const results = await attemptEveryWrite(page);
    expect(results.writes).toBe(0);
    for (const [name, outcome] of Object.entries(results.results)) {
        expect(outcome, name).not.toBe('resolved');
    }
    // the writes that reach the guard are refused with its reason
    expect(Object.values(results.results).filter(outcome => outcome === 'This is the staging site, which is read-only.').length)
        .toBeGreaterThan(0);
});
