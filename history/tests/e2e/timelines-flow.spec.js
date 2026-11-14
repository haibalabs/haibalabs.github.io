import { test, expect } from './cdn-cache.js';
import { EMULATORS_RUNNING, createAccount, listAsOwner, resetEmulators, signIn } from './emulator.js';
import { keepMapOffline } from './firebase-stub.js';

// Personal timelines (history-dp docs/site/PERSONAL-TIMELINES.md), against the local Firebase emulators.
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

test.beforeEach(async ({ page, request }) => {
  await keepMapOffline(page);
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
