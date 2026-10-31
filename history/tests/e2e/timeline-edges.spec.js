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
