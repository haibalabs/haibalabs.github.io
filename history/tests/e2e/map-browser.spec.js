import { test, expect } from '@playwright/test';
const firebaseStub = `
export const initializeApp = () => ({});
export const getAnalytics = () => ({});
export const getFirestore = () => ({});
export const getAuth = () => ({ currentUser: null });
export const collection = () => ({});
export const doc = () => ({});
export const setDoc = async () => {};
export const getDoc = async () => ({ exists: () => false });
export const query = () => ({});
export const where = () => ({});
export const getDocs = async () => ({ forEach: () => {} });
export const serverTimestamp = () => 0;
export const signInWithEmailAndPassword = async () => ({});
export const signOut = async () => {};
`;

async function stubFirebase(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ contentType: 'text/javascript', body: firebaseStub }));
}


const location = (id, coordinates) => ({ place_id: id, name: id, geography: { status: 'reused', precision: 'approximate', coordinates } });
const fixtures = Array.from({ length: 80 }, (_, i) => ({
  event_id: `evt_${i}`, name: i === 78 ? 'Fixture [78]' : `Fixture ${i}`, enhanced_time: String(1900 + i),
  enhanced_description: 'Shared historical fixture.', categories: [i % 2 ? 'science' : 'culture'], figures: [], confidence: 'high',
  locations: i === 79 ? [] : [location('remote', [0, 120]), location('secondary', [20, 0])]
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
  await expect(page.getByRole('button', { name: 'Filter by visible area', exact: true })).toBeVisible();
}
test('visible area includes secondary places and marker selection reaches a virtual card', async ({ page }) => {
  const errors = []; let geocodes = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('nominatim.openstreetmap.org')) geocodes++; });
  await setup(page);
  await expect(page.locator('.map-results, .map-years')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await expect(page.locator('.map-status')).toHaveText('79 events in selected area');
  await page.locator('.leaflet-overlay-pane path.leaflet-interactive').first().click();
  await page.locator('.leaflet-popup button[data-event-id="evt_19"]').click();
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', 'evt_19');
  await expect(page.locator('.event.map-selected')).toBeInViewport();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
  await expect(page.locator('.map-selection')).toContainText('2 saved locations');
  await expect(page.locator('.map-status')).toHaveText('79 events in selected area');
  await page.locator('#searchInput').fill('Fixture 1');
  await expect(page.locator('.map-status')).toHaveText('11 events in selected area');
  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear area filter', exact: true })).toBeHidden();
  await expect(page.locator('#searchInput')).toHaveValue('Fixture 1');
  expect(geocodes).toBe(0); expect(errors).toEqual([]);
});
test('clearing the area restores unmapped events and their honest map state', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  await page.locator('#searchInput').fill('Fixture 79');
  await expect(page.locator('.map-status')).toHaveText('0 events in selected area');
  await page.getByRole('button', { name: 'Clear area filter', exact: true }).click();
  await expect(page.locator('.event[data-event-id="evt_79"]')).toBeVisible();
  await page.getByRole('button', { name: 'Show on map', exact: true }).click();
  await expect(page.locator('.map-selection')).toContainText('No saved map location');
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
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
