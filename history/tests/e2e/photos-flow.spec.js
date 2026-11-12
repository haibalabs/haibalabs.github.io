import { test, expect } from './cdn-cache.js';
import { EMULATORS_RUNNING, STORAGE, createAccount, downloadAsOwner, listAsOwner, listFilesAsOwner, resetEmulators, signIn } from './emulator.js';
import { keepMapOffline } from './firebase-stub.js';

// Photos in personal timelines (PERSONAL-IMAGES.md), against the Auth, Firestore and Storage emulators.
test.skip(!EMULATORS_RUNNING || !STORAGE, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

const WORLD = [{
  event_id: 'evt_00000001-0000-4000-8000-000000000000', name: 'Founding of the archive', enhanced_time: '1901',
  enhanced_description: 'A world fixture.', categories: ['culture'], figures: [], locations: [], confidence: 'high',
}];
const GPS_MARKER = 'GPSMARKER-HISTORILINE';

async function openWorld(page) {
  await page.route('**/canonical-t2.json', route => route.fulfill({ json: WORLD }));
  await page.goto('/history/index.html?emulator&file=canonical-t2.json');
  await page.waitForSelector('#timeline-content .event');
}

const card = (page, name) => page.locator('#timeline-content .event')
  .filter({ has: page.locator('.event-header', { hasText: name }) });
const timelineId = (page) => new URL(page.url()).searchParams.get('timeline');

async function createTimeline(page, title) {
  await page.fill('#timeline-title', title);
  await page.click('#timeline-create button[type="submit"]');
  await expect(page.locator('#timeline-pill .timeline-pill-title')).toHaveText(title);
  return timelineId(page);
}

// A JPEG drawn in the browser, larger than the stored size, with an EXIF segment carrying a GPS
// marker spliced in after the start-of-image marker.
async function photoFile(page, color = '#3366cc') {
  const bytes = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1800;
    const context = canvas.getContext('2d');
    context.fillStyle = fill;
    context.fillRect(0, 0, 2400, 1800);
    context.fillStyle = '#fff';
    context.fillRect(200, 200, 800, 600);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, color);
  const jpeg = Buffer.from(bytes);
  const tiff = Buffer.concat([Buffer.from('MM\0*\0\0\0\x08\0\0\0\0\0\0', 'binary'), Buffer.from(GPS_MARKER)]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
  return { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]) };
}

async function addEventWithPhoto(page, name, color) {
  await page.click('#add-event');
  await page.fill('#add-event-form [name="name"]', name);
  await page.fill('#add-event-form [name="enhanced_time"]', '1950');
  await page.fill('#add-event-form [name="enhanced_description"]', `${name}, with a photo.`);
  await page.setInputFiles('#photo-input', await photoFile(page, color));
  await expect(page.locator('#photo-group .photo-preview img')).toHaveAttribute('src', /^blob:/);
  await page.click('#add-event-form button[type="submit"]');
  await expect(card(page, name).locator('.personal-photo img')).toHaveAttribute('src', /^blob:/);
}

async function eventDoc(request, id) {
  const [doc] = await listAsOwner(request, `timelines/${id}/events`);
  return doc;
}

test.beforeEach(async ({ page, request }) => {
  await keepMapOffline(page);
  await resetEmulators(request);
  await createAccount(request, 'editor@example.test', 'editor');
});

test('a photo is resized, stripped of metadata, stored privately under the event, and shown after a reload', async ({ page, request }) => {
  const storageRequests = [];
  page.on('request', req => { if (req.url().includes(`${STORAGE}/v0/b/`)) storageRequests.push(req); });
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  await addEventWithPhoto(page, 'Beach day');

  const doc = await eventDoc(request, id);
  const image = Object.fromEntries(Object.entries(doc.fields.image.mapValue.fields).map(([k, v]) => [k, Object.values(v)[0]]));
  const eventId = doc.fields.event_id.stringValue;
  expect(image.image_role).toBe('personal_photo');
  expect(image.mime).toBe('image/webp');
  expect([Number(image.width), Number(image.height)]).toEqual([1600, 1200]);
  expect(image.ref).toMatch(new RegExp(`^timelines/${id}/\\d+_\\d+/events/${eventId}/img_[0-9a-f-]{36}\\.webp$`));
  expect(image.thumb_ref).toBe(image.ref.replace('.webp', '_thumb.webp'));

  // exactly the two displayed copies are stored; no original
  expect(await listFilesAsOwner(request, `timelines/${id}/`)).toEqual([image.ref, image.thumb_ref].sort());
  for (const path of [image.ref, image.thumb_ref]) {
    const stored = await downloadAsOwner(request, path);
    expect(stored.contentType).toBe('image/webp');
    expect(stored.body.subarray(0, 4).toString()).toBe('RIFF');
    expect(stored.body.includes(Buffer.from('Exif'))).toBe(false);
    expect(stored.body.includes(Buffer.from(GPS_MARKER))).toBe(false);
  }
  expect(Number(image.bytes)).toBe((await downloadAsOwner(request, image.ref)).body.length);

  // the full photo opens in the viewer and closes with Escape
  await card(page, 'Beach day').locator('.personal-photo img').click();
  await expect(page.locator('#photo-viewer')).toBeVisible();
  await expect(page.locator('#photo-viewer img')).toHaveAttribute('src', /^blob:/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#photo-viewer')).toBeHidden();

  await page.reload();
  await expect(card(page, 'Beach day').locator('.personal-photo img')).toHaveAttribute('src', /^blob:/);

  // photos are read through the signed-in SDK: media downloads only, never download-URL tokens or metadata
  const reads = storageRequests.filter(req => req.method() === 'GET');
  expect(reads.length).toBeGreaterThan(0);
  for (const req of reads) {
    expect(req.url()).toContain('alt=media');
    expect(req.url()).not.toContain('token=');
  }
});

test('deleting an event or its timeline deletes the photo files', async ({ page, request }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  const id = await createTimeline(page, 'Family history');
  await addEventWithPhoto(page, 'First house');
  await addEventWithPhoto(page, 'Second house', '#884499');
  expect(await listFilesAsOwner(request, `timelines/${id}/`)).toHaveLength(4);

  page.once('dialog', dialog => dialog.accept());
  await card(page, 'First house').locator('.personal-remove').click();
  await expect(card(page, 'First house')).toHaveCount(0);
  expect(await listFilesAsOwner(request, `timelines/${id}/`)).toHaveLength(2);

  await page.click('#settings-btn');
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`.timeline-item[data-timeline-id="${id}"]`).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.timeline-empty')).toHaveText('No timelines yet.');
  expect(await listFilesAsOwner(request, `timelines/${id}/`)).toEqual([]);
});
