import { test, expect } from './cdn-cache.js';
import { stubFirebase } from './firebase-stub.js';

// The character cards lab (lab/characters/, ?lab=characters): a profiled person's name on an event opens their
// card above the timeline with only their events, the card folds as the events scroll, the map shows the places
// in those events, and closing it restores the timeline.

// release place rows: an event's location names one by index, and a placed location takes its point from it
const PLACES = [['Ajaccio', [41.92, 8.74]], ['Paris', [48.85, 2.35]], ['Waterloo', [50.68, 4.41]]]
    .map(([name, point], index) => ({ index, name, place_id: `plc_${name}`, point, precision: 'settlement', status: 'reviewed' }));
const at = (name, time, place) => ({ event_id: `evt_${name.replace(/\W+/g, '_')}`, event_version: 'v1', name,
    enhanced_time: time, enhanced_description: `${name}.`, categories: ['war'], confidence: 'high', visible: true,
    wikipedia_url: '', figures: name.includes('Napoleon') ? ['Napoleon Bonaparte', 'Someone Else'] : ['Someone Else'],
    locations: place === undefined ? [] : [{ name: PLACES[place].name, place, placed: place, placement: 'placed' }] });
const EVENTS = [
    at('Napoleon is born in Corsica', '1769-08-15', 0),
    at('A treaty unrelated to anyone here', '1780'),
    at('Napoleon crowned Emperor', '1804-12-02', 1),
    at('Napoleon defeated at Waterloo', '1815-06-18', 2),
    ...Array.from({ length: 40 }, (_, i) => at(`Later event ${i}`, String(1830 + i))),
];
const MANIFEST = { format: 'historiline-manifest/v1', release_id: 'characters', created_at: '2026-11-12T00:00:00Z',
    shards: [{ id: 'd000', count: EVENTS.length, sha256: 'e0' }],
    places: { buckets: 64, files: [{ bucket: 0, count: PLACES.length, sha256: 'p0' }] }, corrections: { sha256: 'c0' } };
const FILES = {
    'manifest.json': MANIFEST,
    'events/e0.json': { format: 'historiline-events/v1', shard: 'd000', family: 'dated', events: EVENTS },
    'places/p0.json': { format: 'historiline-places/v1', bucket: 0, places: PLACES.map(({ name: _name, ...row }) => row) },
    'corrections/c0.json': [],
};

test('a character\'s name opens their card with only their events, which folds, maps their places and closes', async ({ page }) => {
    await stubFirebase(page);
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod|upload\.wikimedia|thumb\.wikimedia/, r => r.abort());
    await page.route('**/history/data/**', route => {
        const body = FILES[new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '')];
        return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404 });
    });
    await page.goto('/history/index.html?lab=characters');
    const name = page.locator('.figure-mention.is-character', { hasText: 'Napoleon Bonaparte' }).first();
    await expect(name).toBeVisible();
    await expect(page.locator('.figure-mention', { hasText: 'Someone Else' }).first()).not.toHaveClass(/is-character/);

    await name.click();
    const card = page.locator('.character-bar');
    await expect(card.locator('h2')).toHaveText('Napoleon Bonaparte');
    await expect(card.locator('.character-count')).toHaveText('3 events');
    await expect(page.locator('#timeline-content .event')).toHaveCount(3);
    // the name opened the card, not the article
    await expect(page.locator('#info-panel')).not.toHaveClass(/open/);

    await card.locator('[data-action="world"]').click();
    await expect(page.locator('#timeline-content .event.character-other').first()).toBeVisible();
    await page.locator('#timeline-wrapper').evaluate(el => { el.scrollTop = 400; });
    await expect(card).toHaveClass(/folded/);

    await card.locator('[data-action="places"]').click();
    await expect(page.locator('#map-panel')).toHaveClass(/open/);
    await expect(page.locator('.character-stop')).toHaveCount(3);

    await card.locator('[data-action="close"]').click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.character-stop')).toHaveCount(0);
    await expect(page.locator('#timeline-content .event').first()).toBeVisible();
    expect(await page.locator('#timeline-content .event').count()).toBeGreaterThan(3);
});
