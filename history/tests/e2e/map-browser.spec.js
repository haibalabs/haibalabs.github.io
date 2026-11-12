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
test('manager combines geographic, category, literal text and start-year filters; clearing the area restores unmapped events', async ({ page }) => {
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
  // clearing the area restores unmapped events and their honest map state
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await page.locator('#searchInput').fill('Fixture 79');
  await expect(page.locator('.map-status')).toHaveText('0 events in selected area');
  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(page.locator('.event[data-event-id="evt_79"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show on map', exact: true })).toHaveCount(0);
  await expect(page.locator('.map-selected-dot')).toHaveCount(0);
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

test('closing a drawer, on a phone or a wide screen, shows the cards that were on screen before it opened', async ({ page }) => {
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
  // on a wide screen, opening and closing a drawer keeps the same card at the top
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const wideTop = () => page.evaluate(() => {
    const top = document.getElementById('timeline-wrapper').getBoundingClientRect().top;
    return [...document.querySelectorAll('#timeline-content > .event')]
      .find(card => card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().bottom > top + 1)?.dataset.eventId ?? null;
  });
  const wideBefore = await wideTop();
  await page.locator('#toggle-info').evaluate(el => el.click());
  await expect(page.locator('#timeline-wrapper')).toHaveClass(/panel-open/);
  await page.waitForTimeout(400);
  await page.locator('#toggle-info').evaluate(el => el.click());
  await expect(page.locator('#timeline-wrapper')).not.toHaveClass(/panel-open/);
  // the timeline is laid out again 300ms after the drawer closes
  await page.waitForTimeout(400);
  await expect.poll(wideTop).toBe(wideBefore);
});

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

test('an unreviewed point keeps one ring size and opens no closer than zoom 6; a point with no recorded precision is a dot', async ({ page }) => {
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
  // a reviewed point with no recorded precision is a dot, not a ring
  await show(page, 'unrecorded');
  // both events share one point, so wait for the previous label to go
  await expect(page.locator('.map-event-label')).toHaveCount(1);
  await expect(page.locator('.map-event-label strong')).toHaveText('Precision unrecorded');
  const dot = page.locator('.map-selected-dot');
  await expect(dot).toHaveAttribute('fill', '#1d4ed8');
  await expect(dot).toHaveAttribute('d', /a6,6 /);
  await page.locator('.leaflet-control-zoom-out').click();
  await expect(page.locator('#map')).not.toHaveClass(/leaflet-zoom-anim/);
  await expect(dot).toHaveAttribute('d', /a6,6 /);
});

test('the area filter shows its events as bubbles, a bubble lists them, the stepper goes through the list, and the label clears or shows the selection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // the lab with every switch off: the site as it is, with window.lab to reach the panels
  await setup(page, '&lab=off');
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

  // the selected event's label: ✕ clears the selection, and the event goes back into its bubble
  const label = page.locator('.map-event-label');
  await expect(label.locator('strong')).toHaveText('Fixture 1');
  await label.getByRole('button', { name: 'Clear the selected event' }).click();
  await expect(page.locator('.map-event-label, .map-stepper, .map-selected-dot')).toHaveCount(0);
  await expect(page.locator('.event.map-selected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await expect(page.locator('.map-cluster-spot')).toHaveText('78');

  // on a phone the open map covers the timeline: Show in timeline closes it, and an article drawer open
  // behind it, and lands on the card
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.lab.panelManager.openInfoPanel(); window.lab.panelManager.bringMapToFront(); });
  await page.locator('.map-cluster-spot').click();
  await page.locator('.map-event-list li button').nth(15).click();
  // off the map, so no hover label shows beside the selected one
  await page.mouse.move(1, 1);
  await expect(label.locator('strong')).toHaveText('Fixture 15');
  await label.getByRole('button', { name: 'Show in timeline' }).click();
  await expect(page.locator('#map-panel')).not.toHaveClass(/open/);
  await expect(page.locator('#info-panel')).not.toHaveClass(/open/);
  const card = page.locator('.event.map-selected');
  await expect(card).toHaveAttribute('data-event-id', 'evt_15');
  await expect(card).toBeInViewport();
  expect(errors).toEqual([]);
});
