// Firestore rules tests. Run through the emulator: npm run test:rules
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';

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

describe('anonymous visitors', () => {
  it('cannot read events', () => assertFails(getDoc(doc(anonymous(), 'events_main', 'evt_1'))));
  it('cannot list events', () => assertFails(getDocs(collection(anonymous(), 'events_main'))));
  it('cannot write events', () => assertFails(setDoc(doc(anonymous(), 'events_main', 'evt_2'), event('nobody'))));
  it('cannot read roles', () => assertFails(getDoc(doc(anonymous(), 'users', 'admin'))));
});

describe('signed-in accounts without a role', () => {
  it('cannot read events', () => assertFails(getDoc(doc(as('stranger'), 'events_main', 'evt_1'))));
  it('cannot write events', () => assertFails(setDoc(doc(as('stranger'), 'events_main', 'evt_2'), event('stranger'))));
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
  it('cannot write events', () => assertFails(setDoc(doc(as('viewer'), 'events_main', 'evt_2'), event('viewer'))));
});

for (const role of [ROLES.editor, ROLES.reviewer]) {
  describe(`${role}s`, () => {
    it('can create and update events attributed to themselves', async () => {
      await assertSucceeds(setDoc(doc(as(role), 'events_main', 'evt_2'), event(role)));
      await assertSucceeds(setDoc(doc(as(role), 'events_main', 'evt_1'), event(role, { name: 'Renamed' })));
    });
    it('cannot attribute a write to another account', () =>
      assertFails(setDoc(doc(as(role), 'events_main', 'evt_2'), event('admin'))));
    it('cannot set their own timestamp', () =>
      assertFails(setDoc(doc(as(role), 'events_main', 'evt_2'), event(role, { lastModified: Timestamp.fromMillis(0) }))));
    it('cannot write an event without a name', () =>
      assertFails(setDoc(doc(as(role), 'events_main', 'evt_2'), event(role, { name: 42 }))));
    it('cannot delete events', () => assertFails(deleteDoc(doc(as(role), 'events_main', 'evt_1'))));
    it('cannot change their own role', () => assertFails(setDoc(doc(as(role), 'users', role), { role: 'admin' })));
    it('cannot grant roles to others', () => assertFails(setDoc(doc(as(role), 'users', 'stranger'), { role: 'editor' })));
    it('cannot write outside event collections', () => assertFails(setDoc(doc(as(role), 'other', 'y'), event(role))));
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
    assertFails(setDoc(doc(as('admin'), 'events_', 'e'), event('admin'))));
});

// Personal timelines. Accounts come from the seeded users: viewer, editor, reviewer, admin.
const timeline = (owner, extra = {}) => ({
  owner, title: 'Family history', visibility: 'private', members: [],
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});
const timelineEvent = (uid, id, extra = {}) => ({
  event_id: id, name: 'Grandmother born', enhanced_time: '1931', userId: uid, lastModified: serverTimestamp(), ...extra,
});
const tl = (db, id = 't1') => doc(db, 'timelines', id);
const tlEvent = (db, id, timelineId = 't1') => doc(db, 'timelines', timelineId, 'events', id);

// Seeds timeline t1 owned by `owner`, with one event, bypassing the rules.
async function seedTimeline(owner, members = []) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(tl(db), { owner, title: 'Family history', visibility: 'private', members, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await setDoc(tlEvent(db, 'evt_a'), { event_id: 'evt_a', name: 'Seeded', enhanced_time: '1900', userId: owner, lastModified: Timestamp.now() });
  });
}

describe('personal timelines: creating', () => {
  it('any invited account can create a timeline it owns', async () => {
    await assertSucceeds(setDoc(tl(as('viewer')), timeline('viewer')));
    await assertSucceeds(setDoc(tl(as('editor'), 't2'), timeline('editor')));
  });
  it('accounts without a role and anonymous visitors cannot create one', async () => {
    await assertFails(setDoc(tl(as('stranger')), timeline('stranger')));
    await assertFails(setDoc(tl(anonymous()), timeline('nobody')));
  });
  it('a timeline cannot be created for another owner', () =>
    assertFails(setDoc(tl(as('viewer')), timeline('editor'))));
  it('only private visibility is allowed', () =>
    assertFails(setDoc(tl(as('viewer')), timeline('viewer', { visibility: 'public' }))));
  it('the title must be 1 to 120 characters', async () => {
    await assertFails(setDoc(tl(as('viewer')), timeline('viewer', { title: '' })));
    await assertFails(setDoc(tl(as('viewer')), timeline('viewer', { title: 'x'.repeat(121) })));
  });
  it('unknown fields, client timestamps and the owner as a member are rejected', async () => {
    await assertFails(setDoc(tl(as('viewer')), timeline('viewer', { color: 'red' })));
    await assertFails(setDoc(tl(as('viewer')), timeline('viewer', { createdAt: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(tl(as('viewer')), timeline('viewer', { members: ['viewer'] })));
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
    await assertSucceeds(setDoc(tlEvent(as('viewer'), 'evt_b'), timelineEvent('viewer', 'evt_b')));
    await assertSucceeds(setDoc(tlEvent(as('reviewer'), 'evt_c'), timelineEvent('reviewer', 'evt_c')));
    await assertSucceeds(setDoc(tlEvent(as('reviewer'), 'evt_a'), timelineEvent('reviewer', 'evt_a', { name: 'Edited' })));
    await assertSucceeds(getDocs(collection(as('viewer'), 'timelines', 't1', 'events')));
    await assertSucceeds(deleteDoc(tlEvent(as('viewer'), 'evt_a')));
  });
  it('other accounts cannot read or write its events', async () => {
    await assertFails(getDoc(tlEvent(as('editor'), 'evt_a')));
    await assertFails(getDocs(collection(as('admin'), 'timelines', 't1', 'events')));
    await assertFails(setDoc(tlEvent(as('editor'), 'evt_b'), timelineEvent('editor', 'evt_b')));
    await assertFails(getDoc(tlEvent(anonymous(), 'evt_a')));
  });
  it('event writes need a matching event_id, a name, a date, the author and the server time', async () => {
    const db = as('viewer');
    await assertFails(setDoc(tlEvent(db, 'evt_b'), timelineEvent('viewer', 'evt_other')));
    await assertFails(setDoc(tlEvent(db, 'evt_b'), timelineEvent('viewer', 'evt_b', { name: '' })));
    await assertFails(setDoc(tlEvent(db, 'evt_b'), timelineEvent('viewer', 'evt_b', { enhanced_time: 1931 })));
    await assertFails(setDoc(tlEvent(db, 'evt_b'), timelineEvent('reviewer', 'evt_b')));
    await assertFails(setDoc(tlEvent(db, 'evt_b'), timelineEvent('viewer', 'evt_b', { lastModified: Timestamp.fromMillis(0) })));
  });
  it('events of a deleted timeline are no longer reachable', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(tl(ctx.firestore())); });
    await assertFails(getDoc(tlEvent(as('viewer'), 'evt_a')));
    await assertFails(setDoc(tlEvent(as('viewer'), 'evt_b'), timelineEvent('viewer', 'evt_b')));
  });
});
