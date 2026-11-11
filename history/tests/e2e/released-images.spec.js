import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubFirebase } from './firebase-stub.js';

// The released images every visitor sees (releases/README.md). Most cases serve a four-record sample
// cohort bound to tests/fixtures/events-small.json, 200 records of the legacy events.json; one uses the
// repository's release on the default canonical file. Commons images are served locally.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SAMPLE = readFileSync(new URL('../fixtures/released-images-sample.json', import.meta.url), 'utf8');

async function openSite(page, { query = '?file=tests/fixtures/events-small.json', release = SAMPLE } = {}) {
  await stubFirebase(page);
  await page.route('https://upload.wikimedia.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  if (release !== null) await page.route('**/releases/released-images-v1.json', route => route.fulfill({ contentType: 'application/json', body: release }));
  await page.goto(`/history/index.html${query}`);
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
}

const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });

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
  // credit, license and source sit behind the (i) button; opening them keeps the viewer open
  await expect(viewer.locator('.viewer-credit')).toBeHidden();
  await viewer.locator('.viewer-info').click();
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.viewer-info')).toHaveAttribute('aria-expanded', 'true');
  await expect(viewer.locator('.viewer-credit')).toContainText('United States Department of State; via Wikimedia Commons · Public domain · Source');
  await viewer.locator('.viewer-info').click();
  await expect(viewer.locator('.viewer-credit')).toBeHidden();
  await expect(viewer.locator('.viewer-hold')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // no role label: the caption says what the image shows
  await page.fill('#searchInput', 'Fox Vault Fire');
  await card(page, '1937 Fox Vault Fire').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-caption')).toBeVisible();
  await expect(viewer.locator('.viewer-role')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // events not in the release keep no image
  await page.fill('#searchInput', 'Union Station massacre');
  await expect(card(page, 'Union Station massacre').locator('.event-image')).toHaveCount(0);
});

test('a contextual image shows its caption and its date, without a role label or a date note', async ({ page }) => {
  test.setTimeout(120000);
  const release = JSON.parse(SAMPLE);
  const roerich = release.records.find(r => r.event_name === 'The Roerich Pact signed');
  Object.assign(roerich, { image_role: 'site', image_date: 'Taken on 4 June 2008, 10:21',
    caption: 'The White House in 2008. Image date: 2008-06-04.', date_qualification: 'Photographed in 2008, long after the signing.' });
  await openSite(page, { release: JSON.stringify(release) });
  await page.fill('#searchInput', 'Roerich Pact');
  await card(page, 'The Roerich Pact signed').locator('.event-image img').click();
  const viewer = page.locator('#photo-viewer');
  await expect(viewer.locator('.viewer-role')).toHaveCount(0);
  await expect(viewer.locator('.viewer-qualification')).toHaveCount(0);
  await expect(viewer.locator('.viewer-caption')).toContainText('The White House in 2008. · 2008');
  await expect(viewer.locator('.viewer-caption')).not.toContainText('Image date');
  await expect(viewer.locator('.viewer-date')).toHaveText('2008');
  await viewer.locator('.viewer-info').click();
  await expect(viewer.locator('.viewer-credit')).toContainText('Public domain');
  await page.keyboard.press('Escape');

  // a role the site does not know keeps the whole release off
  roerich.image_role = 'unknown';
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openSite(page, { release: JSON.stringify(release) });
  await expect(page.locator('#timeline-content .event-image')).toHaveCount(0);
});

test('the repository release attaches to the default canonical file: image dates shown, open issues noted', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page, { query: '', release: null });
  const viewer = page.locator('#photo-viewer');
  await page.fill('#searchInput', 'Tokhtamysh');
  await card(page, 'Khan Tokhtamysh overruns Muscovy').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-role')).toHaveCount(0);
  await expect(viewer.locator('.viewer-date')).toHaveText('2012-04-03');
  await expect(viewer.locator('.viewer-caption')).not.toContainText('not a contemporary');
  await expect(viewer.locator('.viewer-qualification')).toHaveCount(0);
  await expect(viewer.locator('.viewer-hold')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // a rewritten caption says what the image shows, and its reviewed display_date follows it
  await page.fill('#searchInput', 'Wenceslaus III crowned King of Hungary');
  await card(page, 'Wenceslaus III crowned King of Hungary').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-caption')).toContainText('Seal of Wenceslaus III.');
  await expect(viewer.locator('.viewer-caption')).not.toContainText('not a photograph');
  await expect(viewer.locator('.viewer-date')).toHaveText('1896');
  await page.keyboard.press('Escape');

  // the Cherchen map caption Rachid flagged on 2026-10-26: what it shows, then the date, with no "not an image of"
  await page.fill('#searchInput', 'Cherchen Man');
  await card(page, 'Rough carbon-14 dating of the Cherchen Man').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-caption')).toContainText('Map of Tarim mummy sites, including Cherchen.');
  await expect(viewer.locator('.viewer-caption')).not.toContainText('not an image');
  await expect(viewer.locator('.viewer-date')).toHaveText('2023-04-29');
  await page.keyboard.press('Escape');

  // a round 2 addition
  await page.fill('#searchInput', 'Hojo Morotoki becomes regent');
  await card(page, 'Hojo Morotoki becomes regent').locator('.event-image img').click();
  await expect(viewer.locator('.viewer-caption')).toContainText('Portrait of Hōjō Morotoki');
  await expect(viewer.locator('.viewer-date')).toHaveText('1886');
  await page.keyboard.press('Escape');

  // a round 3 addition, an event that had no image before
  await page.fill('#searchInput', 'Siege of Algeciras');
  await card(page, 'Siege of Algeciras').locator('.event-image img').first().click();
  await expect(viewer.locator('.viewer-caption')).toContainText('Aerial view of part of Algeciras and its port.');
  await expect(viewer.locator('.viewer-date')).toHaveText('2023-12-30');
  await page.keyboard.press('Escape');

  await page.fill('#searchInput', 'Centennial Exposition');
  await card(page, 'Centennial Exposition').locator('.event-image img').first().click();
  await expect(viewer.locator('.viewer-hold')).toHaveText('Some details of this event are still being reviewed.');
  await page.keyboard.press('Escape');

  // a credit thousands of characters long is shortened, and the license and source links stay visible
  await page.fill('#searchInput', 'Eric of Pomerania is deposed');
  await card(page, 'Eric of Pomerania is deposed from the Swedish throne').locator('.event-image img').click();
  await viewer.locator('.viewer-info').click();
  const creditText = viewer.locator('.viewer-credit > span');
  expect((await creditText.textContent()).length).toBeLessThanOrEqual(281);
  await expect(creditText).toHaveAttribute('title', /Southerly Clubs/);
  await expect(viewer.locator('.viewer-credit a', { hasText: 'Source' })).toBeInViewport();
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

test('scrolling keeps the cards that stay on screen, so their images are not loaded again', async ({ page }) => {
  test.setTimeout(120000);
  // the opening events all have images
  await openSite(page, { query: '', release: null });
  await expect(page.locator('#timeline-content .event').first().locator('.event-image img')).toBeVisible();
  const result = await page.evaluate(async () => {
    const wrapper = document.getElementById('timeline-wrapper');
    const cards = () => [...document.querySelectorAll('#timeline-content > .event')];
    const ids = () => cards().map(card => card.dataset.eventId).join();
    const imageOf = () => new Map(cards().map(card => [card.dataset.eventId, card.querySelector('.event-image img')]));
    const before = imageOf();
    const start = ids();
    // scroll in small steps until the rendered range moves
    for (let step = 0; step < 40 && ids() === start; step++) {
      wrapper.scrollTop += wrapper.clientHeight * 0.25;
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
    }
    const after = imageOf();
    const stayed = [...after.keys()].filter(id => before.get(id));
    return { moved: ids() !== start, withImages: stayed.length, sameImages: stayed.filter(id => after.get(id) === before.get(id)).length };
  });
  expect(result.moved).toBe(true);
  expect(result.withImages).toBeGreaterThan(0);
  expect(result.sameImages).toBe(result.withImages);
});
