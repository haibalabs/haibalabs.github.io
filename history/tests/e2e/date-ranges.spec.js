import { test, expect } from './cdn-cache.js';
import { stubFirebase } from './firebase-stub.js';

// Day-first ranges in one month on the published release (date-handlers.js). The Battles of Yarmuk and
// Qadisiyyah, as preview 7268b980 serves them (their image and location left out), showed in years 15 and 16;
// the timeline sorts every loaded event by its parsed date, so they belong between 600 and 700.
const row = (id, name, time) => ({ event_id: id, event_version: `v_${id}`, name, enhanced_time: time,
    enhanced_description: `${name}.`, categories: ['war'], figures: [], confidence: 'high', visible: true,
    wikipedia_url: '', locations: [] });
const EVENTS = [
    { ...row('evt_02724c81-6326-5268-a5b7-f78286bf8baf', 'Battle of the Yarmuk', '15–20 August 636'), accepted: true, confidence: 'low',
      event_version: 'b5241d27930371f3a5f58701e46a75e6794c0dfd10084b038724d9323715d08c', figures: ['Khalid ibn al-Walid'] },
    { ...row('evt_78b93cd2-7f25-5a4a-acbf-8dc0b9b562ae', 'Battle of al-Qadisiyyah', '16–19 November 636'), accepted: true, confidence: 'low',
      event_version: '0c46da1d700eab8e55a8903d907779bd2e3431b4a19c9a9ef2a344eb47eda0a1' },
    row('evt_year_15', 'An event of the year 15', '15'),
    row('evt_year_600', 'An event of the year 600', '600'),
    row('evt_year_700', 'An event of the year 700', '700'),
];
const MANIFEST = { format: 'historiline-manifest/v1', release_id: 'date-ranges', created_at: '2026-11-12T00:00:00Z',
    shards: [{ id: 'd000', count: EVENTS.length, sha256: 'e0' }],
    places: { buckets: 64, files: [{ bucket: 0, count: 0, sha256: 'p0' }] }, corrections: { sha256: 'c0' } };
const FILES = {
    'manifest.json': MANIFEST,
    'events/e0.json': { format: 'historiline-events/v1', shard: 'd000', family: 'dated', events: EVENTS },
    'places/p0.json': { format: 'historiline-places/v1', bucket: 0, places: [] },
    'corrections/c0.json': [],
};

test('a day-first range in one month is dated and placed in its written year', async ({ page }) => {
    await stubFirebase(page);
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod/, r => r.abort());
    await page.route('**/history/data/**', route => {
        const body = FILES[new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '')];
        return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404 });
    });
    await page.goto('/history/index.html');
    const card = name => page.locator('#timeline-content .event', { has: page.locator('.event-header', { hasText: name }) });
    await expect(card('Battle of the Yarmuk').locator('.event-date')).toHaveText('August 15th, 636 AD');
    await expect(card('Battle of al-Qadisiyyah').locator('.event-date')).toHaveText('November 16th, 636 AD');
    // in timeline order, by where each card sits
    const order = await page.locator('#timeline-content .event').evaluateAll(cards => cards
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map(c => c.querySelector('.event-header').textContent.trim()));
    expect(order).toEqual(['An event of the year 15', 'An event of the year 600', 'Battle of the Yarmuk',
        'Battle of al-Qadisiyyah', 'An event of the year 700']);
});
