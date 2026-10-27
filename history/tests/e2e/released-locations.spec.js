import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubFirebase } from './firebase-stub.js';

// The released locations every visitor sees (releases/README.md), served here from a synthetic fixture
// in location_sidecar.py's format: invented places for three real canonical events, one of which also
// has a released image. The repository's location release holds none. Commons images are served locally.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SYNTHETIC = readFileSync(new URL('../fixtures/released-locations-synthetic.json', import.meta.url), 'utf8');

async function openSite(page, { query = '', locations = SYNTHETIC } = {}) {
  await stubFirebase(page);
  await page.route('https://upload.wikimedia.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  if (locations !== null) await page.route('**/releases/released-locations-v1.json', route => route.fulfill({ contentType: 'application/json', body: locations }));
  await page.goto(`/history/index.html${query}`);
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
}

const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });

async function turnPreview(page, on) {
  await page.evaluate(() => {
    document.getElementById('debug-settings').hidden = false;
    document.getElementById('debug-world-images').disabled = false;
  });
  await page.click('#settings-btn');
  if (on) await page.check('#debug-world-images');
  else await page.uncheck('#debug-world-images');
  await page.click('.settings-close-btn');
}

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

test('released images stay attached when their event\'s place changes, even after the preview toggles', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  await page.fill('#searchInput', 'Military agreement between Granada and Aragon');
  const granada = card(page, 'Military agreement between Granada and Aragon');
  await expect(granada.locator('.event-image img')).toHaveCount(1);
  await expect(granada.locator('.event-location')).toHaveAttribute('title', 'Reviewed location (region precision)');
  // the legacy-bound preview refuses the canonical file, and the released images are attached again
  await turnPreview(page, true);
  await expect(page.locator('.toast', { hasText: 'not the one these preview images were reviewed against' })).toHaveCount(1);
  await expect(granada.locator('.event-image img')).toHaveCount(1);
});

test('another events file or the empty repository release changes no locations, without a message', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page, { query: '?file=events.json' });
  await page.fill('#searchInput', 'Siege of Salvador');
  await expect(card(page, 'Siege of Salvador').locator('.event-location')).not.toHaveAttribute('title', /Reviewed location/);
  await expect(page.locator('.toast')).toHaveCount(0);

  // a malformed location file changes no locations and leaves the released images alone
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { locations: '{"version":1,"kind":"world_location_sidecar","source":{},"places":{},"records":[null]}' });
  await page.fill('#searchInput', 'Military agreement between Granada and Aragon');
  await expect(card(page, 'Military agreement between Granada and Aragon').locator('.event-image img')).toHaveCount(1);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { locations: null });
  await page.fill('#searchInput', 'Siege of Salvador');
  await expect(card(page, 'Siege of Salvador').locator('.event-location')).toHaveClass(/unverified/);
});
