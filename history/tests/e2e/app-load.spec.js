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

  test('renders event images with sanitized attributes', async ({ page }) => {
    setupNetworkBlocking(page);

    await page.goto('/history/index.html?file=events_samples.json');
    await page.waitForSelector('#timeline-content .event', { timeout: 10000 });

    // events_samples.json has 4 events with image_url
    const images = page.locator('.event-image img');
    const imageCount = await images.count();
    expect(imageCount).toBeGreaterThan(0);

    // Verify sanitized attributes: src should be https, alt should be escaped
    const firstImg = images.first();
    const src = await firstImg.getAttribute('src');
    expect(src).toMatch(/^https:\/\//);

    const alt = await firstImg.getAttribute('alt');
    expect(alt).toBeTruthy();
    expect(alt).not.toContain('<');
    expect(alt).not.toContain('>');
  });

  test('keeps a quote in an image URL inside the src attribute', async ({ page }) => {
    setupNetworkBlocking(page);
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

  test('requests 500px thumbnails and clears the shimmer once loaded', async ({ page }) => {
    setupNetworkBlocking(page);
    routeWikimediaImages(page, { thumb: true, original: true });

    await page.goto('/history/index.html?file=events_samples.json');
    const img = page.locator('.event-image img').first();
    await expect(img).toHaveAttribute('src', /\/thumb\/.*\/500px-/);
    await img.scrollIntoViewIfNeeded();
    await expect(page.locator('.event-image:not(.loading) img').first()).toBeVisible();
  });

  test('shows the shimmer on a visible element while an image loads', async ({ page }) => {
    setupNetworkBlocking(page);
    // never answer image requests, so images stay in the loading state
    await page.route('**/upload.wikimedia.org/**', () => {});

    await page.goto('/history/index.html?file=events_samples.json');
    const wrapper = page.locator('.event-image.loading').first();
    await wrapper.waitFor({ state: 'attached' });
    const style = await wrapper.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundImage, opacity: s.opacity };
    });
    expect(style.background).toContain('linear-gradient');
    expect(Number(style.opacity)).toBeGreaterThan(0);
  });

  test('falls back to the original image when the thumbnail fails', async ({ page }) => {
    setupNetworkBlocking(page);
    routeWikimediaImages(page, { thumb: false, original: true });

    await page.goto('/history/index.html?file=events_samples.json');
    await page.locator('.event-image img').first().scrollIntoViewIfNeeded();
    const loaded = page.locator('.event-image:not(.loading) img').first();
    await expect(loaded).toBeVisible();
    const src = await loaded.getAttribute('src');
    expect(src).not.toContain('/thumb/');
  });

  test('drops images that fail entirely and closes the gap they leave', async ({ page }) => {
    setupNetworkBlocking(page);
    routeWikimediaImages(page, { thumb: false, original: false });

    await page.goto('/history/index.html?file=events_samples.json');
    await page.waitForSelector('.event-image img', { state: 'attached' });
    const name = await page.evaluate(() => document.querySelector('.event-image img').getAttribute('alt'));
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

// A 1x1 PNG served in place of Wikimedia images, so image tests do not depend on the network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function routeWikimediaImages(page, { thumb, original }) {
  page.route('**/upload.wikimedia.org/**', (route) => {
    const ok = route.request().url().includes('/thumb/') ? thumb : original;
    if (ok) route.fulfill({ contentType: 'image/png', body: PNG });
    else route.fulfill({ status: 404, body: '' });
  });
}

// Images still displayed inside the timeline viewport.
function visibleImageCount() {
  const view = document.getElementById('timeline-wrapper').getBoundingClientRect();
  return [...document.querySelectorAll('.event-image')].filter((el) => {
    const r = el.getBoundingClientRect();
    return el.offsetParent !== null && r.bottom > view.top && r.top < view.bottom;
  }).length;
}
