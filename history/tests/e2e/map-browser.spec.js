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
  await expect(page.getByRole('button', { name: 'Search this area', exact: true })).toBeVisible();
}
test('area intersects secondary locations and years; selecting a result reaches virtual card and all points', async ({ page }) => {
  const errors = []; let geocodes = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('nominatim.openstreetmap.org')) geocodes++; });
  await setup(page);
  await page.getByRole('button', { name: 'Search this area', exact: true }).click();
  await expect(page.locator('.map-status')).toContainText('Selected area: 79 events');
  await page.locator('#searchInput').fill('Fixture');
  await page.getByRole('spinbutton', { name: 'From year' }).fill('1930');
  await page.getByRole('spinbutton', { name: 'Through year' }).fill('1950');
  await page.getByRole('button', { name: 'Apply years', exact: true }).click();
  await expect(page.locator('.map-status')).toContainText('21 events');
  await page.locator('.map-results button[data-event-id="evt_49"]').click();
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', 'evt_49');
  await expect(page.locator('.event.map-selected')).toBeInViewport();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
  await expect(page.locator('.map-status')).toContainText('Selected area: 21 events');
  await page.getByRole('button', { name: 'Clear area / place', exact: true }).click();
  await expect(page.locator('.map-status')).toContainText('All areas: 21 events');
  await expect(page.locator('#searchInput')).toHaveValue('Fixture');
  await expect(page.getByRole('spinbutton', { name: 'From year' })).toHaveValue('1930');
  expect(geocodes).toBe(0); expect(errors).toEqual([]);
});
test('unmapped events remain selectable; precision filters and empty intersections are explicit', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Unmapped events', exact: true }).click();
  await expect(page.locator('.map-status')).toContainText('Unmapped only: 1 events');
  await page.locator('.map-results button').click();
  await expect(page.locator('.map-selection')).toContainText('No saved coordinates');
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', 'evt_79');
  await page.getByRole('button', { name: 'Clear area / place', exact: true }).click();
  await page.getByRole('checkbox', { name: /Include approximate/ }).uncheck();
  await expect(page.locator('.map-status')).toContainText('All areas: 0 events');
  await page.getByRole('checkbox', { name: /Include approximate/ }).check();
  await expect(page.locator('.map-status')).toContainText('All areas: 80 events');
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

test('a place marker filters events and literal punctuation survives combined filters', async ({ page }) => {
  await setup(page);
  await page.locator('.leaflet-overlay-pane path.leaflet-interactive').first().click();
  await page.getByRole('button', { name: 'Filter to this place', exact: true }).click();
  await expect(page.locator('.map-status')).toContainText('Selected place: 79 events');
  await page.locator('.filters button', { hasText: 'Culture' }).click();
  await expect(page.locator('.map-status')).toContainText('40 events');
  await page.locator('#searchInput').fill('[78]');
  await expect(page.locator('.map-status')).toContainText('1 events');
  await expect(page.locator('.event mark').first()).toHaveText('[78]');
  await page.getByRole('button', { name: 'Clear area / place', exact: true }).click();
  await expect(page.locator('.map-status')).toContainText('All areas: 1 events');
  await expect(page.locator('#searchInput')).toHaveValue('[78]');
});
