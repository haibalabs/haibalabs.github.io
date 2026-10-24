import { test, expect } from '@playwright/test';
import { EMULATORS_RUNNING, createAccount, listAsOwner, resetEmulators, signIn, writeAsOwner } from './emulator.js';

// Firestore sync keyed by event_id, against the local Firebase emulators.
test.skip(!EMULATORS_RUNNING, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

const id = (n) => `evt_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const fixtureEvent = (n, name, extra = {}) => ({
  event_id: id(n), name, enhanced_time: String(1900 + n), enhanced_description: `${name}, a sync fixture.`,
  categories: ['culture'], figures: [], locations: [], confidence: 'high', ...extra,
});
const WORLD = [fixtureEvent(1, 'Founding of the archive'), fixtureEvent(2, 'Opening of the museum'), fixtureEvent(3, 'First public lecture')];

// Serves events as the recognized world snapshot (canonical-t2.json).
async function openWorld(page, events = WORLD) {
  await page.route('**/canonical-t2.json', route => route.fulfill({ json: events }));
  await page.goto('/history/index.html?emulator&file=canonical-t2.json');
  await page.waitForSelector('#timeline-content .event');
}

async function enableSync(page) {
  await expect(page.locator('#debug-settings')).toBeVisible();
  await page.check('#debug-sync');
  await expect(page.locator('.sync-controls')).toBeVisible();
}

async function addEvent(page, name) {
  await page.check('#debug-add-event');
  await page.click('.settings-close-btn');
  await page.click('#add-event');
  await page.fill('#add-event-form [name="name"]', name);
  await page.fill('#add-event-form [name="enhanced_time"]', '1950');
  await page.fill('#add-event-form [name="enhanced_description"]', `${name}, added in the browser.`);
  await page.click('#add-event-form button[type="submit"]');
  const card = page.locator('.event', { hasText: name });
  await expect(card).toHaveCount(1);
  return card.getAttribute('data-event-id');
}

// The rendered card whose title is name (descriptions may still mention an old name).
const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });
const serverEvent = (event) => ({ ...event, userId: 'other-editor', lastModified: new Date() });

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
  await createAccount(request, 'admin@example.test', 'admin');
});

test('the legacy dataset cannot sync and says why', async ({ page }) => {
  await page.goto('/history/index.html?emulator&file=events_sample_small.json');
  await signIn(page, 'admin@example.test');
  await enableSync(page);
  await expect(page.locator('.sync-status')).toHaveText(/not a recognized shared dataset/);
  await expect(page.locator('#pull-changes')).toBeDisabled();
  await expect(page.locator('#push-changes')).toBeDisabled();
});

test('records sharing an event_id all render and sync is disabled', async ({ page }) => {
  const shared = { event_id: id(9) };
  await openWorld(page, [...WORLD, fixtureEvent(9, 'Siege of Paris', shared), fixtureEvent(9, 'Treaty of Frankfurt', { ...shared, enhanced_time: '1871' })]);
  await expect(card(page, 'Siege of Paris')).toHaveCount(1);
  await expect(card(page, 'Treaty of Frankfurt')).toHaveCount(1);
  const ids = await page.locator('#timeline-content .event').evaluateAll(els => els.map(el => el.dataset.eventId));
  expect(new Set(ids).size).toBe(ids.length);

  await signIn(page, 'admin@example.test');
  await enableSync(page);
  await expect(page.locator('.sync-status')).toHaveText(/shared by more than one event/);
  await expect(page.locator('#pull-changes')).toBeDisabled();
});

test('a pushed event is stored under its event_id without local sync fields', async ({ page, request }) => {
  await openWorld(page);
  await signIn(page, 'admin@example.test');
  const eventId = await addEvent(page, 'Browser-added event');
  expect(eventId).toMatch(/^evt_[0-9a-f-]{36}$/);

  await page.click('#settings-btn');
  await enableSync(page);
  await expect(page.locator('#push-changes')).toHaveText(/Push \(1\)/);
  await page.click('#push-changes');
  await expect(page.locator('.sync-status')).toHaveText(/Pushed 1 events/);

  const docs = await listAsOwner(request, 'events_main');
  expect(docs).toHaveLength(1);
  const { name: path, fields } = docs[0];
  expect(path.endsWith(`/events_main/${eventId}`)).toBe(true);
  expect(fields.event_id.stringValue).toBe(eventId);
  expect(fields.name.stringValue).toBe('Browser-added event');
  for (const local of ['dirty', 'syncedRevision', 'isNew', 'sourceTimestamp']) expect(fields[local]).toBeUndefined();
  await expect(page.locator('#push-changes')).toBeDisabled();
});

test('an untouched event takes a newer server revision, keeping its ID through a rename', async ({ page, request }) => {
  await openWorld(page);
  await writeAsOwner(request, `events_main/${id(2)}`, serverEvent({ ...WORLD[1], name: 'Museum renamed on the server' }));
  await signIn(page, 'admin@example.test');
  await enableSync(page);
  await page.click('#pull-changes');
  await expect(page.locator('.sync-status')).toHaveText(/Pulled 1 events/);
  await expect(card(page, 'Museum renamed on the server')).toHaveAttribute('data-event-id', id(2));
  await expect(card(page, 'Opening of the museum')).toHaveCount(0);
  await expect(page.locator('.sync-conflict')).toHaveCount(0);
});

for (const [keep, button] of [['server', 'Take theirs'], ['local', 'Keep mine']]) {
  test(`a conflicting server change is held until resolved (${button})`, async ({ page, request }) => {
    await openWorld(page);
    await signIn(page, 'admin@example.test');
    const eventId = await addEvent(page, 'Local version');
    await writeAsOwner(request, `events_main/${eventId}`, serverEvent(fixtureEvent(0, 'Server version', { event_id: eventId })));

    await page.click('#settings-btn');
    await enableSync(page);
    await page.click('#pull-changes');
    await expect(page.locator('.sync-status')).toHaveText(/1 conflicting change to resolve/);
    const row = page.locator(`.sync-conflict[data-event-id="${eventId}"]`);
    await expect(row).toBeVisible();
    // the conflicted event is not pushed while unresolved, and the local version is kept
    await expect(page.locator('#push-changes')).toBeDisabled();
    await expect(card(page, 'Local version')).toHaveCount(1);

    // a second pull still reports the conflict rather than skipping past it
    await page.click('#pull-changes');
    await expect(page.locator('.sync-status')).toHaveText(/1 conflicting change to resolve/);

    await row.getByRole('button', { name: button }).click();
    await expect(page.locator('.sync-conflict')).toHaveCount(0);
    if (keep === 'server') {
      await expect(card(page, 'Server version')).toHaveAttribute('data-event-id', eventId);
      await expect(page.locator('#push-changes')).toBeDisabled();
    } else {
      await expect(page.locator('#push-changes')).toHaveText(/Push \(1\)/);
      await page.click('#push-changes');
      await expect(page.locator('.sync-status')).toHaveText(/Pushed 1 events/);
      const [doc] = await listAsOwner(request, 'events_main');
      expect(doc.fields.name.stringValue).toBe('Local version');
    }
  });
}
