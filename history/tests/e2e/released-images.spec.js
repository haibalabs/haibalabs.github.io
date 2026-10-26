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

test('a contextual image is labeled with its role and says what it shows and when', async ({ page }) => {
  test.setTimeout(120000);
  const release = JSON.parse(SAMPLE);
  const roerich = release.records.find(r => r.record_index === 26337);
  Object.assign(roerich, { image_role: 'site', date_qualification: 'The White House photographed in 2008, long after the signing.' });
  await openSite(page, { release: JSON.stringify(release) });
  await page.fill('#searchInput', 'Roerich Pact');
  await card(page, 'The Roerich Pact signed').locator('.event-image img').click();
  const viewer = page.locator('#photo-viewer');
  await expect(viewer.locator('.viewer-role')).toHaveText('Site');
  await expect(viewer.locator('.viewer-qualification')).toHaveText('The White House photographed in 2008, long after the signing.');
  await expect(viewer.locator('.viewer-credit')).toContainText('Public domain');
  await page.keyboard.press('Escape');

  // a role the site cannot label keeps the whole release off
  roerich.image_role = 'unknown';
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { release: JSON.stringify(release) });
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);
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

test('the repository release attaches to events.json: contextual roles labeled, open issues noted', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page, { release: null });
  const viewer = page.locator('#photo-viewer');
  await page.fill('#searchInput', 'Tokhtamysh');
  await card(page, 'Khan Tokhtamysh overruns Muscovy').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-role')).toHaveText('Later illustration');
  await expect(viewer.locator('.viewer-qualification')).toContainText('not the depicted event date');
  await expect(viewer.locator('.viewer-hold')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.fill('#searchInput', 'Centennial Exposition');
  await card(page, 'Centennial Exposition').locator('.event-image img').first().click();
  await expect(viewer.locator('.viewer-hold')).toHaveText('Some details of this event are still being reviewed.');
  await page.keyboard.press('Escape');

  // events outside the release keep no image
  await page.fill('#searchInput', 'Roerich Pact');
  await expect(card(page, 'The Roerich Pact signed').locator('.event-image')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('another events file or a malformed release shows no world images and no message', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page, { query: '?file=events_sample.json' });
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { release: '{"version":1,"source":{},"records":"not a list"}' });
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);
});
