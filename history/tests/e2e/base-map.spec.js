import { test, expect } from '@playwright/test';
import { stubFirebase } from './firebase-stub.js';

// MapLibre and its Leaflet binding are replaced by stubs that keep every style the page hands them and
// let a test fire MapLibre's events, so these tests need neither the network nor WebGL.
const MAPLIBRE_STUB = 'window.maplibregl = { setRTLTextPlugin: () => Promise.resolve() };';
const BINDING_STUB = `L.maplibreGL = options => {
  if (window.bindingThrows) throw new Error('No WebGL context');
  const handlers = {};
  window.baseMap = { styles: [options.style], pane: options.pane, removed: false,
    fire: (type, event) => (handlers[type] || []).forEach(handler => handler(event)) };
  const layer = L.layerGroup();
  layer.on('remove', () => { window.baseMap.removed = true; });
  layer.getMaplibreMap = () => ({
    setStyle: style => window.baseMap.styles.push(style),
    on: (type, handler) => (handlers[type] ??= []).push(handler),
  });
  return layer;
};`;
const LAND = { light: '#e4e6b6', dark: '#22271f' };

async function open(page, { maplibre = true, webgl = true, bindingThrows = false } = {}) {
  const imageTiles = [];
  // headless browsers differ on WebGL, so each test decides whether there is any
  await page.addInitScript(({ webgl, bindingThrows }) => {
    window.bindingThrows = bindingThrows;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (type === 'webgl2' || type === 'webgl') return webgl ? {} : null;
      return getContext.call(this, type, ...rest);
    };
  }, { webgl, bindingThrows });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('tile.openstreetmap.')) imageTiles.push(url);
    if (maplibre && url.includes('unpkg.com/maplibre-gl@')) {
      return url.endsWith('.css') ? route.fulfill({ contentType: 'text/css', body: '' }) : route.fulfill({ contentType: 'text/javascript', body: MAPLIBRE_STUB });
    }
    if (maplibre && url.includes('unpkg.com/@maplibre/maplibre-gl-leaflet@')) return route.fulfill({ contentType: 'text/javascript', body: BINDING_STUB });
    if (url.startsWith('http://localhost:8080/') || url.includes('unpkg.com/leaflet') || url.includes('www.gstatic.com/firebasejs/')) return route.continue();
    return route.abort();
  });
  await stubFirebase(page);
  await page.goto('/history/index.html?file=events_sample_small.json');
  await expect(page.locator('.event').first()).toBeVisible();
  return imageTiles;
}
const landColour = style => style.layers.find(layer => layer.id === 'land').paint['background-color'];

test('the map is drawn from OpenStreetMap vector tiles in its own pane and follows the theme', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'light' });
  const imageTiles = await open(page);
  await expect.poll(() => page.evaluate(() => window.baseMap?.styles.length)).toBe(1);
  const first = await page.evaluate(() => window.baseMap);
  expect(first.pane).toBe('basePane');
  expect(first.styles[0].sources.shortbread.tiles[0]).toContain('vector.openstreetmap.org/shortbread_v1/');
  expect(landColour(first.styles[0])).toBe(LAND.light);

  await page.click('#settings-btn');
  await page.getByText('Dark', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.baseMap.styles.length)).toBe(2);
  expect(landColour(await page.evaluate(() => window.baseMap.styles[1]))).toBe(LAND.dark);

  // System follows the operating system, which is light here
  await page.getByText('System', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.baseMap.styles.length)).toBe(3);
  expect(landColour(await page.evaluate(() => window.baseMap.styles[2]))).toBe(LAND.light);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.evaluate(() => window.baseMap.styles.length)).toBe(4);
  expect(landColour(await page.evaluate(() => window.baseMap.styles[3]))).toBe(LAND.dark);

  expect(imageTiles).toEqual([]);
  expect(errors).toEqual([]);
});

const vectorTileError = page => page.evaluate(() => window.baseMap.fire('error', { sourceId: 'shortbread', error: new Error('vector.openstreetmap.org is down') }));

test('when the vector tile server fails before its first tile, the map switches to the images', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const imageTiles = await open(page);
  await expect.poll(() => page.evaluate(() => window.baseMap?.styles.length)).toBe(1);
  // another source failing leaves the vector map in place
  await page.evaluate(() => window.baseMap.fire('error', { sourceId: 'elevation', error: new Error('no relief') }));
  expect(await page.evaluate(() => window.baseMap.removed)).toBe(false);
  await vectorTileError(page);
  expect(await page.evaluate(() => window.baseMap.removed)).toBe(true);
  await page.locator('#toggle-map').click();
  await expect.poll(() => imageTiles.length).toBeGreaterThan(0);
  // a theme change no longer restyles the removed vector map
  await page.click('#settings-btn');
  await page.getByText('Dark', { exact: true }).click();
  expect(await page.evaluate(() => window.baseMap.styles.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('a vector tile failure after the first tile has drawn keeps the vector map', async ({ page }) => {
  const imageTiles = await open(page);
  await expect.poll(() => page.evaluate(() => window.baseMap?.styles.length)).toBe(1);
  await page.evaluate(() => window.baseMap.fire('sourcedata', { sourceId: 'shortbread', tile: {} }));
  await vectorTileError(page);
  expect(await page.evaluate(() => window.baseMap.removed)).toBe(false);
  await page.locator('#toggle-map').click();
  await page.waitForTimeout(500);
  expect(imageTiles).toEqual([]);
});

for (const [what, options] of [['MapLibre does not load', { maplibre: false }], ['the browser has no WebGL', { webgl: false }], ['the Leaflet binding throws', { bindingThrows: true }]]) {
  test(`when ${what}, the map shows OpenStreetMap's images`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const imageTiles = await open(page, options);
    await page.locator('#toggle-map').click();
    await expect.poll(() => imageTiles.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.baseMap)).toBeUndefined();
    expect(errors).toEqual([]);
  });
}
