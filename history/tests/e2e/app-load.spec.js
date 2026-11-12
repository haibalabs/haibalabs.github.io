import { test, expect } from './cdn-cache.js';

// Block non-essential external network requests in CI.
// Allow: Leaflet (unpkg.com), Firebase SDK (gstatic.com/firebasejs) — required for app init.
// Block: Firebase runtime APIs, Nominatim, Font Awesome, map tiles and the vector map's library.
const BLOCKED_DOMAINS = [
  'firebaseio.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'google-analytics.com',
  'fontawesome.com',
  'kit.fontawesome.com',
  'nominatim.openstreetmap.org',
  'tile.openstreetmap',
  'vector.openstreetmap.org',
  'unpkg.com/maplibre-gl',
  'unpkg.com/@maplibre',
  'unpkg.com/@mapbox',
  'tiles.openfreemap.org',
  'elevation-tiles-prod',
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

  // ?file= opens a data file instead of the published release (script.js)
  test('?file= opens the named data file', async ({ page }) => {
    setupNetworkBlocking(page);
    const errors = collectPageErrors(page);
    await page.goto('/history/index.html?file=tests/fixtures/file-param.json');
    await expect(page.locator('#timeline-content .event .event-header')).toHaveText([/First file event/, /Second file event/]);
    expect(errors).toEqual([]);
  });

  test('keeps a quote in an image URL inside the src attribute', async ({ page }) => {
    setupNetworkBlocking(page);
    // Keep the image alive while inspecting attributes; DNS failure would remove it.
    await page.route('https://example.test/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
    await page.route('**/quote-fixture.json', route => route.fulfill({ json: [{
      name: 'Quote fixture', locations: [], figures: [], categories: ['culture'],
      enhanced_description: 'Image URL containing a quote.', enhanced_time: '1899', confidence: 'high',
      image_url: 'https://example.test/image.jpg" data-review-injected="yes',
    }] }));

    await page.goto('/history/index.html?file=quote-fixture.json');
    await page.waitForSelector('.event-image img', { state: 'attached', timeout: 10000 });
    expect(await page.locator('[data-review-injected]').count()).toBe(0);
    const src = await page.locator('.event-image img').first().getAttribute('src');
    expect(src).not.toContain('"');
  });

  test('drops images that fail entirely and closes the gap they leave', async ({ page }) => {
    setupNetworkBlocking(page);
    let releaseFailures;
    const ready = new Promise(resolve => { releaseFailures = resolve; });
    await page.route('**/upload.wikimedia.org/**', async route => {
      await ready;
      await route.fulfill({ status: 404, body: '' });
    });

    await page.goto('/history/index.html?file=events_samples.json', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.event-image img', { state: 'attached' });
    const name = await page.evaluate(() => document.querySelector('.event-image img').getAttribute('alt'));
    releaseFailures();
    // the failure re-render is debounced; wait until that event renders without its image
    await expect.poll(() => page.evaluate((n) => {
      const event = [...document.querySelectorAll('#timeline-content .event')]
        .find(el => el.querySelector('.event-header')?.textContent.includes(n));
      return event ? !event.querySelector('.event-image') : null;
    }, name)).toBe(true);
    expect(await page.evaluate(visibleImageCount)).toBe(0);

    const gaps = await page.evaluate(() => {
      const events = [...document.querySelectorAll('#timeline-content .event')]
        .map(el => ({ top: el.offsetTop, height: el.getBoundingClientRect().height }))
        .sort((a, b) => a.top - b.top);
      return events.slice(1).map((e, i) => Math.round(e.top - (events[i].top + events[i].height)));
    });
    expect(gaps.every(g => Math.abs(g) <= 1)).toBe(true);
  });

});

// A 1x1 PNG served in place of images, so image tests do not depend on the network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// Images still displayed inside the timeline viewport.
function visibleImageCount() {
  const view = document.getElementById('timeline-wrapper').getBoundingClientRect();
  return [...document.querySelectorAll('.event-image')].filter((el) => {
    const r = el.getBoundingClientRect();
    return el.offsetParent !== null && r.bottom > view.top && r.top < view.bottom;
  }).length;
}
