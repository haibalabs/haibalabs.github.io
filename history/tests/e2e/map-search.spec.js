import { test, expect } from './cdn-cache.js';
import { stubFirebase } from './firebase-stub.js';

// Map search (map-search/), on for every visitor: typed text finds the events' places, then Wikidata; a place
// opens its events' bubble, and a Wikidata item gets a pin.

const PLACES = [['Paris', [48.85, 2.35]], ['Parma', [44.8, 10.33]]]
    .map(([name, point], index) => ({ index, name, place_id: `plc_${name}`, point, precision: 'settlement', status: 'reviewed' }));
const at = (name, time, place) => ({ event_id: `evt_${name.replace(/\W+/g, '_')}`, event_version: 'v1', name,
    enhanced_time: time, enhanced_description: `${name}.`, categories: ['war'], confidence: 'high', visible: true, wikipedia_url: '',
    locations: [{ name: PLACES[place].name, place, placed: place, placement: 'placed' }] });
const EVENTS = [at('Storming of the Bastille', '1789-07-14', 0), at('Fall of Paris', '1814-03-31', 0), at('Battle of Parma', '1734-06-29', 1)];
const MANIFEST = { format: 'historiline-manifest/v1', release_id: 'search', created_at: '2026-11-12T00:00:00Z',
    shards: [{ id: 'd000', count: EVENTS.length, sha256: 'e0' }],
    places: { buckets: 64, files: [{ bucket: 0, count: PLACES.length, sha256: 'p0' }] }, corrections: { sha256: 'c0' } };
const FILES = {
    'manifest.json': MANIFEST,
    'events/e0.json': { format: 'historiline-events/v1', shard: 'd000', family: 'dated', events: EVENTS },
    'places/p0.json': { format: 'historiline-places/v1', bucket: 0, places: PLACES.map(({ name: _name, ...row }) => row) },
    'corrections/c0.json': [],
};
const PARADISE = { id: 'Q1', labels: { en: { value: 'Paradise' } }, descriptions: { en: { value: 'town in California' } },
    claims: { P625: [{ rank: 'normal', mainsnak: { datavalue: { value: { latitude: 39.76, longitude: -121.62, globe: 'http://www.wikidata.org/entity/Q2' } } } }] } };

test('the map search finds a place with events and a Wikidata place, and opens or pins them', async ({ page }) => {
    await stubFirebase(page);
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod|upload\.wikimedia|thumb\.wikimedia/, r => r.abort());
    await page.route('**/history/data/**', route => {
        const body = FILES[new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '')];
        return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404 });
    });
    await page.route('https://www.wikidata.org/w/api.php?*', route => {
        const action = new URL(route.request().url()).searchParams.get('action');
        return route.fulfill({ json: action === 'wbsearchentities' ? { search: [{ id: 'Q1' }] } : { entities: { Q1: PARADISE } } });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/history/index.html');
    await page.locator('#toggle-map').click();
    const field = page.getByRole('combobox', { name: 'Search places' });
    await expect(field).toBeVisible();

    await expect(page.locator('#timeline-content .event').first()).toBeAttached();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('/');
    await expect(field).toBeFocused();
    await field.fill('par');
    const options = page.getByRole('option');
    // the place with more events first, then Wikidata's
    await expect(options).toHaveText([/Paris\s*2 events/, /Parma\s*1 event/, /Paradise\s*town in California/]);

    await field.press('Enter');
    const bubble = page.locator('.map-event-list');
    await expect(bubble.locator('.map-event-list-title')).toHaveText('Paris');
    await expect(bubble.locator('li')).toHaveCount(2);

    await field.fill('parad');
    await page.getByRole('option', { name: /Paradise/ }).click();
    await expect(page.locator('.map-event-label', { hasText: 'Paradise' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear the search' }).click();
    await expect(page.locator('.map-event-label', { hasText: 'Paradise' })).toHaveCount(0);
});
