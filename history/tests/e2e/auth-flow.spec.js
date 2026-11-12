import { test, expect } from './cdn-cache.js';
import { EMULATORS_RUNNING, createAccount, resetEmulators, signIn } from './emulator.js';
import { keepMapOffline } from './firebase-stub.js';

// Sign-in against the local Firebase emulators.
const APP = '/history/index.html?emulator&file=events_sample_small.json';

test.skip(!EMULATORS_RUNNING, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

test.beforeEach(async ({ page, request }) => {
  await keepMapOffline(page);
  await resetEmulators(request);
});

test('an admin stays signed in after a reload', async ({ page, request }) => {
  await createAccount(request, 'admin@example.test', 'admin');
  await page.goto(APP);
  await page.waitForSelector('#timeline-content .event');

  await signIn(page, 'admin@example.test');
  await expect(page.locator('#user-email')).toHaveText('admin@example.test');

  await page.reload();
  await page.waitForSelector('#timeline-content .event');
  await expect(page.locator('#user-email')).toHaveText('admin@example.test');
  await expect(page.locator('#user-info')).toBeVisible();

  await page.click('#settings-btn');
  await page.click('#logout-btn');
  await expect(page.locator('#login-form')).toBeVisible();
});
