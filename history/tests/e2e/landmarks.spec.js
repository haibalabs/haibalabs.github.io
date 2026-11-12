import { test, expect } from './cdn-cache.js';
import { readFileSync, readdirSync } from 'node:fs';
import { stubFirebase } from './firebase-stub.js';

// The release's landmarks (published-data.js fetchLandmarks, landmark-layer.js): they load after the
// timeline, only icons the manifest lists are drawn, and the map's landmarks switch hides them and is
// remembered.

const ICONS = new URL('../../data/landmark-icons/', import.meta.url);
// three real icons stand in for one icon drawn at 88, 44 and 132 px
const [ICON, SMALL, LARGE] = readdirSync(ICONS).filter(name => name.endsWith('.webp')).slice(0, 3).map(name => name.replace('.webp', ''));
const UNLISTED = 'f'.repeat(64);
const landmark = (qid, label, point, icon, extra = {}) => ({ wikidata_qid: qid, label, place_ids: [], tier: 1, icon, point,
    links: [{ source: 'wikipedia', url: `https://en.wikipedia.org/wiki/${label.replace(/ /g, '_')}` }], ...extra });
const TABLE = JSON.stringify({ format: 'historiline-landmarks/v1', landmarks: [
    landmark('Q1', 'Listed Landmark', [41.89, 12.49], ICON, { icon_sizes: { 24: UNLISTED, 44: SMALL, 88: ICON, 132: LARGE } }),
    landmark('Q2', 'Unlisted Icon', [48.86, 2.29], UNLISTED),
] });
const event = { event_id: 'evt_a', event_version: 'v_a', name: 'An event', enhanced_time: '1700', enhanced_description: 'An event.',
    categories: ['politics'], figures: [], confidence: 'high', visible: true, wikipedia_url: '', locations: [] };
const MANIFEST = JSON.stringify({ format: 'historiline-manifest/v1', release_id: 'release-l', created_at: '2026-11-10T12:00:00Z',
    shards: [{ id: 'd000', count: 1, sha256: 'e0' }], places: { buckets: 64, files: [{ bucket: 0, count: 0, sha256: 'p0' }] },
    corrections: { sha256: 'c0' }, landmarks: { sha256: 'l0', bytes: TABLE.length, count: 2 }, landmark_icons: [ICON, SMALL, LARGE].map(sha256 => ({ sha256, bytes: 1 })) });
const FILES = {
    'manifest.json': MANIFEST,
    'events/e0.json': JSON.stringify({ format: 'historiline-events/v1', shard: 'd000', family: 'dated', events: [event] }),
    'places/p0.json': JSON.stringify({ format: 'historiline-places/v1', bucket: 0, places: [] }),
    'corrections/c0.json': '[]',
    'landmarks/l0.json': TABLE,
};

async function open(page) {
    await stubFirebase(page);
    await page.route(/unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod/, r => r.abort());
    await page.route('**/history/data/**', route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/history\/data\//, '');
        if (path.startsWith('landmark-icons/')) return route.fulfill({ contentType: 'image/webp', body: readFileSync(new URL(path.replace('landmark-icons/', ''), ICONS)) });
        const body = FILES[path];
        return body === undefined ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'application/json', body });
    });
    await page.goto('/history/index.html');
    await expect(page.locator('#timeline-content .event').first()).toBeVisible();
    await page.locator('#toggle-map').click();
    await expect(page.getByRole('button', { name: 'Landmarks' })).toBeVisible();
}

test('the release\'s landmarks show, drawn at the size that fits, open their bubble, and hide with a switch that is remembered', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page);
    const toggle = page.getByRole('button', { name: 'Landmarks' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // at the starting world view both world-tier landmarks show; the one whose icon the manifest doesn't list
    // is drawn as its placeholder, and requests no icon
    await expect.poll(() => page.locator('.map-landmark').evaluateAll(nodes => nodes.map(node => node.title).sort()))
        .toEqual(['Listed Landmark', 'Unlisted Icon']);
    await expect(page.locator('.map-landmark[title="Unlisted Icon"] .map-landmark-placeholder')).toHaveText('U');
    await expect(page.locator('.map-landmark[title="Unlisted Icon"] img')).toHaveCount(0);
    // a world-tier landmark keeps a readable size at world zoom
    expect(Number(await page.locator('.map-landmark[title="Listed Landmark"]').getAttribute('data-size'))).toBeGreaterThanOrEqual(24);
    // and, shrunk below full size, still sits on whole pixels, where it is drawn sharp
    const offset = await page.locator('.map-landmark[title="Listed Landmark"]').evaluate(node => {
        const icon = node.getBoundingClientRect();
        const map = node.closest('.leaflet-container').getBoundingClientRect();
        return [(icon.left - map.left) % 1, (icon.top - map.top) % 1];
    });
    expect(offset).toEqual([0, 0]);
    // an icon drawn at several sizes is fetched at the one that fits it on screen, from the listed sizes only
    const sized = page.locator('.map-landmark[title="Listed Landmark"]');
    const image = sized.locator('img');
    // the unlisted 24 px drawing is dropped
    await expect(image).toHaveAttribute('srcset', new RegExp(`^[^ ]*${SMALL}\\.webp 44w, [^ ]*${ICON}\\.webp 88w, [^ ]*${LARGE}\\.webp 132w$`));
    // shrunk to its world-view size on a 1x screen, it takes the smallest drawing at least that big
    const size = Number(await sized.getAttribute('data-size'));
    expect(size).toBeLessThan(44);
    await expect(image).toHaveAttribute('sizes', `${size}px`);
    await expect.poll(() => image.evaluate(img => img.currentSrc)).toContain(`${SMALL}.webp`);
    // a landmark opens its bubble above its icon, titled with its name, whose scroll opens Wikipedia in the article panel
    const landmark = sized;
    // no badge on the icon
    await expect(landmark.locator('a, button')).toHaveCount(0);
    await landmark.locator('img').click();
    // it covers no place rows, so the bubble has only its title
    const list = page.locator('.map-event-list');
    const title = list.locator('.map-event-list-title');
    await expect(title.locator('strong')).toHaveText('Listed Landmark');
    await expect(title.locator('i.fa-scroll')).toHaveCount(1);
    await expect(list).toHaveText('Listed Landmark');
    // the bubble opens above the icon, leaving it in view
    const icon = await landmark.boundingBox();
    const bubble = await page.locator('.map-event-popup').boundingBox();
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(icon.y + 2);
    // the title opens the article panel, not a new tab
    const pages = context.pages().length;
    await title.click();
    await expect(page.locator('#info-panel')).toHaveClass(/open/);
    expect(context.pages().length).toBe(pages);
    await page.locator('#toggle-info').click();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.map-landmark')).toHaveCount(0);
    // a reload keeps them off
    await page.reload();
    await expect(page.locator('#timeline-content .event').first()).toBeVisible();
    await page.locator('#toggle-map').click();
    await expect(page.getByRole('button', { name: 'Landmarks' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.map-landmark')).toHaveCount(0);
    expect(errors).toEqual([]);
});
