import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubFirebase } from './firebase-stub.js';

// The released images every visitor sees (releases/README.md), served here from a four-record
// sample cohort; the repository's release file holds none yet. Commons images are served locally.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SAMPLE = readFileSync(new URL('../fixtures/released-images-sample.json', import.meta.url), 'utf8');

async function openSite(page, { query = '', release = SAMPLE } = {}) {
  await stubFirebase(page);
  await page.route('https://upload.wikimedia.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  if (release !== null) await page.route('**/releases/released-images-v1.json', route => route.fulfill({ contentType: 'application/json', body: release }));
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

test('released images show to every visitor without any setting, with credits in the viewer', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  await page.fill('#searchInput', 'Roerich Pact');
  const roerich = card(page, 'The Roerich Pact signed');
  await expect(roerich.locator('.event-image.zoomable img')).toHaveAttribute('src', /\/thumb\/.*500px-/);
  await expect(roerich.locator('.event-image-caption')).toHaveText('Signing of the Roerich Pact at the White House, 15 April 1935.');
  await expect(page.locator('.toast')).toHaveCount(0);

  await roerich.locator('.event-image img').click();
  const viewer = page.locator('#photo-viewer');
  await expect(viewer.locator('.viewer-credit')).toContainText('United States Department of State; via Wikimedia Commons · Public domain · Source');
  await expect(viewer.locator('.viewer-hold')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.fill('#searchInput', 'Fox Vault Fire');
  await card(page, '1937 Fox Vault Fire').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-role')).toHaveText('Aftermath');
  await page.keyboard.press('Escape');

  // events not in the release keep no image
  await page.fill('#searchInput', 'Union Station massacre');
  await expect(card(page, 'Union Station massacre').locator('.event-image')).toHaveCount(0);
});

test('the admin preview replaces the released images while on, and they return when it is off', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  await turnPreview(page, true);
  await expect(page.locator('.toast', { hasText: 'Showing 9 reviewed images.' })).toHaveCount(1);
  await page.fill('#searchInput', 'Union Station massacre');
  await expect(card(page, 'Union Station massacre').locator('.event-image')).toHaveCount(1);
  await turnPreview(page, false);
  await expect(card(page, 'Union Station massacre').locator('.event-image')).toHaveCount(0);
  await page.fill('#searchInput', 'Roerich Pact');
  await expect(card(page, 'The Roerich Pact signed').locator('.event-image-caption')).toHaveCount(1);
});

test('another events file, a malformed release or the empty repository release shows no world images and no message', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page, { query: '?file=events_sample.json' });
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { release: '{"version":1,"source":{},"records":"not a list"}' });
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { release: null });
  await page.fill('#searchInput', 'Roerich Pact');
  await expect(card(page, 'The Roerich Pact signed')).toHaveCount(1);
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);
});
