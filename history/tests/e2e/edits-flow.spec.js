import { test, expect } from './cdn-cache.js';
import { EMULATORS_RUNNING, createAccount, listAsOwner, resetEmulators, signIn } from './emulator.js';
import { keepMapOffline } from './firebase-stub.js';

// Suggesting edits to world events (history-dp docs/site/WORLD-EDITS.md, phase 1), against the local Firebase
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
