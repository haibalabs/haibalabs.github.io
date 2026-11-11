import { test, expect } from '@playwright/test';
import { EMULATORS_RUNNING, createAccount, listAsOwner, resetEmulators, signIn } from './emulator.js';

// Personal timelines (PERSONAL-TIMELINES.md), against the local Firebase emulators.
test.skip(!EMULATORS_RUNNING, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

const WORLD = ['Founding of the archive', 'Opening of the museum', 'First public lecture'].map((name, i) => ({
  event_id: `evt_0000000${i + 1}-0000-4000-8000-000000000000`, name, enhanced_time: String(1901 + i),
  enhanced_description: `${name}, a world fixture.`, categories: ['culture'], figures: [], locations: [], confidence: 'high',
}));

async function openWorld(page, query = '') {
  await page.route('**/canonical-t2.json', route => route.fulfill({ json: WORLD }));
  await page.goto(`/history/index.html?emulator&file=canonical-t2.json${query}`);
  await page.waitForSelector('#timeline-content .event');
}

// The rendered card whose title is name.
const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });
const timelineId = (page) => new URL(page.url()).searchParams.get('timeline');

async function createTimeline(page, title) {
  await page.fill('#timeline-title', title);
  await page.click('#timeline-create button[type="submit"]');
  await expect(page.locator('#timeline-pill .timeline-pill-title')).toHaveText(title);
  return timelineId(page);
}

async function fillEvent(page, name, time, description = `${name}, a personal event.`) {
  await page.fill('#add-event-form [name="name"]', name);
  await page.fill('#add-event-form [name="enhanced_time"]', time);
  await page.fill('#add-event-form [name="enhanced_description"]', description);
  await page.click('#add-event-form button[type="submit"]');
}

async function addEvent(page, name, time) {
  await page.click('#add-event');
  await fillEvent(page, name, time);
  await expect(card(page, name)).toHaveCount(1);
}

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
  await createAccount(request, 'editor@example.test', 'editor');
  await createAccount(request, 'viewer@example.test', 'viewer');
});

test('an editor creates a timeline, adds an event that saves at once, and finds it after a reload', async ({ page, request }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  await expect(page.locator('#my-timelines')).toBeVisible();
  await expect(page.locator('.timeline-empty')).toHaveText('No timelines yet.');

  const id = await createTimeline(page, 'Family history');
  expect(id).toMatch(/^tl_[0-9a-f-]{36}$/);
  await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
  await expect(page.locator('#add-event')).toBeVisible();

  await addEvent(page, 'Grandmother born', 'March 1901');
  const personal = card(page, 'Grandmother born');
  await expect(personal).toHaveClass(/personal/);
  await expect(personal.locator('.personal-label')).toHaveText('Personal');
  // interleaved with world events in date order
  const names = await page.locator('#timeline-content .event .event-header').allTextContents();
  expect(names.map(n => n.trim().split('\n')[0])).toEqual(['Founding of the archive', 'Grandmother born', 'Opening of the museum', 'First public lecture']);

  const docs = await listAsOwner(request, `timelines/${id}/events`);
  expect(docs).toHaveLength(1);
  const { fields } = docs[0];
  expect(fields.name.stringValue).toBe('Grandmother born');
  expect(fields.event_id.stringValue).toMatch(/^evt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(fields.timelineCreatedAt.timestampValue).toBeTruthy();
  for (const local of ['personal', 'timelineId', 'dirty', 'sourceTimestamp']) expect(fields[local]).toBeUndefined();

  await page.reload();
  await expect(card(page, 'Grandmother born')).toHaveCount(1);
  await expect(page.locator('#timeline-pill .timeline-pill-title')).toHaveText('Family history');
  await page.click('#settings-btn');
  await expect(page.locator('.timeline-item .timeline-count')).toHaveText('1 event');
});

test('new personal events start as People, and the People filter shows only while a timeline is open', async ({ page, request }) => {
  await openWorld(page);
  const people = page.locator('.filters [data-label="people"]');
  await expect(people).toBeHidden();
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  await expect(people).toBeVisible();

  await page.click('#add-event');
  await expect(page.locator('#add-event-form [name="categories"]')).toHaveValue('people');
  await fillEvent(page, 'Grandmother born', 'March 1901');
  await expect(card(page, 'Grandmother born')).toHaveCount(1);
  const [doc] = await listAsOwner(request, `timelines/${id}/events`);
  expect(doc.fields.categories.arrayValue.values.map(v => v.stringValue)).toEqual(['people']);

  await people.click();
  await expect(page.locator('#timeline-content .event')).toHaveCount(1);
  await expect(card(page, 'Grandmother born')).toHaveCount(1);

  // closing the timeline hides the filter and returns to all events
  await page.click('#timeline-pill-btn');
  await page.click('#timeline-menu [data-action="close"]');
  await expect(people).toBeHidden();
  await expect(page.locator('.filters [data-label="all"]')).toHaveClass(/active/);
  await expect(page.locator('#timeline-content .event')).toHaveCount(3);
});

test('the pill switches between with world history and this timeline only, and closes the timeline', async ({ page }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  await createTimeline(page, 'Projects');
  await addEvent(page, 'Project kickoff', '1950');

  await page.click('#timeline-pill-btn');
  await page.click('#timeline-menu [data-view="only"]');
  await expect(page.locator('#timeline-content .event')).toHaveCount(1);
  await expect(card(page, 'Project kickoff')).toHaveCount(1);

  await page.click('#timeline-pill-btn');
  await expect(page.locator('#timeline-menu [data-view="only"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('#timeline-menu [data-view="with-world"]');
  await expect(page.locator('#timeline-content .event')).toHaveCount(4);

  await page.click('#timeline-pill-btn');
  await page.click('#timeline-menu [data-action="close"]');
  await expect(page.locator('#timeline-pill')).toBeHidden();
  await expect(page.locator('#timeline-content .event')).toHaveCount(3);
  await expect(page.locator('#add-event')).toBeHidden();
  expect(timelineId(page)).toBeNull();
});

test('a date the timeline cannot place is refused in the form', async ({ page, request }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  await page.click('#add-event');
  await fillEvent(page, 'Mystery day', 'sometime');
  await expect(page.locator('#add-event-form .form-error')).toHaveText(/"sometime" is not a date the timeline can place/);
  await expect(page.locator('#add-event-modal')).toBeVisible();
  expect(await listAsOwner(request, `timelines/${id}/events`)).toHaveLength(0);
});

test('a personal event can be edited and deleted from its card', async ({ page, request }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  await addEvent(page, 'Grandfather born', '1905');

  await card(page, 'Grandfather born').locator('.personal-edit').click();
  await expect(page.locator('#add-event-modal .modal-header h3')).toHaveText('Edit event');
  await expect(page.locator('#add-event-form [name="enhanced_time"]')).toHaveValue('1905');
  await page.fill('#add-event-form [name="name"]', 'Grandfather born in Lyon');
  await page.click('#add-event-form button[type="submit"]');
  await expect(card(page, 'Grandfather born in Lyon')).toHaveCount(1);
  let docs = await listAsOwner(request, `timelines/${id}/events`);
  expect(docs).toHaveLength(1);
  expect(docs[0].fields.name.stringValue).toBe('Grandfather born in Lyon');

  page.once('dialog', dialog => dialog.accept());
  await card(page, 'Grandfather born in Lyon').locator('.personal-remove').click();
  await expect(card(page, 'Grandfather born in Lyon')).toHaveCount(0);
  docs = await listAsOwner(request, `timelines/${id}/events`);
  expect(docs).toHaveLength(0);
});

test('a timeline can be renamed, and deleting it removes its events', async ({ page, request }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  await addEvent(page, 'Wedding', '1930');

  await page.click('#settings-btn');
  const item = page.locator(`.timeline-item[data-timeline-id="${id}"]`);
  await item.getByRole('button', { name: 'Rename' }).click();
  await page.fill('.timeline-rename input', 'The Martins');
  await page.click('.timeline-rename button[type="submit"]');
  await expect(item.locator('.timeline-title')).toHaveText('The Martins');
  await expect(page.locator('#timeline-pill .timeline-pill-title')).toHaveText('The Martins');

  let message = '';
  page.once('dialog', dialog => { message = dialog.message(); dialog.accept(); });
  await item.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.timeline-empty')).toHaveText('No timelines yet.');
  expect(message).toContain('"The Martins" and its 1 event');
  await expect(page.locator('#timeline-pill')).toBeHidden();
  expect(await listAsOwner(request, 'timelines')).toHaveLength(0);
  expect(await listAsOwner(request, `timelines/${id}/events`)).toHaveLength(0);
});

test('viewers cannot create timelines, and another account\'s timeline link does not open', async ({ page, browser }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Private notes');
  await addEvent(page, 'Secret meeting', '1950');

  const other = await browser.newPage();
  await other.route('**/canonical-t2.json', route => route.fulfill({ json: WORLD }));
  await other.goto(`/history/index.html?emulator&file=canonical-t2.json&timeline=${id}`);
  await other.waitForSelector('#timeline-content .event');
  await expect(other.locator('.toast', { hasText: 'Sign in from the settings panel' })).toHaveCount(1);
  await signIn(other, 'viewer@example.test');
  await expect(other.locator('#user-email')).toHaveText('viewer@example.test');
  await expect(other.locator('#my-timelines')).toBeHidden();
  await expect(other.locator('.toast', { hasText: 'does not exist, or this account cannot open it' })).toHaveCount(1);
  expect(new URL(other.url()).searchParams.get('timeline')).toBeNull();
  await expect(card(other, 'Secret meeting')).toHaveCount(0);
  await expect(other.locator('#timeline-pill')).toBeHidden();
  await other.close();
});

test('personal event text is shown as text, never run as HTML', async ({ page }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  await createTimeline(page, 'Family history');
  const name = '<img src=x onerror="window.__injected=1">Picnic';
  await page.click('#add-event');
  await fillEvent(page, name, '1950', '<b>bold?</b> & more');
  await expect(card(page, 'Picnic')).toHaveCount(1);
  await expect(card(page, 'Picnic').locator('.event-header')).toContainText(name);
  await expect(card(page, 'Picnic').locator('.event-description')).toHaveText('<b>bold?</b> & more');
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  await expect(card(page, 'Picnic').locator('img, b')).toHaveCount(0);
});

async function setEditing(page, on) {
  await page.click('#settings-btn');
  await page.locator('#editing-toggle').setChecked(on);
  await page.click('.settings-close-btn');
}

test('one add button: it asks where only when world history is shown and editing is on', async ({ page }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  const choice = page.locator('#add-choice');
  // editing off: the button opens the timeline's form at once
  await expect(page.locator('#suggest-event')).toBeHidden();
  await page.click('#add-event');
  await expect(page.locator('#add-event-modal')).toBeVisible();
  await page.click('#cancel-add');

  // editing on with a timeline open: the world suggestion moves into the same button, which asks
  await setEditing(page, true);
  await expect(page.locator('#suggest-event')).toBeHidden();
  await page.click('#add-event');
  await expect(choice).toBeVisible();
  await expect(choice.locator('[data-target="timeline"]')).toHaveText('Add to Family history');
  await choice.locator('[data-target="world"]').click();
  await expect(page.locator('#suggest-edit-modal')).toBeVisible();
  await page.click('#se-cancel');
  await page.click('#add-event');
  await expect(choice.locator('[data-target="timeline"]')).toBeFocused();
  await choice.locator('[data-target="timeline"]').click();
  await expect(page.locator('#add-event-modal')).toBeVisible();
  await page.click('#cancel-add');

  // opened on a phone, signed in with editing on, the button and its menu stay on screen
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await openWorld(phone, `&timeline=${id}`);
  await expect(phone.locator('#timeline-pill .timeline-pill-title')).toHaveText('Family history');
  // DIAGNOSTIC, removed before review: where the header's parts sit at phone width for a signed-in editor
  console.log('PHONE-HEADER', JSON.stringify(await phone.evaluate(() => {
    const header = document.querySelector('.header');
    const parts = [...header.querySelectorAll('.bar > *, .bar > .action-buttons > *, .filters, .header > *:not(.bar)')]
      .filter(node => node.offsetParent !== null)
      .map(node => { const r = node.getBoundingClientRect(); return `${node.id || node.className}:${Math.round(r.left)}-${Math.round(r.right)}@${Math.round(r.top)}`; });
    return { columns: getComputedStyle(header).gridTemplateColumns, header: header.getBoundingClientRect().width, parts };
  })));
  await phone.click('#add-event');
  const box = await phone.locator('#add-choice').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await phone.close();

  // this timeline only: straight to the timeline's form
  await page.click('#timeline-pill-btn');
  await page.click('#timeline-menu [data-view="only"]');
  await page.click('#add-event');
  await expect(choice).toBeHidden();
  await expect(page.locator('#add-event-modal')).toBeVisible();
  await page.click('#cancel-add');

  // closing the timeline brings back the world suggestion button on its own
  await page.click('#timeline-pill-btn');
  await page.click('#timeline-menu [data-action="close"]');
  await expect(page.locator('#add-event')).toBeHidden();
  await expect(page.locator('#suggest-event')).toBeVisible();
});

// The live site loads the published release (data/manifest.json and its shards), not a single world file.
const RELEASE = {
  'events/e0.json': { format: 'historiline-events/v1', shard: 'd000', family: 'dated',
    events: WORLD.map(event => ({ ...event, event_version: `v_${event.event_id}`, visible: true, wikipedia_url: '' })) },
  'places/p0.json': { format: 'historiline-places/v1', bucket: 0, places: [] },
  'corrections/c0.json': [],
};
const MANIFEST = { format: 'historiline-manifest/v1', created_at: '2026-11-11T00:00:00Z',
  shards: [{ id: 'd000', count: WORLD.length, sha256: 'e0' }],
  places: { buckets: 64, files: [{ bucket: 0, count: 0, sha256: 'p0' }] }, corrections: { sha256: 'c0' } };

async function openPublished(page) {
  await page.route('**/history/data/**', route => {
    const file = new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '');
    if (file === 'manifest.json') return route.fulfill({ json: MANIFEST });
    return RELEASE[file] ? route.fulfill({ json: RELEASE[file] }) : route.fulfill({ status: 404 });
  });
  await page.goto('/history/index.html?emulator');
  await page.waitForSelector('#timeline-content .event');
}

test('on the published release, a timeline event is saved, kept across a reload, edited and deleted', async ({ page, request }) => {
  await openPublished(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  await addEvent(page, 'Grandmother born', 'March 1901');
  const names = await page.locator('#timeline-content .event .event-header').allTextContents();
  expect(names.map(n => n.trim().split('\n')[0])).toEqual(['Founding of the archive', 'Grandmother born', 'Opening of the museum', 'First public lecture']);
  expect(await listAsOwner(request, `timelines/${id}/events`)).toHaveLength(1);

  await page.reload();
  await expect(card(page, 'Grandmother born')).toHaveCount(1);
  await expect(page.locator('#timeline-pill .timeline-pill-title')).toHaveText('Family history');

  await page.click('#timeline-pill-btn');
  await page.click('#timeline-menu [data-view="only"]');
  await expect(page.locator('#timeline-content .event')).toHaveCount(1);
  await page.click('#timeline-pill-btn');
  await page.click('#timeline-menu [data-view="with-world"]');
  await expect(page.locator('#timeline-content .event')).toHaveCount(4);

  await card(page, 'Grandmother born').locator('.personal-edit').click();
  await page.fill('#add-event-form [name="name"]', 'Grandmother born in Fez');
  await page.click('#add-event-form button[type="submit"]');
  await expect(card(page, 'Grandmother born in Fez')).toHaveCount(1);
  expect((await listAsOwner(request, `timelines/${id}/events`))[0].fields.name.stringValue).toBe('Grandmother born in Fez');

  page.once('dialog', dialog => dialog.accept());
  await card(page, 'Grandmother born in Fez').locator('.personal-remove').click();
  await expect(card(page, 'Grandmother born in Fez')).toHaveCount(0);
  expect(await listAsOwner(request, `timelines/${id}/events`)).toHaveLength(0);
});
