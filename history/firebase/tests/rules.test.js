// Firestore rules tests. Run through the emulator: npm run test:rules
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

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
    await assertFails(setDoc(doc(as('admin'), 'timelines', 't1'), { title: 'x' }));
  });
  it('deny a collection named only "events_"', () =>
    assertFails(setDoc(doc(as('admin'), 'events_', 'e'), event('admin'))));
});
