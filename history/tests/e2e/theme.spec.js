import { test, expect } from '@playwright/test';
import { stubFirebase } from './firebase-stub.js';

const DARK_BG = 'rgb(14, 14, 16)';
const background = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function open(page) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:8080/') || url.includes('unpkg.com/leaflet') || url.includes('www.gstatic.com/firebasejs/')) return route.continue();
    return route.abort();
  });
  await stubFirebase(page);
  await page.goto('/history/index.html?file=events_sample_small.json');
  await expect(page.locator('.event').first()).toBeVisible();
}

test('the theme choice in settings overrides the system theme and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  const lightBg = await background(page);
  expect(lightBg).not.toBe(DARK_BG);
  await page.click('#settings-btn');
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();

  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK_BG);

  // set before the page paints, so a reload never flashes the system theme
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.event').first()).toBeVisible();
  await page.click('#settings-btn');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();

  // Light holds on a dark system; System follows it again
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByText('Light', { exact: true }).click();
  expect(await background(page)).toBe(lightBg);
  await page.getByText('System', { exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await background(page)).toBe(DARK_BG);
  expect(await page.evaluate(() => localStorage.getItem('historiline.theme'))).toBeNull();
});
