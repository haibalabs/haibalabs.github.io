import { test, expect } from '@playwright/test';
import { AUTH, EMULATORS_RUNNING, PROJECT, createAccount, resetEmulators, signIn } from './emulator.js';

// Sign-in against the local Firebase emulators.
const APP = '/history/index.html?emulator&file=events_sample_small.json';

test.skip(!EMULATORS_RUNNING, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
});

test('an admin stays signed in after a reload and gets the sync and debug controls', async ({ page, request }) => {
  await createAccount(request, 'admin@example.test', 'admin');
  await page.goto(APP);
  await page.waitForSelector('#timeline-content .event');
  await page.click('#settings-btn');
  await expect(page.locator('#debug-settings')).toBeHidden();
  await page.click('.settings-close-btn');

  await signIn(page, 'admin@example.test');
  await expect(page.locator('#user-email')).toHaveText('admin@example.test');
  await expect(page.locator('#debug-settings')).toBeVisible();
  await expect(page.locator('#debug-sync')).toBeEnabled();
  await expect(page.locator('#debug-add-event')).toBeEnabled();

  await page.reload();
  await page.waitForSelector('#timeline-content .event');
  await expect(page.locator('#user-email')).toHaveText('admin@example.test');
  await expect(page.locator('#user-info')).toBeVisible();
  await expect(page.locator('#debug-sync')).toBeEnabled();

  await page.click('#settings-btn');
  await page.click('#logout-btn');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#debug-settings')).toBeHidden();
  await expect(page.locator('#debug-sync')).toBeDisabled();
});

for (const role of ['editor', 'viewer']) {
  test(`${role}s sign in without the sync and debug controls`, async ({ page, request }) => {
    await createAccount(request, `${role}@example.test`, role);
    await page.goto(APP);
    await signIn(page, `${role}@example.test`);
    await expect(page.locator('#user-email')).toHaveText(`${role}@example.test`);
    await expect(page.locator('#debug-settings')).toBeHidden();
    await expect(page.locator('#debug-sync')).toBeDisabled();
    await expect(page.locator('#debug-add-event')).toBeDisabled();
  });
}

test('an account without a role is signed out with a message', async ({ page, request }) => {
  await createAccount(request, 'stranger@example.test', null);
  await page.goto(APP);
  await signIn(page, 'stranger@example.test');
  await expect(page.locator('#auth-status')).toHaveText(/has not been invited/);
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#user-info')).toBeHidden();

  await page.reload();
  await expect(page.locator('#user-info')).toBeHidden();
});

test('"Forgot password?" sends a reset email without revealing whether the account exists', async ({ page, request }) => {
  await createAccount(request, 'editor@example.test', 'editor');
  await page.goto(APP);
  await page.click('#settings-btn');

  await page.click('#reset-password-btn');
  await expect(page.locator('#auth-status')).toHaveText(/Enter your email above/);

  await page.fill('#email', 'editor@example.test');
  await page.click('#reset-password-btn');
  await expect(page.locator('#auth-status')).toHaveText(/reset link is on its way/);
  const sentMessage = await page.locator('#auth-status').textContent();

  await page.fill('#email', 'nobody@example.test');
  await page.click('#reset-password-btn');
  await expect(page.locator('#auth-status')).toHaveText(sentMessage);

  // the Auth emulator records the reset email it would have sent
  const codes = await (await request.get(`http://${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const resets = codes.oobCodes.filter(c => c.requestType === 'PASSWORD_RESET').map(c => c.email);
  expect(resets).toEqual(['editor@example.test']);
});

test('a wrong password shows an in-page error instead of an alert', async ({ page, request }) => {
  await createAccount(request, 'editor@example.test', 'editor');
  let dialog = false;
  page.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
  await page.goto(APP);
  await signIn(page, 'editor@example.test', 'not-the-password');
  await expect(page.locator('#auth-status')).toHaveText('Email or password is incorrect.');
  expect(dialog).toBe(false);
});
