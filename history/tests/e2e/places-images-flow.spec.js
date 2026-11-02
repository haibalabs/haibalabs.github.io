import { test, expect } from '@playwright/test';
import { EMULATORS_RUNNING, STORAGE, createAccount, listAsOwner, resetEmulators, signIn, writeAsOwner } from './emulator.js';

// Locations and images in event forms (WORLD-EDITS.md, phase 4; Rachid, 2026-10-31): Suggest an edit and
// the personal Add event form share one place picker and one image link; world images whose license
// isn't a known free one wait for a reviewer to confirm it. Against the Auth, Firestore and Storage emulators.
test.skip(!EMULATORS_RUNNING || !STORAGE, 'Run under firebase emulators:exec (npm run test:auth-flow in firebase/)');

const id = (n) => `evt_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const MUNICH = { name: 'Munich', city: '', region: '', country: 'Germany', historical_name: '', place_id: 'plc_munich',
  geography: { status: 'identified', precision: 'settlement', coordinates: [48.137, 11.575] } };
const WORLD = [
  { event_id: id(1), name: 'Max Schmeling knocks out Joe Louis', enhanced_time: '1936-06-19', enhanced_description: 'In New York.',
    categories: ['culture'], figures: [], locations: [], confidence: 'high' },
  { event_id: id(2), name: 'Munich Agreement signed', enhanced_time: '1938-09-30', enhanced_description: 'In Munich.',
    categories: ['politics'], figures: [], locations: [MUNICH], confidence: 'high' },
];
const COMMONS_FILE = 'https://commons.wikimedia.org/wiki/File:Allianz_Arena_final.jpg';
const COMMONS_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Allianz_Arena_final.jpg/1600px-Allianz_Arena_final.jpg';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// The outside services the forms call: Wikidata finds nothing, Commons answers for one file, images and tiles are tiny.
async function offline(page) {
  await page.route('https://www.wikidata.org/w/api.php**', route => route.fulfill({ json: { search: [] } }));
  await page.route('https://commons.wikimedia.org/w/api.php**', route => route.fulfill({ json: { query: { pages: { 7: {
    title: 'File:Allianz Arena final.jpg', imageinfo: [{ url: COMMONS_IMAGE, thumburl: COMMONS_IMAGE, descriptionurl: COMMONS_FILE,
      extmetadata: { Artist: { value: 'Jane Doe' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }],
  } } } } }));
  await page.route(/upload\.wikimedia\.org|news\.example|tile\.openstreetmap\.org/, route => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('https://en.wikipedia.org/**', route => route.fulfill({ json: { pages: [] } }));
}

async function openWorld(page) {
  await offline(page);
  await page.route('**/canonical-t2.json', route => route.fulfill({ json: WORLD }));
  await page.goto('/history/index.html?emulator&file=canonical-t2.json');
  await page.waitForSelector('#timeline-content .event');
}

const card = (page, name) => page.locator('#timeline-content .event').filter({ has: page.locator('.event-header', { hasText: name }) });

async function signInAs(page, email) {
  await signIn(page, email);
  await expect(page.locator('#user-email')).toHaveText(email);
  await page.click('.settings-close-btn');
}

async function editing(page) {
  await page.click('#settings-btn');
  await page.locator('#editing-toggle').setChecked(true);
  await page.click('.settings-close-btn');
}

async function openReview(page) {
  await openWorld(page);
  await signInAs(page, 'admin@example.test');
  await page.goto('/history/review.html?emulator');
  await expect(page.locator('#tab-waiting')).toHaveText(/Waiting · \d+/);
}

async function photoFile(page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext('2d');
    context.fillStyle = '#3366cc';
    context.fillRect(0, 0, 800, 600);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(bytes) };
}

test.beforeEach(async ({ request }) => {
  await resetEmulators(request);
  await createAccount(request, 'editor@example.test', 'editor');
  await createAccount(request, 'admin@example.test', 'admin');
});

test('a new event with a picked place and a Commons image reaches visitors with its point and credit', async ({ page, browser, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await editing(page);
  await page.click('#suggest-event');
  await page.fill('#se-name', 'Paris Saint-Germain wins the 2025 Champions League');
  await page.fill('#se-time', 'May 31, 2025');
  await page.fill('#se-description', 'PSG beat Inter 5–0 in the final.');
  // the place search lists the loaded events' places first
  await page.fill('#se-loc-search', 'Mun');
  await page.locator('#se-loc-results button', { hasText: 'Munich, Germany' }).click();
  await expect(page.locator('#se-locations .loc-row .loc-label')).toHaveText('Munich, Germany');
  await expect(page.locator('#se-locations .loc-note')).toHaveText('On the map · town or city');
  await page.locator('#se-image .mode-switch button', { hasText: 'Link' }).click();
  await page.fill('#se-img-link', COMMONS_FILE);
  await expect(page.locator('#se-image .image-link-status')).toHaveText('✓ Found on Wikimedia Commons · CC BY-SA 4.0');
  await expect(page.locator('#se-image .image-card-credit')).toHaveText('Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);
  const [stored] = await listAsOwner(request, 'edits');
  expect(Object.keys(stored.fields.changes.mapValue.fields).sort()).toEqual(['enhanced_description', 'enhanced_time', 'image', 'location[0]', 'name']);

  // a Commons image with a free license needs no confirmation
  const admin = await browser.newPage();
  await openReview(admin);
  const edit = admin.locator('.review-edit');
  await expect(edit.locator('.review-place-label')).toHaveText('Munich, Germany');
  await expect(edit.locator('.image-card-credit')).toHaveText('Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons');
  // the license is read from Commons again before Approve opens, since the author's browser wrote the record
  await expect(edit.locator('.review-commons-check')).toHaveText('✓ Commons confirms CC BY-SA 4.0');
  await expect(edit.locator('.review-license')).toHaveCount(0);
  await edit.getByRole('button', { name: 'Approve new event' }).click();
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 0');

  const visitor = await browser.newPage();
  await openWorld(visitor);
  await visitor.fill('#searchInput', 'Champions League');
  const event = card(visitor, 'Paris Saint-Germain wins');
  await expect(event.locator('.event-location')).toContainText('Munich');
  await expect(event.locator('.event-image img')).toHaveAttribute('data-original', COMMONS_IMAGE);
  const [overlay] = await listAsOwner(request, 'world_overlay');
  expect(JSON.stringify(overlay)).not.toMatch(/example\.test|"uid"/);
  expect(JSON.stringify(overlay)).toContain('community_edit:edt_');
});

test('a Commons image whose license on Commons differs from the edit’s waits for the reviewer’s check', async ({ page, browser }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await editing(page);
  await card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  await page.locator('#se-image .mode-switch button', { hasText: 'Link' }).click();
  await page.fill('#se-img-link', COMMONS_FILE);
  await expect(page.locator('#se-image .image-link-status')).toHaveText('✓ Found on Wikimedia Commons · CC BY-SA 4.0');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  const admin = await browser.newPage();
  await openReview(admin);
  // Commons now says something else (or the record was written by hand): the edit's claim isn't trusted
  await admin.route('https://commons.wikimedia.org/w/api.php**', route => route.fulfill({ json: { query: { pages: { 7: {
    title: 'File:Allianz Arena final.jpg', imageinfo: [{ url: COMMONS_IMAGE, thumburl: COMMONS_IMAGE, descriptionurl: COMMONS_FILE,
      extmetadata: { Artist: { value: 'Jane Doe' }, LicenseShortName: { value: 'All rights reserved' } } }],
  } } } } }));
  await admin.reload();
  const edit = admin.locator('.review-edit');
  await expect(edit.locator('.review-commons-check')).toHaveText('Commons says the license is All rights reserved, not CC BY-SA 4.0.');
  await expect(edit.getByLabel('License', { exact: true })).toHaveValue('All rights reserved');
  await expect(edit.getByRole('button', { name: 'Approve 1 change' })).toBeDisabled();
});

test('an approved Commons image publishes Commons’ own file and credit, not what the edit claimed', async ({ browser, request }) => {
  // an edit written outside the form: the CC BY-SA page, with another file's URL and a made-up credit
  const editId = 'edt_0a1b2c3d-0000-4000-8000-0000000000e1';
  await writeAsOwner(request, `edits/${editId}`, {
    edit_id: editId, kind: 'update', event_id: id(1), event_name: 'Max Schmeling knocks out Joe Louis',
    dataset: { id: 'world-history', sha256: null, locations_release_sha256: null },
    changes: { image: { before: null, after: {
      source: 'commons', image_url: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Another_file.jpg',
      source_url: COMMONS_FILE, file_page: 'File:Allianz Arena final.jpg', credit: 'Someone Else', license_name: 'CC BY-SA 4.0',
      caption: 'The arena', license_url: null, rights_statement: null, display_date: null, image_role: null,
    } } },
    reason: '', sources: [], source_conflict: false, author: { uid: 'someone', email: 'editor@example.test' },
    created_at: new Date(), revised_at: new Date(), revision: 1, content_sha256: 'b'.repeat(64), status: 'submitted', checks: { browser: [] },
  });
  const admin = await browser.newPage();
  await openReview(admin);
  const edit = admin.locator('.review-edit');
  await expect(edit.locator('.review-commons-check')).toHaveText('✓ Commons confirms CC BY-SA 4.0');
  await expect(edit.locator('.review-commons-record')).toHaveText("Publishes Commons' file and credit: Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons");
  await edit.getByRole('button', { name: 'Approve 1 change' }).click();
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 0');
  const [overlay] = await listAsOwner(request, 'world_overlay');
  const published = JSON.stringify(overlay);
  expect(published).toContain(COMMONS_IMAGE);
  expect(published).toContain('Jane Doe');
  expect(published).not.toContain('Another_file');
  expect(published).not.toContain('Someone Else');
  expect(published).toContain('The arena');
});

test('an image from another site waits for the reviewer to confirm its license and credit', async ({ page, browser, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await editing(page);
  await card(page, 'Max Schmeling knocks out Joe Louis').locator('.edit-pencil').click();
  await page.locator('#se-image .mode-switch button', { hasText: 'Link' }).click();
  await page.fill('#se-img-link', 'https://news.example/schmeling.png');
  await expect(page.locator('#se-image .image-link-status')).toHaveText('License unknown: a reviewer checks it before the image is shown.');
  await page.fill('#se-img-rights', 'Press photo, used with the agency’s permission');
  await expect(page.locator('.form-group[data-field="image"] .changed-tag')).toBeVisible();
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  const admin = await browser.newPage();
  await openReview(admin);
  const edit = admin.locator('.review-edit');
  const approve = edit.getByRole('button', { name: 'Approve 1 change' });
  await expect(edit.locator('.review-license')).toBeVisible();
  await expect(approve).toBeDisabled();
  await edit.getByRole('checkbox', { name: /I checked the license/ }).check();
  await edit.getByLabel('Credit', { exact: true }).fill('Acme Press');
  await expect(approve).toBeDisabled();
  await edit.getByLabel('License', { exact: true }).fill('Used with permission');
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 0');

  const [overlay] = await listAsOwner(request, 'world_overlay');
  expect(JSON.stringify(overlay)).toContain('Acme Press');
  const visitor = await browser.newPage();
  await openWorld(visitor);
  await expect(card(visitor, 'Max Schmeling knocks out Joe Louis').locator('.event-image img')).toHaveAttribute('data-original', 'https://news.example/schmeling.png');
});

test('an uploaded photo stays private until approved, then visitors load its public copy', async ({ page, browser, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await editing(page);
  await card(page, 'Munich Agreement signed').locator('.edit-pencil').click();
  await page.setInputFiles('#se-img-file', await photoFile(page));
  await expect(page.locator('#se-image .image-card-thumb img')).toHaveAttribute('src', /^blob:/);
  await page.click('#se-submit');
  await expect(page.locator('#suggest-edit-form .form-error')).toHaveText('Say who took the photo, for its credit.');
  await page.fill('#se-img-credit', 'Editor Example');
  await page.click('#se-submit');
  await expect(page.locator('#suggest-edit-form .form-error')).toHaveText('Confirm that you may share this photo.');
  await page.locator('#se-img-grant').check();
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  const admin = await browser.newPage();
  await openReview(admin);
  const edit = admin.locator('.review-edit');
  await expect(edit.locator('.image-card-thumb img')).toHaveAttribute('src', /^blob:/);
  await edit.getByRole('checkbox', { name: /I checked the license/ }).check();
  await expect(edit.getByLabel('Credit', { exact: true })).toHaveValue('Editor Example');
  await expect(edit.getByLabel('License', { exact: true })).toHaveValue('Used with permission');
  await edit.getByRole('button', { name: 'Approve 1 change' }).click();
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 0');

  const [overlay] = await listAsOwner(request, 'world_overlay');
  const published = JSON.stringify(overlay);
  expect(published).toContain('world_images%2F');
  const visitor = await browser.newPage();
  await openWorld(visitor);
  await expect(card(visitor, 'Munich Agreement signed').locator('.event-image img')).toHaveAttribute('data-original', /world_images%2F/);
});

test('a new event can be approved without an image whose license isn’t confirmed', async ({ page, browser, request }) => {
  await openWorld(page);
  await signInAs(page, 'editor@example.test');
  await editing(page);
  await page.click('#suggest-event');
  await page.fill('#se-name', 'Opening of the arena');
  await page.fill('#se-time', '2005');
  await page.fill('#se-description', 'The arena opens.');
  await page.locator('#se-image .mode-switch button', { hasText: 'Link' }).click();
  await page.fill('#se-img-link', 'https://news.example/arena.png');
  await expect(page.locator('#se-image .image-link-status')).toContainText('License unknown');
  await page.click('#se-submit');
  await expect(page.locator('.toast', { hasText: 'Sent for review.' })).toHaveCount(1);

  const admin = await browser.newPage();
  await openReview(admin);
  const edit = admin.locator('.review-edit');
  await expect(edit.getByRole('button', { name: 'Approve new event' })).toBeDisabled();
  await edit.getByRole('button', { name: 'Approve without image' }).click();
  await expect(admin.locator('#tab-waiting')).toHaveText('Waiting · 0');
  const [overlay] = await listAsOwner(request, 'world_overlay');
  expect(JSON.stringify(overlay)).not.toContain('news.example');
  const [stored] = await listAsOwner(request, 'edits');
  expect(stored.fields.fields.mapValue.fields.image.mapValue.fields.status.stringValue).toBe('rejected');
});

test('the personal form uses the same place picker and image link', async ({ page, request }) => {
  await openWorld(page);
  await signIn(page, 'editor@example.test');
  await page.fill('#timeline-title', 'Family');
  await page.click('#timeline-create button[type="submit"]');
  await expect(page.locator('#timeline-pill .timeline-pill-title')).toHaveText('Family');
  await page.click('#add-event');
  await page.fill('#add-event-form [name="name"]', 'Trip to Munich');
  await page.fill('#add-event-form [name="enhanced_time"]', '2019');
  await page.fill('#add-event-form [name="enhanced_description"]', 'A week in Bavaria.');
  await page.fill('#add-loc-search', 'Mun');
  await page.locator('#add-loc-results button', { hasText: 'Munich, Germany' }).click();
  await expect(page.locator('#add-locations .loc-label')).toHaveText('Munich, Germany');
  await page.locator('#photo-group .mode-switch button', { hasText: 'Link' }).click();
  await page.fill('#add-img-link', COMMONS_FILE);
  await expect(page.locator('#photo-group .image-card-credit')).toHaveText('Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.click('#add-event-form button[type="submit"]');
  const event = card(page, 'Trip to Munich');
  await expect(event.locator('.event-location')).toContainText('Munich');
  await expect(event.locator('.event-image img')).toHaveAttribute('data-original', COMMONS_IMAGE);
  const timeline = new URL(page.url()).searchParams.get('timeline');
  const [stored] = await listAsOwner(request, `timelines/${timeline}/events`);
  const location = stored.fields.locations.arrayValue.values[0].mapValue.fields;
  expect(location.geography.mapValue.fields.coordinates.arrayValue.values.map(v => v.doubleValue)).toEqual([48.137, 11.575]);
  expect(stored.fields.image_preview.mapValue.fields.credit.stringValue).toBe('Jane Doe');
  expect(errors).toEqual([]);
});
