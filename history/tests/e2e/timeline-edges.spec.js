import { test, expect } from './cdn-cache.js';
import { stubFirebase } from './firebase-stub.js';

// Earliest and Latest in the era pill, and the Home and End keys (modules/timeline-nav.js).

// A release in the published format with about 3,000 events, from the Big Bang to the latest one, so the
// jumps and scrolling run over a long timeline without loading the full release.
const CATEGORIES = ['politics', 'war', 'science', 'art', 'religion', 'culture', 'exploration'];
function syntheticRelease() {
  const events = [];
  const add = (name, time, extra = {}) => events.push({ event_id: `evt_synthetic_${events.length}`,
    event_version: `v${events.length}`, name, enhanced_time: time, enhanced_description: `${name}.`,
    categories: [CATEGORIES[events.length % CATEGORIES.length]], figures: [], confidence: 'high', visible: true,
    wikipedia_url: '', locations: [], ...extra });
  add('Big Bang', 'c. 13.8 billion years ago', { sort_years_ago: 13.8e9, sort_tiebreak: 1 });
  add('The Earth forms', 'c. 4.5 billion years ago', { sort_years_ago: 4.5e9, sort_tiebreak: 1 });
  add('The dinosaurs die out', 'c. 66 million years ago', { sort_years_ago: 66e6, sort_tiebreak: 1 });
  for (let year = 1000; year <= 2025; year++) {
    for (let n = 0; n < 3; n++) add(events.length % 25 ? `Event ${n + 1} of ${year}` : `Treaty of ${year} signed`, String(year));
  }
  add('High-speed trains collide in Los Yébenes, Spain', '2026-10-28');
  return {
    manifest: { format: 'historiline-manifest/v1', created_at: '2026-11-11T00:00:00Z', release_id: 'synthetic-edges',
      shards: [{ id: 'd000', family: 'dated', count: events.length, sha256: 'synthetic-events' }],
      places: { buckets: 1, files: [{ bucket: 0, count: 0, sha256: 'synthetic-places' }] },
      corrections: { sha256: 'synthetic-corrections' } },
    files: {
      'events/synthetic-events.json': { format: 'historiline-events/v1', shard: 'd000', family: 'dated', events },
      'places/synthetic-places.json': { format: 'historiline-places/v1', bucket: 0, places: [] },
      'corrections/synthetic-corrections.json': [],
    },
  };
}
const SYNTHETIC = syntheticRelease();

async function serveSyntheticRelease(page) {
  await page.route('**/history/data/**', route => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '');
    const body = rel === 'manifest.json' ? SYNTHETIC.manifest : SYNTHETIC.files[rel];
    return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404 });
  });
}

async function open(page) {
  await stubFirebase(page);
  await serveSyntheticRelease(page);
  await page.goto('/history/index.html');
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
  await expect(page.locator('#crumbs [data-edge="end"]')).toBeVisible();
}
const onScreen = (page, name) => expect(page.locator('#timeline-content .event', { hasText: name }).first()).toBeInViewport({ timeout: 15000 });
const LATEST = 'Los Yébenes', EARLIEST = 'Big Bang';

test('Earliest and Latest in the era pill, Home and End, and an era picked while searching, go where they say', async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  // the loading trip has handed the pill back
  await expect(page.locator('#crumbs .travel')).toHaveCount(0);
  await expect(page.locator('.travel-skeleton, .travel-band')).toHaveCount(0);

  await page.click('#crumbs [data-edge="end"]');
  await onScreen(page, LATEST);
  await page.click('#crumbs [data-edge="start"]');
  await onScreen(page, EARLIEST);

  await page.keyboard.press('End');
  await onScreen(page, LATEST);
  // typing in the search box keeps Home for the text
  await page.click('#searchInput');
  await page.keyboard.press('Home');
  await page.waitForTimeout(500);
  await onScreen(page, LATEST);
  await page.locator('#searchInput').blur();
  await page.keyboard.press('Home');
  await onScreen(page, EARLIEST);
  // picking an era while searching shows the matching cards there at once
  await page.fill('#searchInput', 'treaty');
  await expect(page.locator('#timeline-content .event').first()).toContainText(/treaty/i, { timeout: 15000 });
  await page.click('#crumbs [data-level="era"]');
  await page.locator('#popover button', { hasText: 'Age of revolutions' }).click();
  // the cards render where the jump lands, before any scrolling by hand
  await expect.poll(() => page.evaluate(() => {
    const wrapper = document.getElementById('timeline-wrapper').getBoundingClientRect();
    return [...document.querySelectorAll('#timeline-content > .event')].filter(card => {
      const box = card.getBoundingClientRect();
      return box.height > 0 && box.bottom > wrapper.top && box.top < wrapper.bottom;
    }).length;
  }), { timeout: 5000 }).toBeGreaterThan(0);
});

test('a map that fails to start leaves the timeline working, with no load failure message', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/modules/map-browser.js', route => route.fulfill({
    contentType: 'text/javascript', body: "export class MapBrowser { constructor() { throw new Error('map failed'); } }" }));
  await stubFirebase(page);
  await serveSyntheticRelease(page);
  await page.goto('/history/index.html');
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
  await expect(page.locator('.load-failure')).toHaveCount(0);
  // the rest of the start-up ran: the era pill is drawn and Latest works
  await page.click('#crumbs [data-edge="end"]');
  await onScreen(page, LATEST);
});

test('scrolling by hand the moment a jump lands keeps the visitor where they scrolled', async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  await page.click('#crumbs [data-edge="end"]');
  // back over the timeline, so the wheel scrolls it rather than the header
  await page.mouse.move(640, 400);
  await page.waitForTimeout(80);
  await page.mouse.wheel(0, -4000);
  await page.waitForTimeout(2500);
  const left = await page.locator('.timeline-wrapper').evaluate(w => w.scrollHeight - w.clientHeight - w.scrollTop);
  expect(left).toBeGreaterThan(2000);
});
