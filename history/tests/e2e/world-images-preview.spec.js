import { test, expect } from '@playwright/test';
import { stubFirebase } from './firebase-stub.js';

// The debug preview of reviewed world images (previews/README.md), on the default events.json.
// Commons images are served locally so the test needs no network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function openSite(page, query = '') {
  await stubFirebase(page);
  await page.route('https://upload.wikimedia.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto(`/history/index.html${query}`);
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
}

// Debug settings are admin-only; the test shows and enables them as an admin would see them.
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

const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });

test('reviewed images show on their events with a one-line caption, and open full size with credits', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  await turnPreview(page, true);
  await expect(page.locator('.toast', { hasText: 'Showing 9 reviewed images.' })).toHaveCount(1);

  await page.fill('#searchInput', 'Union Station massacre');
  const event = card(page, 'Union Station massacre');
  await expect(event.locator('.event-image.zoomable img')).toHaveAttribute('src', /\/thumb\/.*500px-Kansas_City_Union_Station_Massacre\.jpg/);
  await expect(event.locator('.event-image-caption')).toHaveText('Aftermath of the Kansas City Union Station massacre, 17 June 1933.');
  // credits, license and holds stay off the card
  await expect(event).not.toContainText('Bureau of Investigation');
  await expect(event).not.toContainText('reviewed');

  await event.locator('.event-image img').click();
  const viewer = page.locator('#photo-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('img')).toHaveAttribute('src', /1280px-Kansas_City_Union_Station_Massacre\.jpg/);
  await expect(viewer.locator('.viewer-role')).toHaveCount(0);
  await expect(viewer.locator('.viewer-caption')).toContainText('Aftermath of the Kansas City Union Station massacre');
  await viewer.locator('.viewer-info').click();
  await expect(viewer.locator('.viewer-credit')).toContainText('United States Bureau of Investigation (FBI); photographer unspecified · Public domain · Source');
  await expect(viewer.locator('.viewer-credit a', { hasText: 'Source' })).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Kansas_City_Union_Station_Massacre.jpg');
  await expect(viewer.locator('.viewer-hold')).toHaveText('Some details of this event are still being reviewed.');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // an event without holds shows no review note; a licensed image links its license
  await page.fill('#searchInput', 'Boycott of Jewish-owned businesses');
  await card(page, 'Boycott of Jewish-owned businesses in Germany').locator('.event-image img').click();
  await viewer.locator('.viewer-info').click();
  await expect(viewer.locator('.viewer-credit a', { hasText: 'CC BY-SA 3.0 de' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/3.0/de/deed.en');
  await page.keyboard.press('Escape');
  await page.fill('#searchInput', 'Black Sunday Dust Bowl');
  await card(page, 'Black Sunday Dust Bowl storm').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-hold')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await turnPreview(page, false);
  await expect(card(page, 'Black Sunday Dust Bowl storm').locator('.event-image')).toHaveCount(0);
});

test('when the full-size image and its original both fail, the viewer says so and keeps the credits', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  // the card's thumbnail loads; the viewer's 1280px thumbnail and the original do not
  await page.route('https://upload.wikimedia.org/**', route =>
    (route.request().url().includes('/thumb/') && !route.request().url().includes('1280px-') ? route.fallback() : route.abort()));
  await turnPreview(page, true);
  await page.fill('#searchInput', 'Union Station massacre');
  await card(page, 'Union Station massacre').locator('.event-image img').click();
  const viewer = page.locator('#photo-viewer');
  await expect(viewer.locator('.photo-viewer-error')).toBeVisible();
  await expect(viewer.locator('.photo-viewer-error')).toHaveText('This image could not be loaded.');
  await expect(viewer).not.toHaveClass(/loading/);
  await expect(viewer.locator('img')).toBeHidden();
  await viewer.locator('.viewer-info').click();
  await expect(viewer.locator('.viewer-credit')).toContainText('Public domain');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(viewer.locator('.photo-viewer-error')).toBeHidden();
});

test('a different events file gets no preview images and says why', async ({ page }) => {
  await openSite(page, '?file=events_sample.json');
  await turnPreview(page, true);
  await expect(page.locator('.toast', { hasText: 'not the one these preview images were reviewed against' })).toHaveCount(1);
  await expect(page.locator('#debug-world-images')).not.toBeChecked();
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);
});
