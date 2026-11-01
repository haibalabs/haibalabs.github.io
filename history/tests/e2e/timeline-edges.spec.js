import { test, expect } from '@playwright/test';
import { stubFirebase } from './firebase-stub.js';

// Earliest and Latest in the era pill, and the Home and End keys (modules/timeline-nav.js).
async function open(page) {
  await stubFirebase(page);
  await page.goto('/history/index.html');
  await page.waitForSelector('#timeline-content .event', { timeout: 60000 });
  await expect(page.locator('#crumbs [data-edge="end"]')).toBeVisible();
}
const onScreen = (page, name) => expect(page.locator('#timeline-content .event', { hasText: name }).first()).toBeInViewport({ timeout: 15000 });
const LATEST = 'Los Yébenes', EARLIEST = 'Big Bang';

test('Earliest and Latest in the era pill, and Home and End, go to the two ends of the timeline', async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  // the loading trip has handed the pill back
  await expect(page.locator('#crumbs .travel')).toHaveCount(0);
  await expect(page.locator('.travel-skeleton, .travel-band')).toHaveCount(0);

  await page.click('#crumbs [data-edge="end"]');
  await onScreen(page, LATEST);
  await page.click('#crumbs [data-edge="start"]');
  await onScreen(page, EARLIEST);

  await page.keyboard.press('End');
  await onScreen(page, LATEST);
  // typing in the search box keeps Home for the text
  await page.click('#searchInput');
  await page.keyboard.press('Home');
  await page.waitForTimeout(500);
  await onScreen(page, LATEST);
  await page.locator('#searchInput').blur();
  await page.keyboard.press('Home');
  await onScreen(page, EARLIEST);
});

test('on a phone the pill keeps Earliest and Latest beside the era and drops the decade arrows', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await expect(page.locator('#crumbs [data-edge="start"]')).toBeVisible();
  await expect(page.locator('#crumbs [data-step]').first()).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a long jump arrives without a seconds-long scroll', async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  const started = Date.now();
  await page.click('#crumbs [data-edge="end"]');
  await onScreen(page, LATEST);
  const took = Date.now() - started;
  console.log('Latest took', took, 'ms');
  expect(took).toBeLessThan(2500);
});

test('Home and End leave the timeline alone behind a dialog or the full-window map', async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  await page.evaluate(() => { document.getElementById('add-event-modal').style.display = 'flex'; });
  await page.keyboard.press('End');
  await page.waitForTimeout(1500);
  await onScreen(page, EARLIEST);
  await page.evaluate(() => {
    document.getElementById('add-event-modal').style.display = 'none';
    document.body.classList.add('map-full');
  });
  await page.keyboard.press('End');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.body.classList.remove('map-full'));
  await onScreen(page, EARLIEST);
  await page.keyboard.press('End');
  await onScreen(page, LATEST);
});

test('when the events fail to load, the timeline says so', async ({ page }) => {
  await stubFirebase(page);
  await page.route('**/canonical-t2.json', route => route.fulfill({ status: 500, body: '' }));
  await page.goto('/history/index.html');
  const failure = page.locator('#timeline-content .load-failure');
  await expect(failure).toContainText("The events couldn't be loaded.");
  await expect(page.locator('.travel-skeleton, .travel-band, #crumbs .travel')).toHaveCount(0);
  // a later render keeps the message
  await page.locator('.timeline-wrapper').evaluate(w => w.scrollBy(0, 200));
  await page.waitForTimeout(500);
  await expect(failure).toHaveCount(1);
});
