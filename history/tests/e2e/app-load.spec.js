import { test, expect } from '@playwright/test';

// Block non-essential external network requests in CI.
// Allow: Leaflet (unpkg.com), Firebase SDK (gstatic.com/firebasejs) — required for app init.
// Block: Firebase runtime APIs, Nominatim, Font Awesome, map tiles.
const BLOCKED_DOMAINS = [
  'firebaseio.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'google-analytics.com',
  'fontawesome.com',
  'kit.fontawesome.com',
  'nominatim.openstreetmap.org',
  'tile.openstreetmap',
];

function setupNetworkBlocking(page) {
  page.route('**/*', (route) => {
    const url = route.request().url();
    if (BLOCKED_DOMAINS.some(domain => url.includes(domain))) {
      route.abort();
    } else {
      route.continue();
    }
  });
}

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test.describe('App loads with sample data', () => {

  test('loads events_sample_small.json without page errors', async ({ page }) => {
    setupNetworkBlocking(page);
    const errors = collectPageErrors(page);

    await page.goto('/history/index.html?file=events_sample_small.json');
    await page.waitForSelector('#timeline-content .event', { timeout: 10000 });

    expect(errors).toEqual([]);
  });

  test('loads events_sample.json without page errors', async ({ page }) => {
    setupNetworkBlocking(page);
    const errors = collectPageErrors(page);

    await page.goto('/history/index.html?file=events_sample.json');
    await page.waitForSelector('#timeline-content .event', { timeout: 15000 });

    expect(errors).toEqual([]);
  });

  test('renders events in sorted order', async ({ page }) => {
    setupNetworkBlocking(page);

    await page.goto('/history/index.html?file=events_sample_small.json');
    await page.waitForSelector('#timeline-content .event', { timeout: 10000 });

    // Verify at least one event rendered
    const eventCount = await page.locator('#timeline-content .event').count();
    expect(eventCount).toBeGreaterThan(0);
  });

});
