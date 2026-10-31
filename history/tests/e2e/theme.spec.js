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

test('the site is light until Dark is chosen in settings, whatever the system theme, and remembers it', async ({ page }) => {
  // a dark system still opens the site light
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const lightBg = await background(page);
  expect(lightBg).not.toBe(DARK_BG);
  await page.click('#settings-btn');
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'System' })).toHaveCount(0);

  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK_BG);

  // set before the page paints, so a reload never flashes light; it holds on a light system too
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.event').first()).toBeVisible();
  expect(await background(page)).toBe(DARK_BG);
  await page.click('#settings-btn');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();

  await page.getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(lightBg);
  expect(await page.evaluate(() => localStorage.getItem('historiline.theme'))).toBe('light');
});
