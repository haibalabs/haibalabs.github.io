import { test, expect } from '@playwright/test';
import { EMULATORS_RUNNING, createAccount, listAsOwner, resetEmulators, signIn } from './emulator.js';

// Reviewing edits to world events (WORLD-EDITS.md, phase 2), against the local Firebase emulators:
// an admin approves or rejects on review.html, and every visitor's page shows the approved values.
test.skip(!EMULATORS_RUNNING, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

const id = (n) => `evt_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const ORIGINAL = 'Schmeling knocks out Louis on June 13, 1936.';
const WORLD = [
  { event_id: id(1), name: 'Max Schmeling knocks out Joe Louis', enhanced_time: '1936-06-19',
    enhanced_description: ORIGINAL, categories: ['culture'], figures: ['Max Schmeling', 'Joe Louis'], locations: [], confidence: 'high' },
  { event_id: id(2), name: 'Opening of the museum', enhanced_time: '1902', enhanced_description: 'A museum opens.',
    categories: ['culture'], figures: [], locations: [], confidence: 'high' },
];

async function openWorld(page) {
  await page.route('**/canonical-t2.json', route => route.fulfill({ json: WORLD }));
  await page.goto('/history/index.html?emulator&file=canonical-t2.json');
  await page.waitForSelector('#timeline-content .event');
}

const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });

async function signInAs(page, email) {
  await signIn(page, email);
  await expect(page.locator('#user-email')).toHaveText(email);
  await page.click('.settings-close-btn');
}

async function suggest(page, { description, addPerson, name }) {
  await page.click('#settings-btn');
  await page.locator('#editing-toggle').setChecked(true);
  await page.click('.settings-close-btn');
  await card(page, name ?? 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  if (description) await page.fill('#se-description', description);
  if (addPerson) {
    await page.fill('#se-person', addPerson);
    await page.locator('#se-person-results button', { hasText: `Add “${addPerson}” without a link` }).click();
  }
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);
}

// The admin signs in on the timeline, then opens the review page in the same browser session.
async function openReview(page) {
  await openWorld(page);
  await signInAs(page, 'admin@example.test');
  await page.goto('/history/review.html?emulator');
  await expect(page.locator('#tab-waiting')).toHaveText(/Waiting · \d+/);
}

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
  await createAccount(request, 'editor@example.test', 'editor');
  await createAccount(request, 'admin@example.test', 'admin');
});

test('an admin approves the ticked fields; visitors see them, marked community edited, with no names', async ({ page, browser, request }) => {
  await page.route('https://en.wikipedia.org/w/rest.php/v1/search/title**', route => route.fulfill({ json: { pages: [] } }));
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await suggest(page, { description: 'Schmeling knocks out Louis on June 19, 1936.', addPerson: 'Arthur Donovan' });

  const admin = await browser.newPage();
  await openReview(admin);
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 1');
  const edit = admin.locator('.review-edit');
  await expect(edit.locator('.review-author')).toHaveText('editor@example.test');
  await expect(edit.locator('del')).toHaveText('13,');
  await expect(edit.locator('ins')).toHaveText('19,');
  await expect(edit.locator('.review-person.added')).toHaveText('+ Arthur Donovan');
  await edit.getByRole('checkbox', { name: 'Approve people change' }).uncheck();
  await expect(edit.getByRole('button', { name: 'Approve 1 of 2 changes' })).toBeVisible();
  await edit.getByRole('button', { name: 'Approve 1 of 2 changes' }).click();
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 0');

  const [stored] = await listAsOwner(request, 'edits');
  expect(stored.fields.status.stringValue).toBe('published');
  expect(stored.fields.review.mapValue.fields.by.mapValue.fields.email.stringValue).toBe('admin@example.test');
  expect(stored.fields.fields.mapValue.fields.figures.mapValue.fields.status.stringValue).toBe('rejected');
  const [overlay] = await listAsOwner(request, 'world_overlay');
  expect(JSON.stringify(overlay)).not.toMatch(/example\.test|"uid"|approved_by/);

  const visitor = await browser.newPage();
  await openWorld(visitor);
  const event = card(visitor, 'Max Schmeling knocks out Joe Louis');
  await expect(event.locator('.event-description')).toHaveText('Schmeling knocks out Louis on June 19, 1936.');
  await expect(event.locator('.community-edited')).toHaveText('Revised');
  await expect(event.locator('.community-edited')).toHaveAttribute('title', /^Changed after review · /);
  await expect(event.locator('.figure-mention')).toHaveCount(2);
  await expect(card(visitor, 'Opening of the museum').locator('.community-edited')).toHaveCount(0);

  // the author sees it accepted
  await page.reload();
  await page.waitForSelector('#timeline-content .event');
  await page.click('#settings-btn');
  await expect(page.locator('.my-edit .status-badge')).toHaveText('Accepted');

  // History keeps the original value and who decided; Revert brings the original back
  await admin.click('#tab-history');
  const history = admin.locator('.review-event');
  await expect(history.locator('.review-step-head').first()).toHaveText('Original values');
  await expect(history).toContainText(ORIGINAL);
  await expect(history).toContainText('approved by you');
  admin.on('dialog', dialog => dialog.accept());
  await history.getByRole('button', { name: 'Revert' }).click();
  await expect(admin.locator('.review-step')).toHaveCount(2);
  await visitor.reload();
  await visitor.waitForSelector('#timeline-content .event');
  await expect(card(visitor, 'Max Schmeling knocks out Joe Louis').locator('.event-description')).toHaveText(ORIGINAL);
});

test('a rejection needs a reason, which the author sees and can revise', async ({ page, browser }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await suggest(page, { description: 'Schmeling wins on June 19.' });

  const admin = await browser.newPage();
  await openReview(admin);
  const edit = admin.locator('.review-edit');
  await edit.getByRole('button', { name: 'Reject…' }).click();
  await edit.getByRole('button', { name: 'Reject edit' }).click();
  await expect(edit.locator('.review-error')).toHaveText('Give the author a reason, so they know what to change.');
  await edit.getByLabel('Reason for the author (they can revise the edit)').fill('Keep the round and the stadium.');
  await edit.getByRole('button', { name: 'Reject edit' }).click();
  await expect(admin.locator('.review-empty')).toHaveText('No edits are waiting for review.');

  await page.reload();
  await page.waitForSelector('#timeline-content .event');
  await page.click('#settings-btn');
  const item = page.locator('.my-edit');
  await expect(item.locator('.status-badge')).toHaveText('Rejected');
  await expect(item.locator('.my-edit-reason')).toHaveText('Keep the round and the stadium.');
  await expect(item.getByRole('button', { name: 'Revise' })).toBeVisible();
});

test('a suggested new event appears for visitors once approved', async ({ page, browser }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await page.click('#settings-btn');
  await page.locator('#editing-toggle').setChecked(true);
  await page.click('.settings-close-btn');
  await page.click('#suggest-event');
  await page.fill('#se-name', 'Founding of Example Town');
  await page.fill('#se-time', 'May 1, 1820');
  await page.fill('#se-description', 'The town is incorporated.');
  await page.selectOption('#se-category', 'politics');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  const admin = await browser.newPage();
  await openReview(admin);
  await admin.getByRole('button', { name: 'Approve new event' }).click();
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 0');

  const visitor = await browser.newPage();
  await openWorld(visitor);
  await visitor.fill('#searchInput', 'Example Town');
  await expect(card(visitor, 'Founding of Example Town').locator('.community-edited')).toHaveText('Revised');
});

test('an edit written before another approval of the same field waits under Conflicts', async ({ page, browser }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await suggest(page, { description: 'First version.' });
  await page.reload();
  await page.waitForSelector('#timeline-content .event');
  await suggest(page, { description: 'Second version.' });

  const admin = await browser.newPage();
  await openReview(admin);
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 2');
  await admin.locator('.review-edit').first().getByRole('button', { name: 'Approve 1 change' }).click();
  await expect(admin.locator('#tab-conflicts')).toHaveText('Conflicts · 1');
  await admin.click('#tab-conflicts');
  await expect(admin.locator('.review-conflict')).toContainText('Published since this edit was written: First version.');
  await admin.getByRole('button', { name: 'Approve 1 change' }).click();
  await expect(admin.locator('#tab-conflicts')).toHaveText('Conflicts · 0');

  const visitor = await browser.newPage();
  await openWorld(visitor);
  await expect(card(visitor, 'Max Schmeling knocks out Joe Louis').locator('.event-description')).toHaveText('Second version.');
});

test('the review page is for admins only', async ({ page }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await page.click('#settings-btn');
  await expect(page.locator('#review-link')).toBeHidden();
  await page.goto('/history/review.html?emulator');
  await expect(page.locator('#review-status')).toHaveText('Only admins can review edits.');
});
