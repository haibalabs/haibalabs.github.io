import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubFirebase } from './firebase-stub.js';

// The released place labels every visitor sees (releases/README.md), from the repository's release.
// Battle of Kempsford is written "Kempsford, England" and labelled "Kempsford, United Kingdom";
// neither text appears in its name or description, so search can only find it through its location.
const RELEASE = readFileSync(new URL('../../releases/released-place-labels-v1.json', import.meta.url), 'utf8');

async function openSite(page, { labels = null } = {}) {
  await stubFirebase(page);
  if (labels !== null) await page.route('**/releases/released-place-labels-v1.json', route => route.fulfill({ contentType: 'application/json', body: labels }));
  await page.goto('/history/index.html');
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
}

const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });

test('an event shows its place label, and search finds it by the label or the written name', async ({ page }) => {
  test.setTimeout(120000);
  await openSite(page);
  await page.fill('#searchInput', 'Battle of Kempsford');
  await expect(card(page, 'Battle of Kempsford').locator('.event-location')).toHaveText('Kempsford, United Kingdom');
  for (const text of ['Kempsford, United Kingdom', 'Kempsford, England']) {
    await page.fill('#searchInput', text);
    await expect(card(page, 'Battle of Kempsford')).toHaveCount(1);
  }
  // a null label shows no location text
  await page.fill('#searchInput', 'Murder of Julie Laible');
  await expect(card(page, 'Murder of Julie Laible')).toHaveCount(1);
  await expect(card(page, 'Murder of Julie Laible').locator('.event-location')).toHaveCount(0);
});

test('labels made for another data file leave the written names, without a message', async ({ page }) => {
  test.setTimeout(120000);
  const stale = JSON.parse(RELEASE);
  stale.source.events_sha256 = '0'.repeat(64);
  await openSite(page, { labels: JSON.stringify(stale) });
  await page.fill('#searchInput', 'Battle of Kempsford');
  await expect(card(page, 'Battle of Kempsford').locator('.event-location')).toHaveText('Kempsford, England');
  await page.fill('#searchInput', 'Kempsford, United Kingdom');
  await expect(card(page, 'Battle of Kempsford')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
});
