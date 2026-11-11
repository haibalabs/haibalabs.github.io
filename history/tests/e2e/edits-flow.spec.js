import { test, expect } from '@playwright/test';
import { EMULATORS_RUNNING, createAccount, listAsOwner, resetEmulators, signIn } from './emulator.js';
import { keepMapOffline } from './firebase-stub.js';

// Suggesting edits to world events (WORLD-EDITS.md, phase 1), against the local Firebase
// emulators, with Wikipedia's API stubbed.
test.skip(!EMULATORS_RUNNING, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

const id = (n) => `evt_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WORLD = [
  { event_id: id(1), name: 'Max Schmeling knocks out Joe Louis', enhanced_time: '1936-06-19',
    enhanced_description: 'Schmeling knocks out Louis on June 13, 1936.', categories: ['culture'],
    figures: ['Max Schmeling', 'Joe Louis'], locations: [], confidence: 'high',
    wikipedia_url: 'https://en.wikipedia.org/wiki/Joe_Louis_vs._Max_Schmeling' },
  { event_id: id(2), name: 'Opening of the museum', enhanced_time: '1902', enhanced_description: 'A sync fixture.',
    categories: ['culture'], figures: [], locations: [], confidence: 'high' },
];

async function openWorld(page) {
  await page.route('**/canonical-t2.json', route => route.fulfill({ json: WORLD }));
  await page.route('https://en.wikipedia.org/w/rest.php/v1/search/title**', route => route.fulfill({ json: { pages: [
    { key: 'Joe_Louis', title: 'Joe Louis', description: 'American boxer (1914–1981)' },
    { key: 'Joe_Louis_(disambiguation)', title: 'Joe Louis (disambiguation)', description: 'Topics referred to by the same term' },
  ] } }));
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (route) => {
    const title = decodeURIComponent(route.request().url().split('/summary/')[1]);
    if (title === 'Saar') return route.fulfill({ json: { type: 'disambiguation', title: 'Saar' } });
    if (title === 'No_such_page') return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ json: { type: 'standard', title: title.replace(/_/g, ' '), description: 'An article' } });
  });
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

// the Editing switch is in My edits, in the profile drawer
async function setEditing(page, on) {
  await page.click('#settings-btn');
  await page.locator('#editing-toggle').setChecked(on);
  await page.click('.settings-close-btn');
}

async function suggestDescriptionEdit(page, description) {
  await card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  await expect(page.locator('#suggest-edit-modal')).toBeVisible();
  await page.fill('#se-description', description);
}

test.beforeEach(async ({ page, request }) => {
  await keepMapOffline(page);
  await resetEmulators(request);
  await createAccount(request, 'editor@example.test', 'editor');
  await createAccount(request, 'viewer@example.test', 'viewer');
});

test('the Editing switch is for editors, starts off and is remembered', async ({ page }) => {
  await openWorld(page);
  await expect(page.locator('#editing-toggle')).toBeHidden();
  await signInAs(page, 'editor@example.test');
  await page.click('#settings-btn');
  const toggle = page.locator('#editing-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await page.click('.settings-close-btn');
  await expect(page.locator('.edit-pencil')).toHaveCount(0);

  await setEditing(page, true);
  // the pencil sits in the date row, beside the Wikipedia icon
  const row = card(page, 'Max Schmeling knocks out Joe Louis').locator('.event-time');
  await expect(row.locator('.wiki-link + .edit-pencil')).toHaveCount(1);

  await page.reload();
  await page.waitForSelector('#timeline-content .event');
  await expect(page.locator('#editing-toggle')).toBeChecked();
  await expect(card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil')).toHaveCount(1);
  await setEditing(page, false);
  await expect(page.locator('.edit-pencil')).toHaveCount(0);
});

test('viewers and visitors get no switch and no pencil', async ({ page }) => {
  await openWorld(page);
  await signInAs(page, 'viewer@example.test');
  await expect(page.locator('#editing-toggle')).toBeHidden();
  await expect(page.locator('.edit-pencil')).toHaveCount(0);
  await expect(page.locator('#suggest-event')).toBeHidden();
  await page.click('#settings-btn');
  await expect(page.locator('#my-edits')).toBeHidden();
});

test('an editor suggests a new event from the empty form, then revises it', async ({ page, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await expect(page.locator('#suggest-event')).toBeHidden();
  await setEditing(page, true);

  await page.click('#suggest-event');
  await expect(page.locator('#suggest-edit-title')).toHaveText('Suggest a new event');
  for (const field of ['#se-name', '#se-time', '#se-description', '#se-wiki']) await expect(page.locator(field)).toHaveValue('');
  await expect(page.locator('.person')).toHaveCount(0);
  await page.fill('#se-name', 'Founding of Example Town');
  await expect(page.locator('.form-group[data-field="name"] .changed-tag')).toBeHidden();
  await page.click('#se-submit');
  await expect(page.locator('#suggest-edit-form .form-error')).toHaveText('The event needs a date.');
  await page.fill('#se-time', 'May 1, 1820');
  await page.fill('#se-description', 'The town is incorporated.');
  await page.selectOption('#se-category', 'politics');
  await page.click('#se-submit');
  await expect(page.locator('#suggest-edit-modal')).toBeHidden();
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  const [created] = await listAsOwner(request, 'edits');
  const fields = created.fields;
  expect(fields.kind.stringValue).toBe('create');
  expect(fields.event_id.stringValue).toMatch(/^evt_[0-9a-f-]{36}$/);
  expect(fields.event_name.stringValue).toBe('Founding of Example Town');
  const changes = fields.changes.mapValue.fields;
  expect(Object.keys(changes).sort()).toEqual(['categories', 'enhanced_description', 'enhanced_time', 'name']);
  for (const change of Object.values(changes)) expect(change.mapValue.fields.before.nullValue).toBe(null);

  await page.click('#settings-btn');
  const item = page.locator('.my-edit', { hasText: 'Founding of Example Town' });
  await expect(item.locator('.my-edit-fields')).toHaveText('New event');
  await item.getByRole('button', { name: 'Revise' }).click();
  await expect(page.locator('#suggest-edit-title')).toHaveText('Suggest a new event');
  await expect(page.locator('#se-description')).toHaveValue('The town is incorporated.');
  await page.fill('#se-name', 'Founding of Example City');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Revision sent for review.' })).toHaveCount(1);
  const revised = (await listAsOwner(request, 'edits'))[0].fields;
  expect(revised.revision.integerValue).toBe('2');
  expect(revised.event_id.stringValue).toBe(fields.event_id.stringValue);
  expect(revised.event_name.stringValue).toBe('Founding of Example City');

  // the pencil still opens the ordinary form afterwards
  await card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  await expect(page.locator('#suggest-edit-title')).toHaveText('Suggest an edit');
  await expect(page.locator('#se-name')).toHaveValue('Max Schmeling knocks out Joe Louis');
});

test('an editor suggests an edit with linked people; it waits for review and only the author sees it', async ({ page, browser, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await setEditing(page, true);

  await suggestDescriptionEdit(page, 'Schmeling knocks out Louis on June 19, 1936.');
  const description = page.locator('.form-group[data-field="enhanced_description"]');
  await expect(description.locator('.changed-tag')).toBeVisible();
  await expect(page.locator('.form-group[data-field="name"] .changed-tag')).toBeHidden();
  await expect(page.locator('.form-group[data-field="categories"] .changed-tag')).toBeHidden();

  // link the existing Joe Louis to his article, and add a new, unlinked person
  const joe = page.locator('.person', { hasText: 'Joe Louis' });
  await expect(joe.locator('.person-link')).toHaveText('Not linked');
  await joe.getByRole('button', { name: 'Link to article' }).click();
  await page.locator('#se-person-results button', { hasText: 'American boxer (1914–1981)' }).click();
  await expect(joe.locator('.person-link')).toHaveText('Linked · American boxer (1914–1981)');
  await page.fill('#se-person', 'Arthur Donovan');
  await page.locator('#se-person-results button', { hasText: 'Add “Arthur Donovan” without a link' }).click();
  await expect(page.locator('.person', { hasText: 'Arthur Donovan' }).locator('.person-link')).toHaveText('Not linked');
  await expect(page.locator('.form-group[data-field="figures"] .changed-tag')).toBeVisible();

  await page.click('#se-submit');
  await expect(page.locator('#suggest-edit-modal')).toBeHidden();
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);
  await expect(card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pending')).toHaveText('Your edit is pending review');

  await page.click('#settings-btn');
  const item = page.locator('.my-edit', { hasText: 'Max Schmeling knocks out Joe Louis' });
  await expect(item.locator('.status-badge')).toHaveText('Waiting for review');
  await expect(item.locator('.my-edit-fields')).toHaveText('Description, People');
  await expect(page.locator('#my-edits-count')).toHaveText('1 of 50 today');

  const docs = await listAsOwner(request, 'edits');
  expect(docs).toHaveLength(1);
  const fields = docs[0].fields;
  expect(fields.status.stringValue).toBe('submitted');
  expect(fields.revision.integerValue).toBe('1');
  expect(fields.author.mapValue.fields.email.stringValue).toBe('editor@example.test');
  expect(Object.keys(fields.changes.mapValue.fields).sort()).toEqual(['enhanced_description', 'figures']);
  const people = fields.changes.mapValue.fields.figures.mapValue.fields.after.arrayValue.values.map(v => v.mapValue.fields);
  expect(people.map(p => p.name.stringValue)).toEqual(['Max Schmeling', 'Joe Louis', 'Arthur Donovan']);
  expect(people[1].wikipedia_url.stringValue).toBe('https://en.wikipedia.org/wiki/Joe_Louis');
  expect(people[2].wikipedia_url).toBeUndefined();

  // a visitor sees the event unchanged and no pending mark
  const visitor = await browser.newPage();
  await openWorld(visitor);
  await expect(card(visitor, 'Max Schmeling knocks out Joe Louis').locator('.event-description, p').first()).not.toContainText('June 19');
  await expect(visitor.locator('.edit-pending')).toHaveCount(0);
});

test('a Wikipedia link must be a real article, not a disambiguation page', async ({ page }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await setEditing(page, true);
  await card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  await page.fill('#se-wiki', 'en.wikipedia.org/wiki/Saar');
  await expect(page.locator('#se-wiki-check')).toHaveText(/disambiguation page/);
  await page.click('#se-submit');
  await expect(page.locator('#suggest-edit-form .form-error')).toHaveText(/disambiguation page/);
  await page.fill('#se-wiki', 'en.wikipedia.org/wiki/Joe Louis vs. Max Schmeling rematch');
  await expect(page.locator('#se-wiki-check')).toHaveText('✓ Article found: “Joe Louis vs. Max Schmeling rematch”');
  await page.fill('#se-time', 'sometime');
  await page.click('#se-submit');
  await expect(page.locator('#suggest-edit-form .form-error')).toHaveText(/not a date/);
});

// Holds Wikipedia's answer for "Slow_page" until release() is called.
async function slowArticle(page) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/Slow_page', async (route) => {
    await gate;
    await route.fulfill({ json: { type: 'standard', title: 'Slow page', description: 'An article' } });
  });
  return release;
}

test('sending twice while the Wikipedia check is pending writes one edit', async ({ page, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await setEditing(page, true);
  const release = await slowArticle(page);
  await card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  await page.fill('#se-wiki', 'en.wikipedia.org/wiki/Slow page');
  await page.evaluate(() => {
    const form = document.getElementById('suggest-edit-form');
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.locator('#se-submit')).toBeDisabled();
  release();
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);
  await expect(page.locator('#suggest-edit-modal')).toBeHidden();
  expect(await listAsOwner(request, 'edits')).toHaveLength(1);
});

test('cancelling while the Wikipedia check is pending writes nothing', async ({ page, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await setEditing(page, true);
  const release = await slowArticle(page);
  await card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  await page.fill('#se-wiki', 'en.wikipedia.org/wiki/Slow page');
  await page.evaluate(() => document.getElementById('suggest-edit-form').requestSubmit());
  await page.click('#se-cancel');
  await expect(page.locator('#suggest-edit-modal')).toBeHidden();
  release();
  await page.waitForTimeout(1500);
  expect(await listAsOwner(request, 'edits')).toHaveLength(0);
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(0);

  // the cancelled send doesn't leave the form locked: the next one goes through
  await suggestDescriptionEdit(page, 'Schmeling knocks out Louis on June 19, 1936.');
  await expect(page.locator('#se-submit')).toBeEnabled();
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);
  expect(await listAsOwner(request, 'edits')).toHaveLength(1);
});

test("an edit's name in My edits goes to its event, clearing a search that hides it", async ({ page }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await setEditing(page, true);
  await suggestDescriptionEdit(page, 'Schmeling knocks out Louis on June 19.');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  await page.fill('#searchInput', 'museum');
  await expect(card(page, 'Max Schmeling knocks out Joe Louis')).toHaveCount(0);
  await page.click('#settings-btn');
  await page.locator('.my-edit').getByRole('button', { name: 'Max Schmeling knocks out Joe Louis' }).click();
  await expect(page.locator('#settings-panel')).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('#searchInput')).toHaveValue('');
  await expect(card(page, 'Max Schmeling knocks out Joe Louis')).toBeInViewport();
});

test('the author revises and withdraws an edit from My edits', async ({ page, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await setEditing(page, true);
  await suggestDescriptionEdit(page, 'Schmeling knocks out Louis on June 19.');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  await page.click('#settings-btn');
  await page.locator('.my-edit').getByRole('button', { name: 'Revise' }).click();
  await expect(page.locator('#suggest-edit-modal')).toBeVisible();
  await expect(page.locator('#se-description')).toHaveValue('Schmeling knocks out Louis on June 19.');
  await expect(page.locator('#se-submit')).toHaveText('Send revision');
  await page.fill('#se-description', 'Schmeling knocks out Louis on June 19, 1936.');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Revision sent for review.' })).toHaveCount(1);
  const revised = (await listAsOwner(request, 'edits'))[0].fields;
  expect(revised.revision.integerValue).toBe('2');
  expect(revised.changes.mapValue.fields.enhanced_description.mapValue.fields.after.stringValue).toBe('Schmeling knocks out Louis on June 19, 1936.');

  page.once('dialog', dialog => dialog.accept());
  await page.click('#settings-btn');
  await page.locator('.my-edit').getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.locator('.my-edit')).toHaveCount(0);
  await expect(page.locator('.my-edits-empty')).toBeVisible();
  expect((await listAsOwner(request, 'edits'))[0].fields.status.stringValue).toBe('withdrawn');
  await page.click('.settings-close-btn');
  await expect(card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pending')).toHaveCount(0);
});
