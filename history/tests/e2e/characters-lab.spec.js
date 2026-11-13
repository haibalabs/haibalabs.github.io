import { readFileSync } from 'node:fs';
import { test, expect } from './cdn-cache.js';
import { stubFirebase } from './firebase-stub.js';

// The character cards lab (lab/characters/, ?lab=characters): a profiled person's name on an event opens their
// card above the timeline with all their events, the card folds as the events scroll, the map shows those events
// with the site's own dots, and closing it puts the timeline back where it was.

// the map's dots and bubbles load Supercluster from unpkg; the test serves the same version from node_modules
const SUPERCLUSTER = readFileSync(new URL('../../node_modules/supercluster/dist/supercluster.min.js', import.meta.url), 'utf8');

// release place rows: an event's location names one by index, and a placed location takes its point from it
const PLACES = [['Ajaccio', [41.92, 8.74]], ['Paris', [48.85, 2.35]], ['Waterloo', [50.68, 4.41]]]
    .map(([name, point], index) => ({ index, name, place_id: `plc_${name}`, point, precision: 'settlement', status: 'resolved' }));
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
    at('Napoleon remembered in a later century', '1849-06-01'),
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
    await page.route('**/unpkg.com/supercluster@8.0.1/**', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: SUPERCLUSTER }));
    await page.goto('/history/index.html?lab=characters');
    await expect(page.locator('.figure-mention', { hasText: 'Someone Else' }).first()).not.toHaveClass(/is-character/);
    // found through a search, the name opens the card with all of the person's events, the search set aside
    await page.fill('#searchInput', 'Waterloo');
    await expect(page.locator('#timeline-content .event')).toHaveCount(1);
    await page.locator('.figure-mention.is-character', { hasText: 'Napoleon Bonaparte' }).click();
    const card = page.locator('.character-bar');
    await expect(card.locator('h2')).toHaveText('Napoleon Bonaparte');
    await expect(card.locator('.character-life')).toHaveText([/^Born 15 August 1769, Ajaccio/, /^Died 5 May 1821, Longwood/]);
    await expect(page.locator('#timeline-content .event')).toHaveCount(4);
    await expect(page.locator('#searchInput')).toHaveValue('');
    // the name opened the card, not the article
    await expect(page.locator('#info-panel')).not.toHaveClass(/open/);

    await page.locator('#timeline-wrapper').evaluate(el => { el.scrollTop = 400; });
    await expect(card).toHaveClass(/folded/);

    // the map shows the person's events as the site's dots, and a dot selects its event
    await card.locator('[data-action="places"]').click();
    await expect(page.locator('#map-panel')).toHaveClass(/open/);
    await expect(page.locator('.map-cluster-dot')).toHaveCount(3);
    await page.locator('.map-cluster-dot[title="Napoleon crowned Emperor"]').click();
    await expect(page.locator('.map-event-label strong')).toHaveText('Napoleon crowned Emperor');

    // closing puts the timeline back as it was, search included
    await card.locator('[data-action="close"]').click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.map-cluster-dot')).toHaveCount(0);
    await expect(page.locator('#searchInput')).toHaveValue('Waterloo');
    await expect(page.locator('#timeline-content .event')).toHaveCount(1);
});

test('a character\'s card opened deep in the timeline shows their first events, and closing returns there', async ({ page }) => {
    await stubFirebase(page);
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod|upload\.wikimedia|thumb\.wikimedia/, r => r.abort());
    await page.route('**/history/data/**', route => {
        const body = FILES[new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '')];
        return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404 });
    });
    await page.goto('/history/index.html?lab=characters');
    const top = () => page.evaluate(() => {
        const wrapper = document.getElementById('timeline-wrapper').getBoundingClientRect().top;
        return [...document.querySelectorAll('#timeline-content > .event')]
            .find(card => card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().bottom > wrapper + 1)?.querySelector('.event-header').textContent.trim();
    });
    // the lab opens the map drawer on wide screens, which lays the timeline out again once it has opened
    await expect(page.locator('#map-panel')).toHaveClass(/open/);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        const { eventManager, uiManager } = window.lab;
        uiManager.scrollToEventId(eventManager.placeIndex.idFor(eventManager.events.find(e => e.name === 'Napoleon remembered in a later century')));
    });
    const late = page.locator('#timeline-content .event', { has: page.locator('.event-header', { hasText: 'Napoleon remembered in a later century' }) });
    await expect.poll(top).toBe('Napoleon remembered in a later century');
    await late.locator('.figure-mention.is-character').click();
    // the timeline draws around its scroll position, so a card opened this deep must start the person's events at the top
    await expect(page.locator('#timeline-content .event', { hasText: 'Napoleon is born in Corsica' })).toBeInViewport();
    await page.locator('#timeline-wrapper').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.locator('.character-bar [data-action="close"]').click();
    await expect.poll(top).toBe('Napoleon remembered in a later century');
});
