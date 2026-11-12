import { test, expect } from './cdn-cache.js';
import { readFileSync } from 'node:fs';
import { stubFirebase } from './firebase-stub.js';

// The released locations every visitor sees (releases/README.md), served here from a synthetic fixture
// in location_sidecar.py's format: invented places for three real canonical events, one of which also
// has a released image. They load tests/fixtures/canonical-small.json, 41 records of canonical-t2.json,
// with the repository's image record for that event moved to the same file. Commons images are served
// locally.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SYNTHETIC = readFileSync(new URL('../fixtures/released-locations-synthetic.json', import.meta.url), 'utf8');
const EMPTY = JSON.stringify({ ...JSON.parse(SYNTHETIC), records: [], places: {} });
const IMAGES = readFileSync(new URL('../fixtures/released-images-canonical-small.json', import.meta.url), 'utf8');

async function openSite(page, { query = '?file=tests/fixtures/canonical-small.json', locations = SYNTHETIC, images = IMAGES } = {}) {
  await stubFirebase(page);
  await page.route('https://upload.wikimedia.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  if (locations !== null) await page.route('**/releases/released-locations-v1.json', route => route.fulfill({ contentType: 'application/json', body: locations }));
  if (images !== null) await page.route('**/releases/released-images-v1.json', route => route.fulfill({ contentType: 'application/json', body: images }));
  await page.goto(`/history/index.html${query}`);
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
}

const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });

test('a released location gives an event a point on the map, with its precision', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  await page.fill('#searchInput', 'Siege of Salvador');
  const location = card(page, 'Siege of Salvador').locator('.event-location');
  await expect(location).toHaveClass(/clickable/);
  await expect(location).toHaveAttribute('title', 'Reviewed location (site precision)');
  await location.click();
  await expect(page.locator('.event.map-selected')).toHaveCount(1);
  await expect(page.locator('.map-selected-dot').first()).toBeVisible();
});

test('released images stay attached when their event\'s place changes', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  await page.fill('#searchInput', 'Military agreement between Granada and Aragon');
  const granada = card(page, 'Military agreement between Granada and Aragon');
  await expect(granada.locator('.event-image img')).toHaveCount(1);
  await expect(granada.locator('.event-location')).toHaveAttribute('title', 'Reviewed location (region precision)');
});

test('another events file or an empty release changes no locations, without a message', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page, { query: '?file=tests/fixtures/events-small.json' });
  await page.fill('#searchInput', 'Siege of Salvador');
  await expect(card(page, 'Siege of Salvador').locator('.event-location')).not.toHaveAttribute('title', /Reviewed location/);
  await expect(page.locator('.toast')).toHaveCount(0);

  // a malformed location file changes no locations and leaves the released images alone
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { locations: '{"version":1,"kind":"world_location_sidecar","source":{},"places":{},"records":[null]}' });
  await page.fill('#searchInput', 'Military agreement between Granada and Aragon');
  await expect(card(page, 'Military agreement between Granada and Aragon').locator('.event-image img')).toHaveCount(1);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { locations: EMPTY });
  await page.fill('#searchInput', 'Siege of Salvador');
  await expect(card(page, 'Siege of Salvador').locator('.event-location')).toHaveClass(/unverified/);
});

// Exercise the actual release without substituting synthetic geography.