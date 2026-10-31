import { test, expect } from '@playwright/test';
import { stubFirebase } from './firebase-stub.js';


const location = (id, coordinates) => ({ place_id: id, name: id, geography: { status: 'reused', precision: 'approximate', coordinates } });
const fixtures = Array.from({ length: 80 }, (_, i) => ({
  event_id: `evt_${i}`, name: i === 78 ? 'Fixture [78]' : `Fixture ${i}`, enhanced_time: String(1900 + i),
  enhanced_description: 'Shared historical fixture.', categories: [i % 2 ? 'science' : 'culture'], figures: [], confidence: 'high',
  locations: i === 79 ? [] : [location('remote', [0, 120]), location(i === 19 ? 'secondary-19' : 'secondary', [20, i === 19 ? 15 : 0])]
}));
async function setup(page) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:8080/') || url.includes('unpkg.com/leaflet') || url.includes('www.gstatic.com/firebasejs/')) return route.continue();
    return route.abort();
  });
  await stubFirebase(page);
  await page.route('**/map-fixture.json', route => route.fulfill({ json: fixtures }));
  await page.route('**/unverified-locations.json', route => route.fulfill({ json: [] }));
  await page.goto('/history/index.html?file=map-fixture.json');
  await expect(page.locator('.event').first()).toBeVisible();
  await page.locator('#toggle-map').click();
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

test('area filtering preserves category and literal text search', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await page.locator('.filters button', { hasText: 'Culture' }).click();
  await expect(page.locator('.map-status')).toHaveText('40 events in selected area');
  await page.locator('#searchInput').fill('[78]');
  await expect(page.locator('.map-status')).toHaveText('1 event in selected area');
  await expect(page.locator('.event mark').first()).toHaveText('[78]');
  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(page.locator('#searchInput')).toHaveValue('[78]');
  await expect(page.locator('.event')).toHaveCount(1);
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

for (const [width, height] of [[390, 844], [1440, 900]]) {
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

const precisionFixtures = ['site', 'settlement', 'approximate', 'country'].map((precision, i) => ({
  event_id: `prec_${precision}`, name: `Precision ${precision}`, enhanced_time: String(1800 + i),
  enhanced_description: 'One location of this precision.', categories: ['culture'], figures: [], confidence: 'high',
  locations: [{ place_id: `place_${precision}`, name: precision, geography: { status: 'reused', precision, coordinates: [10, 20] } }]
}));
async function openPrecision(page) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:8080/') || url.includes('unpkg.com/leaflet') || url.includes('www.gstatic.com/firebasejs/')) return route.continue();
    return route.abort();
  });
  await stubFirebase(page);
  await page.route('**/precision-fixture.json', route => route.fulfill({ json: precisionFixtures }));
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
    // the ring spans roughly a third of the map, whatever ground it covers
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
  for (let i = 0; i < 4 && !(await zoomIn.evaluate(el => el.classList.contains('leaflet-disabled'))); i++) await zoomIn.click();
  await expect(zoomIn).toHaveClass(/leaflet-disabled/);
  expect(await zoomIn.locator('i').evaluate(el => getComputedStyle(el).opacity)).toBe('0.3');
  expect(await page.locator('.leaflet-control-zoom-out i').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});
