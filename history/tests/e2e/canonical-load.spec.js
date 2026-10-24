import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const snapshot = process.env.CANONICAL_SNAPSHOT;
const firebaseStub = `
export const initializeApp = () => ({});
export const getAnalytics = () => ({});
export const getFirestore = () => ({});
export const connectFirestoreEmulator = () => {};
export const connectAuthEmulator = () => {};
export const getAuth = () => ({ currentUser: null });
export const onAuthStateChanged = (auth, callback) => { queueMicrotask(() => callback(null)); return () => {}; };
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
export const sendPasswordResetEmail = async () => {};
`;

async function stubFirebase(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ contentType: 'text/javascript', body: firebaseStub }));
}

test('initial load applies a manual correction and uses its coordinates', async ({ page }) => {
  await stubFirebase(page);
  // Test the real EventManager.loadEvents path in a browser without external SDKs.
  await page.route('**/correction-fixture.json', route => route.fulfill({ json: [{
    event_id: 'evt_fixture', name: 'Known fixture', enhanced_time: '1900',
    enhanced_description: 'Known correction example.', categories: ['culture'], figures: [], confidence: 'high',
    locations: [{ name: 'Old town', place_id: 'plc_fixture' }]
  }, {
    event_id: 'evt_cached', name: 'Cached fixture', enhanced_time: '1901',
    enhanced_description: 'Approximate location example.', categories: ['culture'], figures: [], confidence: 'high',
    locations: [{ name: 'Cached town', place_id: 'plc_cached', geography: {
      status: 'reused', coordinates: [3, 4], precision: 'approximate'
    } }]
  }] }));
  await page.route('**/unverified-locations.json', route => route.fulfill({ json: [{
    standardized_location: 'Old town', corrected_location: [1, 2]
  }] }));
  let geocodingRequests = 0;
  await page.route('https://nominatim.openstreetmap.org/**', route => {
    geocodingRequests++;
    return route.abort();
  });
  await page.goto('/history/index.html?file=correction-fixture.json');
  const correctedLink = page.locator('.event-location.clickable', { hasText: 'Old town' });
  await expect(correctedLink).toBeVisible();
  await correctedLink.click();
  await expect(page.locator('.map-selected-dot')).toHaveCount(1);
  const cachedLink = page.locator('.event-location.clickable', { hasText: 'Cached town' });
  await expect(cachedLink).toHaveAttribute('title', /Approximate/);
  await cachedLink.click();
  await expect(page.locator('.map-selected-dot')).toHaveCount(1);
  expect(geocodingRequests).toBe(0);
  const result = await page.evaluate(async () => {
    const { EventManager } = await import('./modules/event-manager.js');
    const { LocationVerifier, getMapLocation, getCoordinates } = await import('./modules/map-utils.js');
    const verifier = new LocationVerifier();
    verifier.isInitialized = true;
    verifier.locationMappings.set('Old town', { corrected: [1, 2] });
    const manager = new EventManager(verifier);
    await manager.loadEvents('correction-fixture.json');
    const event = manager.events[0];
    return { id: event.event_id, placeId: event.locations[0].place_id,
      coordinates: await getCoordinates(getMapLocation(event.locations), new Map()) };
  });
  expect(result).toEqual({ id: 'evt_fixture', placeId: 'plc_fixture', coordinates: [1, 2] });
});

test('full canonical snapshot loads in the actual timeline', async ({ page }) => {
  test.skip(!snapshot, 'Set CANONICAL_SNAPSHOT to the generated events.json for full-data acceptance');
  test.setTimeout(90000);
  const events = JSON.parse(fs.readFileSync(path.resolve(snapshot), 'utf8'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: firebaseStub });
    if (url.startsWith('http://localhost:8080/') || url.includes('unpkg.com/leaflet')) return route.continue();
    return route.abort();
  });
  const started = Date.now();
  await page.goto('/history/index.html?file=canonical-t2.json');
  await expect(page.locator('#timeline-content .event').first()).toBeVisible({ timeout: 60000 });
  const firstRenderMs = Date.now() - started;
  expect(errors).toEqual([]);
  const loaded = await page.evaluate(async () => {
    const { EventManager } = await import('./modules/event-manager.js');
    const { LocationVerifier, getMapLocation } = await import('./modules/map-utils.js');
    const verifier = new LocationVerifier();
    await verifier.loadUnverifiedLocations('unverified-locations.json');
    const manager = new EventManager(verifier);
    await manager.loadEvents('canonical-t2.json');
    const index = manager.placeIndex;
    const bounds = { south: 35, north: 60, west: -10, east: 30 };
    const samples = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      manager.setGeographicFilter({ bounds });
      manager.setTimeRange(1800, 1900);
      manager.getFilteredEvents('culture', '');
      samples.push(performance.now() - start);
    }
    samples.sort((a,b) => a-b);
    const corrected = manager.events.flatMap(e => e.locations).filter(l => l.geography.status === 'corrected');
    return { browser: navigator.userAgent, points: index.points.size, allLocationMapped: index.events.size - index.unmapped.size, filterP50Ms: samples[25], filterP95Ms: samples[47], count: manager.events.length, ids: new Set(manager.events.map(e => e.event_id)).size,
      corrected: corrected.length, firstCorrection: corrected[0].corrected,
      mapped: manager.events.filter(e => Array.isArray(getMapLocation(e.locations))).length };
  });
  expect(loaded.count).toBe(events.length);
  expect(loaded.ids).toBe(events.length);
  expect(loaded.corrected).toBeGreaterThan(0);
  expect(loaded.firstCorrection).toBeTruthy();
  expect(loaded.mapped).toBeGreaterThan(0);
  await page.locator('#toggle-map').click();
  await page.getByRole('button', { name: 'Filter by visible area', exact: true }).click();
  const target = page.locator('.event').first();
  const targetId = await target.getAttribute('data-event-id');
  await target.getByRole('button', { name: 'Show on map', exact: true }).click();
  await expect(page.locator('.event.map-selected')).toHaveAttribute('data-event-id', targetId);
  await expect(page.locator('.event.map-selected')).toBeInViewport();
  await expect(page.locator('.map-status')).toContainText('events in selected area');
  await expect(page.locator('.map-selected-dot').first()).toBeVisible();
  await page.waitForTimeout(700); // Finish Leaflet's fitBounds animation for visual evidence.
  await page.screenshot({ path: '/tmp/t6-minimal-map.png' });
  console.log('Canonical browser acceptance:', JSON.stringify({ ...loaded, firstRenderMs, targetId }));
});
