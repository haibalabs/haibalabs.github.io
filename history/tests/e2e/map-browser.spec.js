import { test, expect } from './cdn-cache.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stubFirebase } from './firebase-stub.js';

// the area filter's bubbles load Supercluster from unpkg; tests serve the same version from node_modules
const SUPERCLUSTER = readFileSync(new URL('../../node_modules/supercluster/dist/supercluster.min.js', import.meta.url), 'utf8');

const location = (id, coordinates) => ({ place_id: id, name: id, geography: { status: 'reused', precision: 'approximate', coordinates } });
const fixtures = Array.from({ length: 80 }, (_, i) => ({
  event_id: `evt_${i}`, name: i === 78 ? 'Fixture [78]' : `Fixture ${i}`, enhanced_time: String(1900 + i),
  enhanced_description: 'Shared historical fixture.', categories: [i % 2 ? 'science' : 'culture'], figures: [], confidence: 'high',
  locations: i === 79 ? [] : [location('remote', [0, 120]), location(i === 19 ? 'secondary-19' : 'secondary', [20, i === 19 ? 15 : 0])]
}));
async function setup(page, query = '') {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === new URL(test.info().project.use.baseURL).origin || url.includes('unpkg.com/leaflet') || url.includes('www.gstatic.com/firebasejs/')) return route.continue();
    return route.abort();
  });
  await stubFirebase(page);
  await page.route('**/unpkg.com/supercluster@8.0.1/**', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: SUPERCLUSTER }));
  await page.route('**/map-fixture.json', route => route.fulfill({ json: fixtures }));
  await page.route('**/unverified-locations.json', route => route.fulfill({ json: [] }));
  await page.goto(`/history/index.html?file=map-fixture.json${query}`);
  await expect(page.locator('.event').first()).toBeVisible();
  // the lab opens the map drawer itself on wide screens
  if (!query.includes('lab')) await page.locator('#toggle-map').click();
  await expect.poll(() => page.locator('#map-panel').evaluate(el => getComputedStyle(el).right)).toBe('0px');
  await expect(page.getByRole('button', { name: 'Filter by visible area', exact: true })).toBeVisible();
}
test('an open map takes the width the timeline column and its period names do not need', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await setup(page);
  const layout = () => page.evaluate(() => {
    const column = document.getElementById('timeline').getBoundingClientRect();
    const panel = document.getElementById('map-panel').getBoundingClientRect();
    return { columnLeft: Math.round(column.left), gap: Math.round(panel.left - column.right), panel: Math.round(panel.width) };
  });
  // 1700 less the 200px period names, the 680px column and 64px for the panel tabs
  await expect.poll(layout).toEqual({ columnLeft: 200, gap: 64, panel: 756 });
  // a narrower window keeps the 620px panel and centres the column
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect.poll(layout).toEqual({ columnLeft: 50, gap: 50, panel: 620 });
});
test('map stays empty until selection and keeps only that event through pan, zoom and area filtering', async ({ page }) => {
  const errors = []; let geocodes = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('nominatim.openstreetmap.org')) geocodes++; });
  await setup(page);
  await expect(page.locator('.map-event-dot, .map-selected-dot')).toHaveCount(0);
  await page.locator('.leaflet-control-zoom-out').click();
  await expect(page.locator('.map-event-dot, .map-selected-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await expect(page.locator('.map-status')).toHaveText('79 events in selected area');
  await expect(page.locator('.map-event-dot, .map-selected-dot')).toHaveCount(0);
  await page.locator('#searchInput').fill('Fixture 19');
  await page.locator('.event[data-event-id="evt_19"]').getByRole('button', { name: 'Show on map', exact: true }).click();
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', 'evt_19');
  await expect(page.locator('.map-selected-dot')).toHaveCount(2);
  await expect(page.locator('.leaflet-popup, .map-selection, .event-map-button')).toHaveCount(0);
  expect(await page.locator('.event.map-selected').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  await page.locator('.leaflet-control-zoom-in').click();
  await expect(page.locator('#map')).not.toHaveClass(/leaflet-zoom-anim/);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.map-selected-dot')).toHaveCount(2);
  await expect(page.locator('.map-event-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await expect(page.locator('.map-status')).toHaveText('1 event in selected area');
  await expect(page.locator('.map-selected-dot')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(page.locator('#searchInput')).toHaveValue('Fixture 19');
  await expect(page.locator('.map-selected-dot')).toHaveCount(2);
  await page.locator('#searchInput').fill('Fixture 79');
  await expect(page.locator('.event[data-event-id="evt_79"]')).toBeVisible();
  await expect(page.locator('.map-selected-dot')).toHaveCount(0);
  expect(geocodes).toBe(0); expect(errors).toEqual([]);
});
test('clearing the area restores unmapped events and their honest map state', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await page.locator('#searchInput').fill('Fixture 79');
  await expect(page.locator('.map-status')).toHaveText('0 events in selected area');
  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(page.locator('.event[data-event-id="evt_79"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show on map', exact: true })).toHaveCount(0);
  await expect(page.locator('.map-selected-dot')).toHaveCount(0);
});
test('manager combines geographic, category, literal text and start-year filters', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { EventManager } = await import('./modules/event-manager.js');
    const manager = new EventManager();
    await manager.loadEvents('map-fixture.json');
    manager.setGeographicFilter({ bounds: { south: 19, north: 21, west: -1, east: 1 } });
    manager.setTimeRange(1930, 1950);
    const ids = manager.getFilteredEvents('science', 'fixture').map(e => e.event_id);
    manager.setGeographicFilter({});
    return { ids, afterClear: manager.getFilteredEvents('science', 'fixture').map(e => e.event_id) };
  });
  expect(result.ids).toEqual(Array.from({ length: 10 }, (_, i) => `evt_${31 + 2*i}`));
  expect(result.afterClear).toEqual(result.ids);
});

test('selected event dots return to its virtual card without moving the map', async ({ page }) => {
  await setup(page);
  await page.locator('#searchInput').fill('Fixture 19');
  await page.locator('.event[data-event-id="evt_19"]').getByRole('button', { name: 'Show on map', exact: true }).click();
  await page.locator('#searchInput').fill('');
  await expect(page.locator('.event').first()).toHaveAttribute('data-event-id', 'evt_0');
  await page.locator('#timeline-wrapper').evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.event.map-selected')).toHaveCount(0);
  const dot = page.locator('.map-selected-dot').first();
  const before = await dot.boundingBox();
  await dot.click();
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', 'evt_19');
  await expect(page.locator('.event.map-selected')).toBeInViewport();
  await expect(page.locator('.leaflet-popup, .map-event-dot')).toHaveCount(0);
  const after = await dot.boundingBox();
  expect(Math.abs(before.x - after.x)).toBeLessThan(1);
  expect(Math.abs(before.y - after.y)).toBeLessThan(1);
});

test('on a phone, closing the map drawer shows the cards that were on screen before it opened', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/map-fixture.json', route => route.fulfill({ json: fixtures }));
  await page.route('**/unverified-locations.json', route => route.fulfill({ json: [] }));
  await stubFirebase(page);
  await page.goto('/history/index.html?file=map-fixture.json');
  await expect(page.locator('.event').first()).toBeVisible();
  const wrapper = page.locator('#timeline-wrapper');
  await wrapper.evaluate(el => { el.scrollTop = 3000; });
  const topCard = () => page.evaluate(() => {
    const top = document.getElementById('timeline-wrapper').getBoundingClientRect();
    return [...document.querySelectorAll('#timeline-content > .event')]
      .find(card => { const r = card.getBoundingClientRect(); return r.bottom > top.top && r.top < top.bottom && r.width > 0; })?.dataset.eventId ?? null;
  });
  await expect.poll(topCard).not.toBeNull();
  const before = await topCard();
  // the closed tab sits off screen on a phone; the drawer covers the whole timeline while open
  await page.locator('#toggle-map').evaluate(el => el.click());
  await expect.poll(() => page.locator('#map-panel').evaluate(el => getComputedStyle(el).right)).toBe('0px');
  await expect(page.locator('#toggle-map .x')).toBeVisible();
  await page.locator('#toggle-map').click();
  await expect.poll(topCard).toBe(before);
});

// the phone drawer is covered by the test above
for (const [width, height] of [[1440, 900]]) {
  test(`at ${width}px, opening and closing a drawer again and again keeps the same card at the top`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/map-fixture.json', route => route.fulfill({ json: fixtures }));
    await page.route('**/unverified-locations.json', route => route.fulfill({ json: [] }));
    await stubFirebase(page);
    await page.goto('/history/index.html?file=map-fixture.json');
    await expect(page.locator('.event').first()).toBeVisible();
    await page.locator('#timeline-wrapper').evaluate(el => { el.scrollTop = 3000; });
    // the card at the top, ignoring a card above it that shows less than a pixel
    const topCard = () => page.evaluate(() => {
      const top = document.getElementById('timeline-wrapper').getBoundingClientRect().top;
      return [...document.querySelectorAll('#timeline-content > .event')]
        .find(card => card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().bottom > top + 1)?.dataset.eventId ?? null;
    });
    await expect.poll(topCard).not.toBeNull();
    const before = await topCard();
    for (let i = 0; i < 3; i++) {
      await page.locator('#toggle-info').evaluate(el => el.click());
      await expect(page.locator('#timeline-wrapper')).toHaveClass(/panel-open/);
      await page.waitForTimeout(400);
      await page.locator('#toggle-info').evaluate(el => el.click());
      await expect(page.locator('#timeline-wrapper')).not.toHaveClass(/panel-open/);
      // the timeline is laid out again 300ms after the drawer closes
      await page.waitForTimeout(400);
      await expect.poll(topCard).toBe(before);
    }
  });
}

const precisionEvent = (id, precision, status, i) => ({
  event_id: `prec_${id}`, name: `Precision ${id}`, enhanced_time: String(1800 + i),
  enhanced_description: 'One location of this precision.', categories: ['culture'], figures: [], confidence: 'high',
  locations: [{ place_id: `place_${id}`, name: id, geography: { status, precision, coordinates: [10, 20] } }]
});
const precisionFixtures = [
  ...['site', 'settlement', 'approximate', 'country'].map((precision, i) => precisionEvent(precision, precision, 'resolved', i)),
  precisionEvent('unreviewed', 'approximate', 'reused', 4),
  precisionEvent('unrecorded', undefined, 'corrected', 5),
];
// labels: place labels to release for the fixture, bound to its bytes as the site requires
async function openPrecision(page, { labels = null } = {}) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === new URL(test.info().project.use.baseURL).origin || url.includes('unpkg.com/leaflet') || url.includes('www.gstatic.com/firebasejs/')) return route.continue();
    return route.abort();
  });
  await stubFirebase(page);
  const body = JSON.stringify(precisionFixtures);
  if (labels) {
    const release = { version: 1, kind: 'world_place_label_sidecar', source: { events_sha256: createHash('sha256').update(body).digest('hex') }, labels };
    await page.route('**/releases/released-place-labels-v1.json', route => route.fulfill({ json: release }));
  }
  await page.route('**/precision-fixture.json', route => route.fulfill({ contentType: 'application/json', body }));
  await page.route('**/unverified-locations.json', route => route.fulfill({ json: [] }));
  await page.goto('/history/index.html?file=precision-fixture.json');
  await expect(page.locator('.event').first()).toBeVisible();
}
const show = (page, precision) => page.locator(`.event[data-event-id="prec_${precision}"]`).getByRole('button', { name: 'Show on map', exact: true }).click();

test('a selected event is labelled with its name and date and framed by the ground its point stands for', async ({ page }) => {
  await openPrecision(page);
  const map = await page.locator('#map').boundingBox();
  for (const precision of ['settlement', 'approximate', 'country']) {
    await show(page, precision);
    const label = page.locator('.map-event-label');
    await expect(label).toHaveCount(1);
    await expect(label.locator('strong')).toHaveText(`Precision ${precision}`);
    await expect(label.locator('strong + span')).not.toBeEmpty();
    // the ring fills a good part of the map, whatever ground it covers
    const ring = await page.locator('.map-selected-dot').boundingBox();
    expect(ring.height / map.height).toBeGreaterThan(0.12);
    expect(ring.height / map.height).toBeLessThan(0.45);
  }
  await show(page, 'site');
  await expect(page.locator('.map-event-label')).toHaveCount(1);
  await expect(page.locator('.map-event-label strong')).toHaveText('Precision site');
  expect((await page.locator('.map-selected-dot').boundingBox()).width).toBeLessThan(20);
  // a site is framed at street zoom, a few steps from the limit of 14
  const zoomIn = page.locator('.leaflet-control-zoom-in');
  for (let i = 0; i < 4; i++) {
    // Leaflet updates the button only once a zoom animation ends, so read it after the previous zoom has finished
    await expect(page.locator('#map .leaflet-map-pane.leaflet-zoom-anim')).toHaveCount(0);
    if (await zoomIn.evaluate(el => el.classList.contains('leaflet-disabled'))) break;
    await zoomIn.click();
  }
  await expect(zoomIn).toHaveClass(/leaflet-disabled/);
  expect(await zoomIn.locator('i').evaluate(el => getComputedStyle(el).opacity)).toBe('0.3');
  expect(await page.locator('.leaflet-control-zoom-out i').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

test('a selected event\'s label names its place: the released label, else the written name', async ({ page }) => {
  await openPrecision(page, { labels: { place_settlement: 'Settlement Town, Somewhere' } });
  const place = page.locator('.map-event-label > span > span:nth-of-type(2)');
  // the events share one point, so each check first waits for the previous label to go
  for (const [precision, text] of [['settlement', 'Settlement Town, Somewhere'], ['approximate', 'approximate']]) {
    await show(page, precision);
    await expect(page.locator('.map-event-label')).toHaveCount(1);
    await expect(page.locator('.map-event-label strong')).toHaveText(`Precision ${precision}`);
    await expect(place).toHaveText(text);
  }
  // search finds the event by its released label, which is in neither its name nor its description
  await page.fill('#searchInput', 'Settlement Town');
  await expect(page.locator('#timeline-content .event .event-header')).toHaveText(['Precision settlement']);
});

test('an unreviewed point keeps one ring size on screen and its event opens no closer than zoom 6', async ({ page }) => {
  await openPrecision(page);
  await show(page, 'unreviewed');
  await expect(page.locator('.map-event-label strong')).toHaveText('Precision unreviewed');
  const ring = page.locator('.map-selected-dot');
  await expect(ring).toHaveAttribute('stroke', '#6b7280');
  // the circle's radius in pixels, as Leaflet writes it into the path
  await expect(ring).toHaveAttribute('d', /a16,16 /);
  const zoomIn = page.locator('.leaflet-control-zoom-in');
  let steps = 0;
  while (!(await zoomIn.evaluate(el => el.classList.contains('leaflet-disabled'))) && steps < 14) {
    await zoomIn.click();
    await expect(page.locator('#map')).not.toHaveClass(/leaflet-zoom-anim/);
    steps++;
  }
  // from zoom 6 or wider, + takes at least 8 steps to reach 14
  expect(steps).toBeGreaterThanOrEqual(8);
  await expect(ring).toHaveAttribute('d', /a16,16 /);
});

test('the full-window button fills the window until Esc, the button or a dot returns', async ({ page }) => {
  await setup(page);
  const viewport = page.viewportSize();
  const fill = page.getByRole('button', { name: 'Fill the window', exact: true });
  const exit = page.getByRole('button', { name: 'Exit full window', exact: true });
  await fill.click();
  await expect(page.locator('body')).toHaveClass(/map-full/);
  await expect.poll(() => page.locator('#map').boundingBox()).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  await expect(page.locator('#toggle-map')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/map-full/);
  await expect(page.locator('#toggle-map')).toBeVisible();
  await fill.click();
  await exit.click();
  await expect(page.locator('body')).not.toHaveClass(/map-full/);

  await page.locator('#searchInput').fill('Fixture 19');
  await page.locator('.event[data-event-id="evt_19"]').getByRole('button', { name: 'Show on map', exact: true }).click();
  await fill.click();
  await page.locator('.map-selected-dot').first().click();
  await expect(page.locator('body')).not.toHaveClass(/map-full/);
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', 'evt_19');
  await expect(page.locator('.event.map-selected')).toBeInViewport();
});

test('a reviewed point with no recorded precision is a dot, not a ring', async ({ page }) => {
  await openPrecision(page);
  await show(page, 'unrecorded');
  await expect(page.locator('.map-event-label strong')).toHaveText('Precision unrecorded');
  const dot = page.locator('.map-selected-dot');
  await expect(dot).toHaveAttribute('fill', '#1d4ed8');
  await expect(dot).toHaveAttribute('d', /a6,6 /);
  await page.locator('.leaflet-control-zoom-out').click();
  await expect(page.locator('#map')).not.toHaveClass(/leaflet-zoom-anim/);
  await expect(dot).toHaveAttribute('d', /a6,6 /);
});

test('the area filter shows its events as bubbles, a bubble lists them, and the stepper goes through the list', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  const markers = page.locator('.map-cluster, .map-cluster-dot');
  await expect(markers).toHaveCount(0);

  // 78 events share the secondary spot; Fixture 19 has its own, and the remote spot is out of view
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  const spot = page.locator('.map-cluster-spot');
  await expect(spot).toHaveText('78');
  await expect(page.locator('.map-cluster-dot')).toHaveCount(1);

  // a dot selects its event and gives way to its ring and label at once
  await page.locator('.map-cluster-dot').click();
  // the pointer still rests on that point, so its hover label can show beside the permanent one
  await expect(page.locator('.map-event-label strong').first()).toHaveText('Fixture 19');
  await expect(page.locator('.map-cluster-dot')).toHaveCount(0);

  await spot.click();
  await expect(page.getByRole('group', { name: '78 events here' })).toBeVisible();
  await expect(page.locator('.map-event-list li button').first()).toBeFocused();
  await expect(page.locator('.map-event-list li')).toHaveCount(25);
  await expect(page.locator('.map-event-list-more')).toHaveText('and 53 more');
  await expect(page.locator('.map-event-list-zoom')).toHaveCount(0);
  await page.locator('.map-event-list li button').first().click();
  const stepper = page.locator('.map-stepper span');
  await expect(stepper).toHaveText('1 of 78');
  await expect(page.locator('.map-event-label')).toHaveCount(1);
  await expect(page.locator('.map-event-label strong')).toHaveText('Fixture 0');
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', 'evt_0');
  await expect(page.getByRole('button', { name: 'Previous event' })).toBeDisabled();
  // the selected event leaves its bubbles, so its own dot and label show; the map now frames both its
  // places, so the secondary spot may be grouped with others
  await expect(page.locator('.map-cluster', { hasText: /^77$/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(stepper).toHaveText('2 of 78');
  await expect(page.locator('.map-event-label')).toHaveCount(1);
  await expect(page.locator('.map-event-label strong')).toHaveText('Fixture 1');
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(page.locator('.map-event-list button[aria-current="true"] span')).toHaveText('Fixture 1');
  await expect(page.locator('.map-event-list button[aria-current="true"]')).toBeFocused();

  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(markers).toHaveCount(0);
  await expect(page.locator('.map-stepper')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('when the bubble library fails to load, the area filter still works and filtering again does not retry it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  // registered last, so it wins over setup's route
  await page.route('**/unpkg.com/supercluster@8.0.1/**', route => route.abort());
  const filter = page.getByRole('button', { name: 'Filter by visible area', exact: true });
  await filter.click();
  await expect(page.getByText(/events? in selected area/)).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(300);
    await filter.click();
  }
  await page.waitForTimeout(300);
  await expect(page.locator('script[src*="supercluster"]')).toHaveCount(1);
  await expect(page.locator('.map-cluster, .map-cluster-dot')).toHaveCount(0);
  await expect(page.getByText('The events can’t be shown on the map right now; the timeline lists them.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(page.locator('.map-events-note')).toBeHidden();
  expect(errors).toEqual([]);
});

test('?lab opens the site with the lab\'s switches, which drive the site\'s own bubbles', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page, '&lab=events:period');
  await expect(page.getByRole('button', { name: /Lab · 1 on/ })).toBeVisible();
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  // "The time on screen": the years of the cards in view, and how many of their events are on the map
  await expect(page.locator('.map-events-note')).toHaveText(/^\d{4} – \d{4} · \d+ events? on the map$/);
  await page.getByRole('button', { name: /Lab · 1 on/ }).click();
  await page.getByRole('combobox', { name: /^Events on the map/ }).selectOption('');
  await expect(page.locator('.map-events-note')).toBeHidden();
  await expect(page.locator('.map-cluster-spot')).toHaveText('78');
  await expect(page).toHaveURL(/lab=off/);
  expect(errors).toEqual([]);
});


test('the selected event\'s label: on a phone, Show in timeline closes the map onto the card, and ✕ clears the selection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // the lab with every switch off: the site as it is, with window.lab to reach the panels
  await setup(page, '&lab=off');
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await page.locator('.map-cluster-spot').click();
  await page.locator('.map-event-list li button').nth(15).click();
  const label = page.locator('.map-event-label');
  await expect(label.locator('strong')).toHaveText('Fixture 15');
  // ✕ clears the ring, label and stepper, and the event goes back into its bubble
  await label.getByRole('button', { name: 'Clear the selected event' }).click();
  await expect(page.locator('.map-event-label, .map-stepper, .map-selected-dot')).toHaveCount(0);
  await expect(page.locator('.map-cluster-spot')).toHaveText('78');
  await expect(page.locator('.event.map-selected')).toHaveCount(0);

  // on a phone the open map covers the timeline: Show in timeline closes it, and an article drawer open
  // behind it, and lands on the card
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.lab.panelManager.openInfoPanel(); window.lab.panelManager.bringMapToFront(); });
  await page.locator('.map-cluster-spot').click();
  await page.locator('.map-event-list li button').nth(15).click();
  await expect(label.locator('strong')).toHaveText('Fixture 15');
  await label.getByRole('button', { name: 'Show in timeline' }).click();
  await expect(page.locator('#map-panel')).not.toHaveClass(/open/);
  await expect(page.locator('#info-panel')).not.toHaveClass(/open/);
  const card = page.locator('.event.map-selected');
  await expect(card).toHaveAttribute('data-event-id', 'evt_15');
  await expect(card).toBeInViewport();
  expect(errors).toEqual([]);
});

test('lab borders: the states of the year being read, credited, named on click, and gone when switched off', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page, '&lab=borders');
  const borders = page.locator('.leaflet-polities-pane path.map-polity');
  // the fixture's events aren't in the sample's years, so the year is set here: 117, Hadrian's accession
  await expect.poll(() => page.evaluate(() => Boolean(window.lab.browser.polities))).toBe(true);
  await page.evaluate(() => {
    const layer = window.lab.browser.polities;
    layer.currentYear = () => 117;
    layer.update();
    window.lab.browser.map.setView([40, 20], 3, { animate: false });
  });
  await expect(borders).toHaveCount(36);
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Cliopatria');
  // clicking a state opens its bubble with its name and the years its borders cover
  await expect(page.locator('.map-event-popup .map-event-list-title strong')).toHaveCount(0);
  await page.locator('.leaflet-polities-pane path.map-polity').first().dispatchEvent('click');
  await expect(page.locator('.map-event-popup .map-event-list-title strong')).not.toHaveText('');
  await expect(page.locator('.map-event-popup .map-event-list-more')).toHaveText(/^These borders: /);
  // a year outside the sample draws none; switching off removes them and the credit
  await page.evaluate(() => { const layer = window.lab.browser.polities; layer.currentYear = () => 1700; layer.update(); });
  await expect(borders).toHaveCount(0);
  await page.evaluate(() => window.lab.browser.showPolities(null));
  await expect(page.locator('.leaflet-control-attribution')).not.toContainText('Cliopatria');
  expect(errors).toEqual([]);
});
