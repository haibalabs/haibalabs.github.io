// Firestore rules tests. Run through the emulator: npm run test:rules
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const ROLES = { viewer: 'viewer', editor: 'editor', reviewer: 'reviewer', admin: 'admin' };

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-historiline',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8085 },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const role of Object.values(ROLES)) await setDoc(doc(db, 'users', role), { role });
    await setDoc(doc(db, 'events_main', 'evt_1'), { name: 'Existing event', userId: 'admin' });
    await setDoc(doc(db, 'authorized_users', 'admin'), { authorized: 'true' });
    await setDoc(doc(db, 'other', 'x'), { value: 1 });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anonymous = () => env.unauthenticatedContext().firestore();
const event = (uid, extra = {}) => ({ name: 'New event', userId: uid, lastModified: serverTimestamp(), ...extra });
// Writes an event document whose event_id matches its document ID, unless data overrides it.
const writeEvent = (db, collectionName, id, data) => setDoc(doc(db, collectionName, id), { event_id: id, ...data });

describe('anonymous visitors', () => {
  it('cannot read events', () => assertFails(getDoc(doc(anonymous(), 'events_main', 'evt_1'))));
  it('cannot list events', () => assertFails(getDocs(collection(anonymous(), 'events_main'))));
  it('cannot write events', () => assertFails(writeEvent(anonymous(), 'events_main', 'evt_2', event('nobody'))));
  it('cannot read roles', () => assertFails(getDoc(doc(anonymous(), 'users', 'admin'))));
});

describe('signed-in accounts without a role', () => {
  it('cannot read events', () => assertFails(getDoc(doc(as('stranger'), 'events_main', 'evt_1'))));
  it('cannot write events', () => assertFails(writeEvent(as('stranger'), 'events_main', 'evt_2', event('stranger'))));
  it('cannot list roles', () => assertFails(getDocs(collection(as('stranger'), 'users'))));
  it('cannot give themselves a role', () => assertFails(setDoc(doc(as('stranger'), 'users', 'stranger'), { role: 'admin' })));
});

describe('viewers', () => {
  it('can read and list events', async () => {
    await assertSucceeds(getDoc(doc(as('viewer'), 'events_main', 'evt_1')));
    await assertSucceeds(getDocs(collection(as('viewer'), 'events_main')));
  });
  it('can read their own role', () => assertSucceeds(getDoc(doc(as('viewer'), 'users', 'viewer'))));
  it('cannot read another account\'s role', () => assertFails(getDoc(doc(as('viewer'), 'users', 'admin'))));
  it('cannot write events', () => assertFails(writeEvent(as('viewer'), 'events_main', 'evt_2', event('viewer'))));
});

for (const role of [ROLES.editor, ROLES.reviewer]) {
  describe(`${role}s`, () => {
    it('can create and update events attributed to themselves', async () => {
      await assertSucceeds(writeEvent(as(role), 'events_main', 'evt_2', event(role)));
      await assertSucceeds(writeEvent(as(role), 'events_main', 'evt_1', event(role, { name: 'Renamed' })));
    });
    it('cannot attribute a write to another account', () =>
      assertFails(writeEvent(as(role), 'events_main', 'evt_2', event('admin'))));
    it('cannot set their own timestamp', () =>
      assertFails(writeEvent(as(role), 'events_main', 'evt_2', event(role, { lastModified: Timestamp.fromMillis(0) }))));
    it('cannot write an event without a name', () =>
      assertFails(writeEvent(as(role), 'events_main', 'evt_2', event(role, { name: 42 }))));
    it('cannot store an event under a document ID other than its event_id', async () => {
      await assertFails(writeEvent(as(role), 'events_main', 'evt_2', event(role, { event_id: 'evt_3' })));
      await assertFails(setDoc(doc(as(role), 'events_main', 'evt_2'), event(role)));
    });
    it('cannot delete events', () => assertFails(deleteDoc(doc(as(role), 'events_main', 'evt_1'))));
    it('cannot change their own role', () => assertFails(setDoc(doc(as(role), 'users', role), { role: 'admin' })));
    it('cannot grant roles to others', () => assertFails(setDoc(doc(as(role), 'users', 'stranger'), { role: 'editor' })));
    it('cannot write outside event collections', () => assertFails(writeEvent(as(role), 'other', 'y', event(role))));
  });
}

describe('admins', () => {
  it('can grant, change and revoke another account\'s role', async () => {
    const db = as('admin');
    await assertSucceeds(setDoc(doc(db, 'users', 'stranger'), { role: 'viewer' }));
    await assertSucceeds(setDoc(doc(db, 'users', 'stranger'), { role: 'editor' }));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'stranger')));
  });
  it('can list roles', () => assertSucceeds(getDocs(collection(as('admin'), 'users'))));
  it('cannot grant an unknown role', () => assertFails(setDoc(doc(as('admin'), 'users', 'stranger'), { role: 'owner' })));
  it('cannot add other fields to a role document', () =>
    assertFails(setDoc(doc(as('admin'), 'users', 'stranger'), { role: 'viewer', note: 'x' })));
  it('cannot change or remove their own role', async () => {
    await assertFails(setDoc(doc(as('admin'), 'users', 'admin'), { role: 'viewer' }));
    await assertFails(deleteDoc(doc(as('admin'), 'users', 'admin')));
  });
  it('can delete events', () => assertSucceeds(deleteDoc(doc(as('admin'), 'events_main', 'evt_1'))));
});

describe('collections without rules', () => {
  it('deny the retired authorized_users collection, even to admins', async () => {
    await assertFails(getDoc(doc(as('admin'), 'authorized_users', 'admin')));
    await assertFails(setDoc(doc(as('admin'), 'authorized_users', 'stranger'), { authorized: 'true' }));
  });
  it('deny any other collection, even to admins', async () => {
    await assertFails(getDoc(doc(as('admin'), 'other', 'x')));
    await assertFails(setDoc(doc(as('admin'), 'notes', 'n1'), { title: 'x' }));
  });
  it('deny a collection named only "events_"', () =>
    assertFails(writeEvent(as('admin'), 'events_', 'e', event('admin'))));
});

// Personal timelines. Accounts come from the seeded users: viewer, editor, reviewer, admin.
const timeline = (owner, extra = {}) => ({
  owner, title: 'Family history', visibility: 'private', members: [],
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});
// The seeded timeline's createdAt, which its events carry as timelineCreatedAt.
const SEEDED_AT = Timestamp.fromMillis(1_700_000_000_000);
const EVT_A = 'evt_00000000-0000-4000-8000-00000000000a';
const EVT_B = 'evt_00000000-0000-4000-8000-00000000000b';
const EVT_C = 'evt_00000000-0000-4000-8000-00000000000c';
const timelineEvent = (uid, id, extra = {}) => ({
  event_id: id, name: 'Grandmother born', enhanced_time: '1931', timelineCreatedAt: SEEDED_AT,
  userId: uid, lastModified: serverTimestamp(), ...extra,
});
const tl = (db, id = 't1') => doc(db, 'timelines', id);
const tlEvent = (db, id, timelineId = 't1') => doc(db, 'timelines', timelineId, 'events', id);
const tlEvents = (db, createdAt = SEEDED_AT) =>
  query(collection(db, 'timelines', 't1', 'events'), where('timelineCreatedAt', '==', createdAt));

// Seeds timeline t1 owned by `owner`, with one event, bypassing the rules.
async function seedTimeline(owner, members = []) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(tl(db), { owner, title: 'Family history', visibility: 'private', members, createdAt: SEEDED_AT, updatedAt: SEEDED_AT });
    await setDoc(tlEvent(db, EVT_A), { event_id: EVT_A, name: 'Seeded', enhanced_time: '1900', timelineCreatedAt: SEEDED_AT, userId: owner, lastModified: SEEDED_AT });
  });
}

// Deletes t1 alone, as the owner, leaving its events behind as a failed or racing cleanup would.
const deleteTimelineOnly = (owner) => assertSucceeds(deleteDoc(tl(as(owner))));

describe('personal timelines: creating', () => {
  it('editors, reviewers and admins can create a timeline they own', async () => {
    await assertSucceeds(setDoc(tl(as('editor')), timeline('editor')));
    await assertSucceeds(setDoc(tl(as('reviewer'), 't2'), timeline('reviewer')));
    await assertSucceeds(setDoc(tl(as('admin'), 't3'), timeline('admin')));
  });
  it('viewers, accounts without a role and anonymous visitors cannot create one', async () => {
    await assertFails(setDoc(tl(as('viewer')), timeline('viewer')));
    await assertFails(setDoc(tl(as('stranger')), timeline('stranger')));
    await assertFails(setDoc(tl(anonymous()), timeline('nobody')));
  });
  it('a timeline cannot be created for another owner', () =>
    assertFails(setDoc(tl(as('editor')), timeline('admin'))));
  it('only private visibility is allowed', () =>
    assertFails(setDoc(tl(as('editor')), timeline('editor', { visibility: 'public' }))));
  it('the title must be 1 to 120 characters', async () => {
    await assertFails(setDoc(tl(as('editor')), timeline('editor', { title: '' })));
    await assertFails(setDoc(tl(as('editor')), timeline('editor', { title: 'x'.repeat(121) })));
  });
  it('unknown fields, client timestamps and the owner as a member are rejected', async () => {
    await assertFails(setDoc(tl(as('editor')), timeline('editor', { color: 'red' })));
    await assertFails(setDoc(tl(as('editor')), timeline('editor', { createdAt: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(tl(as('editor')), timeline('editor', { members: ['editor'] })));
  });
});

describe('personal timelines: reading and listing', () => {
  beforeEach(() => seedTimeline('viewer', ['reviewer']));

  it('the owner and listed members can read it', async () => {
    await assertSucceeds(getDoc(tl(as('viewer'))));
    await assertSucceeds(getDoc(tl(as('reviewer'))));
  });
  it('other accounts, admins included, and anonymous visitors cannot', async () => {
    await assertFails(getDoc(tl(as('editor'))));
    await assertFails(getDoc(tl(as('admin'))));
    await assertFails(getDoc(tl(as('stranger'))));
    await assertFails(getDoc(tl(anonymous())));
  });
  it('the owner can list their timelines; nobody can list another account\'s', async () => {
    await assertSucceeds(getDocs(query(collection(as('viewer'), 'timelines'), where('owner', '==', 'viewer'))));
    await assertSucceeds(getDocs(query(collection(as('reviewer'), 'timelines'), where('members', 'array-contains', 'reviewer'))));
    await assertFails(getDocs(query(collection(as('editor'), 'timelines'), where('owner', '==', 'viewer'))));
    await assertFails(getDocs(collection(as('viewer'), 'timelines')));
  });
});

describe('personal timelines: changing and deleting', () => {
  beforeEach(() => seedTimeline('viewer', ['reviewer']));
  const renamed = (extra = {}) => ({
    owner: 'viewer', title: 'Renamed', visibility: 'private', members: ['reviewer'], updatedAt: serverTimestamp(), ...extra,
  });

  it('the owner can rename it and change its members', async () => {
    const db = as('viewer');
    const createdAt = (await getDoc(tl(db))).data().createdAt;
    await assertSucceeds(setDoc(tl(db), renamed({ createdAt })));
    await assertSucceeds(setDoc(tl(db), renamed({ createdAt, members: [] })));
  });
  it('the owner cannot hand it to someone else or make it public', async () => {
    const db = as('viewer');
    const createdAt = (await getDoc(tl(db))).data().createdAt;
    await assertFails(setDoc(tl(db), renamed({ createdAt, owner: 'editor' })));
    await assertFails(setDoc(tl(db), renamed({ createdAt, visibility: 'public' })));
  });
  it('members cannot rename, reshare or delete it', async () => {
    const db = as('reviewer');
    const createdAt = (await getDoc(tl(db))).data().createdAt;
    await assertFails(setDoc(tl(db), renamed({ createdAt })));
    await assertFails(deleteDoc(tl(db)));
  });
  it('only the owner can delete it', async () => {
    await assertFails(deleteDoc(tl(as('admin'))));
    await assertSucceeds(deleteDoc(tl(as('viewer'))));
  });
});

describe('personal timelines: events', () => {
  beforeEach(() => seedTimeline('viewer', ['reviewer']));

  it('the owner and members can add, change, read and delete events', async () => {
    await assertSucceeds(setDoc(tlEvent(as('viewer'), EVT_B), timelineEvent('viewer', EVT_B)));
    await assertSucceeds(setDoc(tlEvent(as('reviewer'), EVT_C), timelineEvent('reviewer', EVT_C)));
    await assertSucceeds(setDoc(tlEvent(as('reviewer'), EVT_A), timelineEvent('reviewer', EVT_A, { name: 'Edited' })));
    await assertSucceeds(getDoc(tlEvent(as('reviewer'), EVT_A)));
    const listed = await assertSucceeds(getDocs(tlEvents(as('viewer'))));
    if (listed.size !== 3) throw new Error(`expected 3 events, listed ${listed.size}`);
    await assertSucceeds(deleteDoc(tlEvent(as('viewer'), EVT_A)));
  });
  it('listing events must filter on the timeline\'s createdAt', () =>
    assertFails(getDocs(collection(as('viewer'), 'timelines', 't1', 'events'))));
  it('other accounts cannot read or write its events', async () => {
    await assertFails(getDoc(tlEvent(as('editor'), EVT_A)));
    await assertFails(getDocs(tlEvents(as('admin'))));
    await assertFails(setDoc(tlEvent(as('editor'), EVT_B), timelineEvent('editor', EVT_B)));
    await assertFails(getDoc(tlEvent(anonymous(), EVT_A)));
  });
  it('event writes need a matching event_id, a name, a date, the timeline\'s createdAt, the author and the server time', async () => {
    const db = as('viewer');
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_C)));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { name: '' })));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { enhanced_time: 1931 })));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { timelineCreatedAt: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { timelineCreatedAt: null })));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('reviewer', EVT_B)));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { lastModified: Timestamp.fromMillis(0) })));
  });
  it('event IDs must be evt_ followed by a UUID', async () => {
    const db = as('viewer');
    await assertFails(setDoc(tlEvent(db, 'evt_b'), timelineEvent('viewer', 'evt_b')));
    await assertFails(setDoc(tlEvent(db, 'Battle of Hastings'), timelineEvent('viewer', 'Battle of Hastings')));
    const hyphens = 'evt_' + '-'.repeat(36);
    await assertFails(setDoc(tlEvent(db, hyphens), timelineEvent('viewer', hyphens)));
    const misplaced = 'evt_0000000000000-4000-8000-00000000000-b';
    await assertFails(setDoc(tlEvent(db, misplaced), timelineEvent('viewer', misplaced)));
  });
  it('events of a deleted timeline are no longer reachable', async () => {
    await deleteTimelineOnly('viewer');
    await assertFails(getDoc(tlEvent(as('viewer'), EVT_A)));
    await assertFails(setDoc(tlEvent(as('viewer'), EVT_B), timelineEvent('viewer', EVT_B)));
  });
  it('a timeline recreated under the same ID by another account cannot reach the old events', async () => {
    await deleteTimelineOnly('viewer');
    await assertSucceeds(setDoc(tl(as('editor')), timeline('editor')));
    const db = as('editor');
    const createdAt = (await getDoc(tl(db))).data().createdAt;
    await assertFails(getDoc(tlEvent(db, EVT_A)));
    await assertFails(getDocs(tlEvents(db)));
    const listed = await assertSucceeds(getDocs(tlEvents(db, createdAt)));
    if (listed.size !== 0) throw new Error(`expected no events, listed ${listed.size}`);
    await assertFails(setDoc(tlEvent(db, EVT_A), timelineEvent('editor', EVT_A, { timelineCreatedAt: createdAt })));
    await assertFails(setDoc(tlEvent(db, EVT_A), timelineEvent('editor', EVT_A)));
    await assertFails(deleteDoc(tlEvent(db, EVT_A)));
    // The previous owner and member are not members of the new timeline either.
    await assertFails(getDoc(tlEvent(as('viewer'), EVT_A)));
    await assertFails(getDoc(tlEvent(as('reviewer'), EVT_A)));
  });
  it('an event written by a member while the owner deletes the timeline stays unreachable after it is recreated', async () => {
    // The member's write lands after the owner's cleanup removed the events but before the
    // timeline document itself is deleted.
    await assertSucceeds(deleteDoc(tlEvent(as('viewer'), EVT_A)));
    await assertSucceeds(setDoc(tlEvent(as('reviewer'), EVT_B), timelineEvent('reviewer', EVT_B)));
    await deleteTimelineOnly('viewer');
    await assertSucceeds(setDoc(tl(as('editor')), timeline('editor', { members: ['reviewer'] })));
    const createdAt = (await getDoc(tl(as('editor')))).data().createdAt;
    for (const uid of ['editor', 'reviewer']) {
      await assertFails(getDoc(tlEvent(as(uid), EVT_B)));
      await assertFails(setDoc(tlEvent(as(uid), EVT_B), timelineEvent(uid, EVT_B, { timelineCreatedAt: createdAt })));
      const listed = await assertSucceeds(getDocs(tlEvents(as(uid), createdAt)));
      if (listed.size !== 0) throw new Error(`expected no events for ${uid}, listed ${listed.size}`);
    }
  });
});

// An event's photo record. SEEDED_AT is 1,700,000,000 s and 0 ns, so t1's generation is "1700000000_0".
const PHOTO_ID = '0a0b0c0d-0000-4000-8000-000000000001';
const photoPath = (eventId, suffix = '', generation = '1700000000_0') =>
  `timelines/t1/${generation}/events/${eventId}/img_${PHOTO_ID}${suffix}.webp`;
const photo = (eventId, extra = {}) => ({
  ref: photoPath(eventId), thumb_ref: photoPath(eventId, '_thumb'),
  width: 1600, height: 1200, mime: 'image/webp', bytes: 312000, image_role: 'personal_photo', ...extra,
});

describe('personal timelines: event photos', () => {
  beforeEach(() => seedTimeline('viewer', ['reviewer']));

  it('owners and members can save an event with a photo under its own path and generation, or without one', async () => {
    await assertSucceeds(setDoc(tlEvent(as('viewer'), EVT_B), timelineEvent('viewer', EVT_B, { image: photo(EVT_B) })));
    await assertSucceeds(setDoc(tlEvent(as('reviewer'), EVT_C), timelineEvent('reviewer', EVT_C, { image: photo(EVT_C) })));
    await assertSucceeds(setDoc(tlEvent(as('viewer'), EVT_B), timelineEvent('viewer', EVT_B)));
  });
  it('photo paths must belong to this event and the timeline\'s current generation', async () => {
    const db = as('viewer');
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { image: photo(EVT_B, { ref: photoPath(EVT_C) }) })));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { image: photo(EVT_B, { thumb_ref: photoPath(EVT_B) }) })));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, {
      image: photo(EVT_B, { ref: photoPath(EVT_B, '', '1700000000_1'), thumb_ref: photoPath(EVT_B, '_thumb', '1700000000_1') }),
    })));
    await assertFails(setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, {
      image: photo(EVT_B, { ref: 'https://example.com/photo.webp' }),
    })));
  });
  it('photo records have exactly the expected, typed fields', async () => {
    const db = as('viewer');
    const save = (image) => setDoc(tlEvent(db, EVT_B), timelineEvent('viewer', EVT_B, { image }));
    await assertFails(save(photo(EVT_B, { caption: 'x' })));
    await assertFails(save((({ bytes, ...rest }) => rest)(photo(EVT_B))));
    await assertFails(save(photo(EVT_B, { mime: 'image/png' })));
    await assertFails(save(photo(EVT_B, { width: 2000 })));
    await assertFails(save(photo(EVT_B, { bytes: 3 * 1024 * 1024 })));
    await assertFails(save(photo(EVT_B, { image_role: 'event_photo' })));
    await assertFails(save('timelines/t1/x.webp'));
  });
});

describe('proposed edits to world events', () => {
  const EDIT = 'edt_0a1b2c3d-0000-4000-8000-000000000001';
  const OTHER_EDIT = 'edt_0a1b2c3d-0000-4000-8000-000000000002';
  const WORLD_EVT = 'evt_0a1b2c3d-0000-4000-8000-0000000000aa';
  const email = (uid) => `${uid}@example.test`;
  const asUser = (uid) => env.authenticatedContext(uid, { email: email(uid) }).firestore();
  const editDoc = (uid, id = EDIT, extra = {}) => ({
    edit_id: id, kind: 'update', event_id: WORLD_EVT, event_name: 'Max Schmeling knocks out Joe Louis',
    dataset: { id: 'world-history', sha256: 'a'.repeat(64), locations_release_sha256: null },
    changes: { enhanced_description: { before: 'June 13', after: 'June 19' } },
    reason: '', sources: [], source_conflict: false,
    author: { uid, email: email(uid) }, created_at: serverTimestamp(), revised_at: serverTimestamp(),
    revision: 1, content_sha256: 'b'.repeat(64), status: 'submitted', checks: { browser: [] }, ...extra,
  });
  const editRef = (db, id = EDIT) => doc(db, 'edits', id);
  const seedEdit = (uid, extra = {}) => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(editRef(ctx.firestore()), { ...editDoc(uid), created_at: Timestamp.now(), revised_at: Timestamp.now(), ...extra });
  });

  for (const role of [ROLES.editor, ROLES.reviewer, ROLES.admin]) {
    it(`${role}s can submit an edit attributed to themselves`, () => assertSucceeds(setDoc(editRef(asUser(role)), editDoc(role))));
  }
  it('viewers, accounts without a role and visitors cannot submit edits', async () => {
    await assertFails(setDoc(editRef(asUser('viewer')), editDoc('viewer')));
    await assertFails(setDoc(editRef(asUser('stranger')), editDoc('stranger')));
    await assertFails(setDoc(editRef(anonymous()), editDoc('nobody')));
  });
  it('an edit must name its real author, with the server time', async () => {
    const db = asUser('editor');
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { author: { uid: 'reviewer', email: email('reviewer') } })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { author: { uid: 'editor', email: 'someone@else.test' } })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { created_at: Timestamp.fromMillis(0) })));
  });
  it('a new edit starts submitted at revision 1, with no review results', async () => {
    const db = asUser('editor');
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { status: 'approved' })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { revision: 2 })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { review: { decision: 'approved' } })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { fields: { enhanced_description: { status: 'approved' } } })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { checks: { browser: [], automatic: { results: [] } } })));
  });
  it('an edit changes only known fields, under its own ID', async () => {
    const db = asUser('editor');
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { changes: { confidence: { before: 'high', after: 'low' } } })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { changes: {} })));
    await assertFails(setDoc(editRef(db), editDoc('editor', OTHER_EDIT)));
    await assertFails(setDoc(doc(db, 'edits', 'not-an-edit-id'), editDoc('editor', 'not-an-edit-id')));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { event_id: 'evt_1' })));
  });
  it('an edit can change a location at positions 0 to 4, and the image', async () => {
    const db = asUser('editor');
    const place = { name: 'Allianz Arena', city: 'Munich', region: '', country: 'Germany', historical_name: '', point: [48.2, 11.6], precision: 'site' };
    await assertSucceeds(setDoc(editRef(db), editDoc('editor', EDIT, { changes: { 'location[1]': { before: null, after: place }, 'location[4]': { before: place, after: null } } })));
    await assertFails(setDoc(editRef(db, OTHER_EDIT), editDoc('editor', OTHER_EDIT, { changes: { 'location[5]': { before: null, after: place } } })));
    await assertFails(setDoc(editRef(db, OTHER_EDIT), editDoc('editor', OTHER_EDIT, { changes: { locations: { before: [], after: [place] } } })));
    const commons = { source: 'commons', image_url: 'https://upload.wikimedia.org/a.jpg', credit: 'Jane Doe', license_name: 'CC BY-SA 4.0' };
    await assertSucceeds(setDoc(editRef(db, OTHER_EDIT), editDoc('editor', OTHER_EDIT, { changes: { image: { before: null, after: commons } } })));
  });
  it('an uploaded image points at the author’s own file for that edit', async () => {
    const db = asUser('editor');
    const upload = (path) => ({ source: 'upload', image_url: null, credit: 'Me', asset: { path, sha256: 'c'.repeat(64), bytes: 10, width: 4, height: 3 } });
    const own = `edit_uploads/editor/${EDIT}/r1-${'c'.repeat(64)}.webp`;
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { changes: { image: { before: null, after: upload(`edit_uploads/reviewer/${EDIT}/r1-${'c'.repeat(64)}.webp`) } } })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { changes: { image: { before: null, after: upload(`world_images/${WORLD_EVT}/x.webp`) } } })));
    await assertSucceeds(setDoc(editRef(db), editDoc('editor', EDIT, { changes: { image: { before: null, after: upload(own) } } })));
  });
  it('only the author and admins can read an edit; nobody can delete one', async () => {
    await seedEdit('editor');
    await assertSucceeds(getDoc(editRef(asUser('editor'))));
    await assertSucceeds(getDoc(editRef(asUser('admin'))));
    await assertFails(getDoc(editRef(asUser('reviewer'))));
    await assertFails(getDoc(editRef(asUser('viewer'))));
    await assertFails(getDoc(editRef(anonymous())));
    await assertFails(deleteDoc(editRef(asUser('editor'))));
    await assertFails(deleteDoc(editRef(asUser('admin'))));
  });
  it('authors list only their own edits', async () => {
    await seedEdit('editor');
    await assertSucceeds(getDocs(query(collection(asUser('editor'), 'edits'), where('author.uid', '==', 'editor'))));
    await assertFails(getDocs(collection(asUser('editor'), 'edits')));
  });
  it('the author can withdraw an open edit, changing nothing else', async () => {
    await seedEdit('editor');
    const db = asUser('editor');
    const current = (await getDoc(editRef(db))).data();
    await assertFails(setDoc(editRef(db), { ...current, status: 'withdrawn', revised_at: serverTimestamp(), reason: 'changed' }));
    await assertSucceeds(setDoc(editRef(db), { ...current, status: 'withdrawn', revised_at: serverTimestamp() }));
  });
  it('the author can revise an open or rejected edit into the next revision', async () => {
    for (const status of ['submitted', 'ready', 'conflict', 'rejected', 'auto_rejected']) {
      await seedEdit('editor', { status });
      const db = asUser('editor');
      const current = (await getDoc(editRef(db))).data();
      const revised = { ...current, status: 'submitted', revision: 2, revised_at: serverTimestamp(), content_sha256: 'c'.repeat(64),
        changes: { enhanced_description: { before: 'June 13', after: 'June 19, 1936' } } };
      await assertFails(setDoc(editRef(db), { ...revised, revision: 3 }));
      await assertFails(setDoc(editRef(db), { ...revised, author: { uid: 'editor', email: 'x@y.test' } }));
      await assertFails(setDoc(editRef(db), { ...revised, event_id: 'evt_0a1b2c3d-0000-4000-8000-0000000000bb' }));
      await assertSucceeds(setDoc(editRef(db), revised), status);
    }
  });
  it('a revision drops the automatic checks of the previous one', async () => {
    await seedEdit('editor', { status: 'ready', checks: { browser: [], automatic: { revision: 1, results: [] } } });
    const db = asUser('editor');
    const current = (await getDoc(editRef(db))).data();
    const revised = { ...current, status: 'submitted', revision: 2, revised_at: serverTimestamp() };
    await assertFails(setDoc(editRef(db), revised));
    await assertSucceeds(setDoc(editRef(db), { ...revised, checks: { browser: [] } }));
  });
  it('nobody else can revise or withdraw it, and a published or withdrawn edit is final', async () => {
    await seedEdit('editor');
    const current = (await getDoc(editRef(asUser('editor')))).data();
    await assertFails(setDoc(editRef(asUser('reviewer')), { ...current, status: 'withdrawn', revised_at: serverTimestamp() }));
    for (const status of ['withdrawn', 'published', 'merged']) {
      await seedEdit('editor', { status });
      const db = asUser('editor');
      const final = (await getDoc(editRef(db))).data();
      await assertFails(setDoc(editRef(db), { ...final, status: 'submitted', revision: 2, revised_at: serverTimestamp() }), status);
    }
  });

  const NEW_EVT = 'evt_0a1b2c3d-0000-4000-8000-0000000000cc';
  const newEventDoc = (uid, changes = {}) => editDoc(uid, EDIT, {
    kind: 'create', event_id: NEW_EVT, event_name: 'Founding of Example Town',
    changes: {
      name: { before: null, after: 'Founding of Example Town' },
      enhanced_time: { before: null, after: 'May 1, 1820' },
      enhanced_description: { before: null, after: 'The town is incorporated.' },
      ...changes,
    },
  });
  it('editors can suggest a new event with a name, a date and a description', async () => {
    const db = asUser('editor');
    await assertSucceeds(setDoc(editRef(db), newEventDoc('editor', {
      figures: { before: null, after: [{ name: 'Ann Lee' }] }, categories: { before: null, after: ['politics'] },
    })));
    await assertFails(setDoc(editRef(asUser('viewer')), newEventDoc('viewer')));
  });
  it('a new event needs every required field, replaces nothing, and is only create or update', async () => {
    const db = asUser('editor');
    const { enhanced_description: _, ...withoutDescription } = newEventDoc('editor').changes;
    await assertFails(setDoc(editRef(db), { ...newEventDoc('editor'), changes: withoutDescription }));
    await assertFails(setDoc(editRef(db), newEventDoc('editor', { name: { before: null, after: '' } })));
    await assertFails(setDoc(editRef(db), newEventDoc('editor', { name: { before: 'Old name', after: 'Founding of Example Town' } })));
    await assertFails(setDoc(editRef(db), newEventDoc('editor', { figures: { before: ['Someone'], after: [] } })));
    await assertFails(setDoc(editRef(db), newEventDoc('editor', { location: { before: null, after: 'X' } })));
    await assertFails(setDoc(editRef(db), editDoc('editor', EDIT, { kind: 'delete' })));
  });
  it('a revision of a new event keeps its kind, its ID and its required fields', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(editRef(ctx.firestore()), { ...newEventDoc('editor'), created_at: Timestamp.now(), revised_at: Timestamp.now() });
    });
    const db = asUser('editor');
    const current = (await getDoc(editRef(db))).data();
    const revised = { ...current, status: 'submitted', revision: 2, revised_at: serverTimestamp(), content_sha256: 'c'.repeat(64),
      event_name: 'Founding of Example City',
      changes: { ...current.changes, name: { before: null, after: 'Founding of Example City' } } };
    await assertFails(setDoc(editRef(db), { ...revised, kind: 'update' }));
    await assertFails(setDoc(editRef(db), { ...revised, event_id: WORLD_EVT }));
    await assertFails(setDoc(editRef(db), { ...revised, changes: { name: revised.changes.name } }));
    await assertSucceeds(setDoc(editRef(db), revised));
  });

  // Admin review (history-dp docs/site/WORLD-EDITS.md, Admin review page): a decision names the revision it judged and
  // is signed by the admin; an approval publishes to the overlay in the same write.
  const overlayRef = (db) => doc(db, 'world_overlay', 'current');
  const review = (uid, extra = {}) => ({
    by: { uid, email: email(uid), role: 'admin' }, revision: 1, content_sha256: 'b'.repeat(64),
    decision: 'approved', fields: ['enhanced_description'], note: '', self_approved: false, at: serverTimestamp(), ...extra,
  });
  const overlay = (version, extra = {}) => ({
    version, created: {}, updated_at: serverTimestamp(),
    patches: { [WORLD_EVT]: { enhanced_description: { base: 'June 13', prior_bases: [], value: 'June 19',
      chain: [{ edit_id: EDIT, revision: 1, before: 'June 13', after: 'June 19', approved_at: '2026-10-31T12:00:00Z' }] } } },
    ...extra,
  });
  const approval = (uid, extra = {}) => ({
    status: 'published', review: review(uid), reviews: [],
    fields: { enhanced_description: { status: 'approved', receipt: { by: { uid, email: email(uid), role: 'admin' }, revision: 1,
      content_sha256: 'b'.repeat(64), value: 'June 19', at: serverTimestamp() } } },
    published: { overlay_version: 1, at: serverTimestamp() }, ...extra,
  });
  const approve = (db, uid, { edit = {}, publish = overlay(1) } = {}) => {
    const batch = writeBatch(db);
    if (publish) batch.set(overlayRef(db), publish);
    batch.update(editRef(db), approval(uid, edit));
    return batch.commit();
  };

  it('an admin approves an open edit and publishes it to the overlay in the same write', async () => {
    await seedEdit('editor');
    await assertSucceeds(approve(asUser('admin'), 'admin'));
    const stored = (await getDoc(editRef(asUser('admin')))).data();
    if (stored.status !== 'published') throw new Error('not published');
  });
  it('an approval without its overlay write, or with another overlay version, is refused', async () => {
    await seedEdit('editor');
    await assertFails(approve(asUser('admin'), 'admin', { publish: null }));
    await assertFails(approve(asUser('admin'), 'admin', { publish: overlay(2) }));
  });
  it('an approval naming the existing overlay version without raising it is refused', async () => {
    await seedEdit('editor');
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(overlayRef(ctx.firestore()), overlay(3)); });
    const db = asUser('admin');
    await assertFails(approve(db, 'admin', { edit: { published: { overlay_version: 3, at: serverTimestamp() } }, publish: null }));
    await assertSucceeds(approve(db, 'admin', { edit: { published: { overlay_version: 4, at: serverTimestamp() } }, publish: overlay(4) }));
  });
  it('a decision must be signed by the admin, on the current revision, with the server time', async () => {
    await seedEdit('editor');
    const db = asUser('admin');
    await assertFails(approve(db, 'admin', { edit: { review: review('admin', { by: { uid: 'editor', email: email('editor'), role: 'admin' } }) } }));
    await assertFails(approve(db, 'admin', { edit: { review: review('admin', { revision: 2 }) } }));
    await assertFails(approve(db, 'admin', { edit: { review: review('admin', { content_sha256: 'c'.repeat(64) }) } }));
    await assertFails(approve(db, 'admin', { edit: { review: review('admin', { at: Timestamp.fromMillis(0) }) } }));
  });
  it('an admin approving their own edit records it as self-approved', async () => {
    await seedEdit('admin');
    const db = asUser('admin');
    await assertFails(approve(db, 'admin'));
    await assertSucceeds(approve(db, 'admin', { edit: { review: review('admin', { self_approved: true }) } }));
  });
  it('an admin rejects an open edit with a note, and the author can then revise it', async () => {
    await seedEdit('editor');
    await assertSucceeds(updateDoc(editRef(asUser('admin')), {
      status: 'rejected', review: review('admin', { decision: 'rejected', fields: [], note: 'Needs a source.' }), reviews: [],
      fields: { enhanced_description: { status: 'rejected' } },
    }));
    const db = asUser('editor');
    const current = (await getDoc(editRef(db))).data();
    await assertSucceeds(setDoc(editRef(db), { ...current, status: 'submitted', revision: 2, revised_at: serverTimestamp(),
      content_sha256: 'c'.repeat(64) }));
    await assertFails(updateDoc(editRef(db), { review: review('editor') }));
  });
  it('only admins decide, and a decided edit is not decided again', async () => {
    await seedEdit('editor');
    for (const uid of ['editor', 'reviewer']) await assertFails(approve(asUser(uid), uid));
    await seedEdit('editor', { status: 'published' });
    await assertFails(approve(asUser('admin'), 'admin'));
  });
  it('everyone reads the overlay; only admins write it, one version at a time, with no other fields', async () => {
    await assertSucceeds(getDoc(overlayRef(anonymous())));
    await assertFails(setDoc(overlayRef(asUser('editor')), overlay(1)));
    await assertFails(setDoc(overlayRef(asUser('admin')), overlay(2)));
    await assertFails(setDoc(overlayRef(asUser('admin')), overlay(1, { approvers: ['admin'] })));
    await assertSucceeds(setDoc(overlayRef(asUser('admin')), overlay(1)));
    await assertFails(setDoc(overlayRef(asUser('admin')), overlay(1)));
    await assertSucceeds(setDoc(overlayRef(asUser('admin')), overlay(2)));
    await assertFails(deleteDoc(overlayRef(asUser('admin'))));
    await assertFails(setDoc(doc(asUser('admin'), 'world_overlay', 'other'), overlay(1)));
  });
});

describe('quick flags on world events', () => {
  const FLAG = 'edt_0a1b2c3d-0000-4000-8000-0000000000f1';
  const WORLD_EVT = 'evt_0a1b2c3d-0000-4000-8000-0000000000aa';
  const email = (uid) => `${uid}@example.test`;
  const asUser = (uid) => env.authenticatedContext(uid, { email: email(uid) }).firestore();
  const flagDoc = (uid, extra = {}) => ({
    edit_id: FLAG, kind: 'flag', event_id: WORLD_EVT, event_name: 'Max Schmeling knocks out Joe Louis',
    dataset: { id: 'world-history', sha256: 'a'.repeat(64), locations_release_sha256: null },
    flag: { parts: ['article'], seen: { article: 'https://en.wikipedia.org/wiki/Joe_Louis' }, note: '' },
    author: { uid, email: email(uid) }, created_at: serverTimestamp(), revised_at: serverTimestamp(),
    revision: 1, status: 'open', ...extra,
  });
  const flagRef = (db) => doc(db, 'edits', FLAG);
  const seedFlag = (uid, extra = {}) => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(flagRef(ctx.firestore()), { ...flagDoc(uid), created_at: Timestamp.now(), revised_at: Timestamp.now(), ...extra });
  });
  const close = (uid, decision, extra = {}) => ({
    status: decision, review: { by: { uid, email: email(uid), role: 'admin' }, decision, note: '', at: serverTimestamp(), ...extra },
  });

  it('editors, reviewers and admins can flag; viewers and strangers cannot', async () => {
    for (const role of ['editor', 'reviewer', 'admin']) {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users', role), { role }));
      await assertSucceeds(setDoc(flagRef(asUser(role)), flagDoc(role)));
    }
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users', 'viewer'), { role: 'viewer' }));
    await assertFails(setDoc(flagRef(asUser('viewer')), flagDoc('viewer')));
    await assertFails(setDoc(flagRef(asUser('stranger')), flagDoc('stranger')));
  });

  it('a flag names known parts, keeps its note short, changes no field and starts open', async () => {
    const db = asUser('editor');
    await assertFails(setDoc(flagRef(db), flagDoc('editor', { flag: { parts: [], seen: {}, note: '' } })));
    await assertFails(setDoc(flagRef(db), flagDoc('editor', { flag: { parts: ['category'], seen: {}, note: '' } })));
    await assertFails(setDoc(flagRef(db), flagDoc('editor', { flag: { parts: ['date'], seen: {}, note: 'x'.repeat(281) } })));
    await assertFails(setDoc(flagRef(db), flagDoc('editor', { changes: { name: { before: 'a', after: 'b' } } })));
    await assertFails(setDoc(flagRef(db), flagDoc('editor', { status: 'fixed' })));
    await assertFails(setDoc(flagRef(db), flagDoc('editor', { author: { uid: 'reviewer', email: email('reviewer') } })));
    await assertSucceeds(setDoc(flagRef(db), flagDoc('editor', {
      flag: { parts: ['image', 'location', 'entities', 'article', 'date', 'description'], seen: {}, note: 'x'.repeat(280) } })));
  });

  it('the author can take back an open flag; nobody else can, and it cannot reopen', async () => {
    await seedFlag('editor');
    await assertFails(updateDoc(flagRef(asUser('reviewer')), { status: 'withdrawn', revised_at: serverTimestamp() }));
    await assertFails(updateDoc(flagRef(asUser('editor')), { status: 'withdrawn', revised_at: serverTimestamp(), 'flag.note': 'changed' }));
    await assertSucceeds(updateDoc(flagRef(asUser('editor')), { status: 'withdrawn', revised_at: serverTimestamp() }));
    await assertFails(updateDoc(flagRef(asUser('editor')), { status: 'open', revised_at: serverTimestamp() }));
  });

  it('an admin closes an open flag as fixed or dismissed, signed with their own account and the server time', async () => {
    await seedFlag('editor');
    await assertFails(updateDoc(flagRef(asUser('editor')), close('editor', 'fixed')));
    await assertFails(updateDoc(flagRef(asUser('admin')), close('reviewer', 'fixed')));
    await assertFails(updateDoc(flagRef(asUser('admin')), close('admin', 'published')));
    await assertFails(updateDoc(flagRef(asUser('admin')), close('admin', 'fixed', { at: Timestamp.fromMillis(0) })));
    await assertSucceeds(updateDoc(flagRef(asUser('admin')), close('admin', 'fixed')));
    await assertFails(updateDoc(flagRef(asUser('admin')), close('admin', 'dismissed')));
  });

  it('only the author and admins read it', async () => {
    await seedFlag('editor');
    await assertSucceeds(getDoc(flagRef(asUser('editor'))));
    await assertSucceeds(getDoc(flagRef(asUser('admin'))));
    await assertFails(getDoc(flagRef(asUser('reviewer'))));
  });
});

describe('the live release (world_release/current)', () => {
  const releaseRef = (db) => doc(db, 'world_release', 'current');
  const sha = (c) => c.repeat(64);
  const release = (version, manifest, previous, extra = {}) => ({
    version, manifest_sha256: manifest, release_id: 'release-' + version, previous_manifest_sha256: previous,
    updated_at: serverTimestamp(), ...extra,
  });

  it('everyone reads it, and only an admin names a release', async () => {
    await assertSucceeds(getDoc(releaseRef(anonymous())));
    for (const uid of ['viewer', 'editor', 'reviewer']) await assertFails(setDoc(releaseRef(as(uid)), release(1, sha('a'), null)));
    await assertFails(setDoc(releaseRef(anonymous()), release(1, sha('a'), null)));
    await assertSucceeds(setDoc(releaseRef(as('admin')), release(1, sha('a'), null)));
  });
  it('each move is one version higher and names the release it replaces', async () => {
    const db = as('admin');
    await assertSucceeds(setDoc(releaseRef(db), release(1, sha('a'), null)));
    await assertFails(setDoc(releaseRef(db), release(1, sha('b'), sha('a'))));
    await assertFails(setDoc(releaseRef(db), release(3, sha('b'), sha('a'))));
    await assertFails(setDoc(releaseRef(db), release(2, sha('b'), null)));
    await assertFails(setDoc(releaseRef(db), release(2, sha('b'), sha('c'))));
    await assertSucceeds(setDoc(releaseRef(db), release(2, sha('b'), sha('a'))));
    // rolling back is a move to an earlier manifest, still one version higher
    await assertSucceeds(setDoc(releaseRef(db), release(3, sha('a'), sha('b'))));
  });
  it('it holds a manifest hash, a release name and the server time, and nothing else', async () => {
    const db = as('admin');
    await assertFails(setDoc(releaseRef(db), release(1, 'not-a-hash', null)));
    await assertFails(setDoc(releaseRef(db), release(1, sha('A'), null)));
    await assertFails(setDoc(releaseRef(db), release(1, sha('a'), null, { release_id: 7 })));
    await assertFails(setDoc(releaseRef(db), release(1, sha('a'), null, { updated_at: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(releaseRef(db), release(1, sha('a'), null, { promoted_by: 'admin' })));
  });
  it('it is never deleted, and there is no other release document', async () => {
    const db = as('admin');
    await assertSucceeds(setDoc(releaseRef(db), release(1, sha('a'), null)));
    await assertFails(deleteDoc(releaseRef(db)));
    await assertFails(setDoc(doc(db, 'world_release', 'next'), release(1, sha('a'), null)));
    await assertFails(getDoc(doc(anonymous(), 'world_release', 'next')));
  });
});
