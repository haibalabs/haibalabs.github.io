// Storage rules tests for personal timeline photos. Run through the emulators: npm run test:rules
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc, Timestamp } from 'firebase/firestore';
import { deleteObject, getMetadata, listAll, ref, updateMetadata, uploadBytes } from 'firebase/storage';

const FIRESTORE_RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const STORAGE_RULES = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-historiline',
    firestore: { rules: FIRESTORE_RULES, host: '127.0.0.1', port: 8085 },
    storage: { rules: STORAGE_RULES, host: '127.0.0.1', port: 9199 },
  });
});

after(async () => {
  await env.cleanup();
});

// t1 is owned by the editor, with the reviewer as a member. 123,456,000 ns is 123.456 ms, so
// SAME_MILLISECOND differs in nanoseconds but has the same toMillis().
const CREATED = new Timestamp(1_700_000_000, 123_456_000);
const GENERATION = '1700000000_123456000';
const SAME_MILLISECOND = '1700000000_123456999';
const EVT = 'evt_00000000-0000-4000-8000-00000000000a';
const PHOTO = 'img_0a0b0c0d-0000-4000-8000-000000000001';

// env.clearStorage() deletes only top-level files; photos live in nested folders.
async function clearAllFiles() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const clear = async (folder) => {
      const { items, prefixes } = await listAll(folder);
      await Promise.all([...items.map(item => deleteObject(item)), ...prefixes.map(clear)]);
    };
    await clear(ref(ctx.storage()));
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await clearAllFiles();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const role of ['viewer', 'editor', 'reviewer', 'admin']) await setDoc(doc(db, 'users', role), { role });
    await setDoc(doc(db, 'timelines', 't1'), {
      owner: 'editor', title: 'Family', visibility: 'private', members: ['reviewer'], createdAt: CREATED, updatedAt: CREATED,
    });
  });
});

const storageAs = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const path = ({ generation = GENERATION, event = EVT, file = `${PHOTO}.webp` } = {}) =>
  `timelines/t1/${generation}/events/${event}/${file}`;
const bytes = (size) => new Uint8Array(size);
const put = (uid, where = {}, { size = 1000, contentType = 'image/webp' } = {}) =>
  uploadBytes(ref(storageAs(uid), path(where)), bytes(size), { contentType });
// Writes a file bypassing the rules, as an earlier upload would have.
async function seedFile(where = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), path(where)), bytes(1000), { contentType: 'image/webp' });
  });
}

describe('personal photos: who can upload, read and delete', () => {
  it('the owner and members can upload a photo and its thumbnail, read them and delete them', async () => {
    await assertSucceeds(put('editor'));
    await assertSucceeds(put('reviewer', { file: `${PHOTO}_thumb.webp` }, { size: 50_000 }));
    await assertSucceeds(getMetadata(ref(storageAs('reviewer'), path())));
    await assertSucceeds(getMetadata(ref(storageAs('editor'), path({ file: `${PHOTO}_thumb.webp` }))));
    await assertSucceeds(deleteObject(ref(storageAs('reviewer'), path())));
  });
  it('other accounts, admins included, accounts without a role and anonymous visitors cannot', async () => {
    await seedFile();
    for (const uid of ['admin', 'viewer', 'stranger', null]) {
      await assertFails(put(uid, { file: 'img_0a0b0c0d-0000-4000-8000-000000000002.webp' }));
      await assertFails(getMetadata(ref(storageAs(uid), path())));
      await assertFails(deleteObject(ref(storageAs(uid), path())));
    }
  });
  it('a member removed from the timeline loses access', async () => {
    await seedFile();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timelines', 't1'), {
        owner: 'editor', title: 'Family', visibility: 'private', members: [], createdAt: CREATED, updatedAt: CREATED,
      });
    });
    await assertFails(getMetadata(ref(storageAs('reviewer'), path())));
  });
});

describe('personal photos: the timeline generation', () => {
  it('a path must carry the timeline\'s current generation, to the nanosecond', async () => {
    await seedFile({ generation: SAME_MILLISECOND });
    await assertFails(put('editor', { generation: SAME_MILLISECOND, file: 'img_0a0b0c0d-0000-4000-8000-000000000003.webp' }));
    await assertFails(getMetadata(ref(storageAs('editor'), path({ generation: SAME_MILLISECOND }))));
    await assertFails(put('editor', { generation: '1700000000123' }));
  });
  it('files of a deleted timeline stay unreachable when the ID is reused, even by the same owner', async () => {
    await seedFile();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await deleteDoc(doc(db, 'timelines', 't1'));
      const recreated = new Timestamp(1_700_000_500, 0);
      await setDoc(doc(db, 'timelines', 't1'), {
        owner: 'editor', title: 'Again', visibility: 'private', members: [], createdAt: recreated, updatedAt: recreated,
      });
    });
    await assertFails(getMetadata(ref(storageAs('editor'), path())));
    await assertFails(deleteObject(ref(storageAs('editor'), path())));
    await assertSucceeds(put('editor', { generation: '1700000500_0' }));
  });
  it('files of a deleted timeline are unreachable while it does not exist', async () => {
    await seedFile();
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'timelines', 't1')); });
    await assertFails(getMetadata(ref(storageAs('editor'), path())));
  });
});

describe('personal photos: what can be uploaded', () => {
  it('names must be img_<uuid>.webp or .jpg, or their _thumb versions, under a valid event ID', async () => {
    await assertSucceeds(put('editor', { file: `${PHOTO}.jpg` }, { contentType: 'image/jpeg' }));
    await assertFails(put('editor', { file: 'photo.webp' }));
    await assertFails(put('editor', { file: `${PHOTO}.png` }, { contentType: 'image/png' }));
    await assertFails(put('editor', { file: `${PHOTO}_original.webp` }));
    await assertFails(put('editor', { event: 'evt_b' }));
  });
  it('only WebP and JPEG content is accepted', async () => {
    await assertFails(put('editor', {}, { contentType: 'image/png' }));
    await assertFails(put('editor', {}, { contentType: 'text/html' }));
  });
  it('photos are at most 2 MB and thumbnails at most 200 KB', async () => {
    await assertSucceeds(put('editor', {}, { size: 2 * 1024 * 1024 }));
    await assertFails(put('editor', { file: 'img_0a0b0c0d-0000-4000-8000-000000000004.webp' }, { size: 2 * 1024 * 1024 + 1 }));
    await assertSucceeds(put('editor', { file: `${PHOTO}_thumb.webp` }, { size: 200 * 1024 }));
    await assertFails(put('editor', { file: 'img_0a0b0c0d-0000-4000-8000-000000000004_thumb.webp' }, { size: 200 * 1024 + 1 }));
  });
  it('stored files cannot be overwritten or have their metadata changed', async () => {
    await seedFile();
    await assertFails(put('editor'));
    await assertFails(updateMetadata(ref(storageAs('editor'), path()), { contentType: 'image/jpeg' }));
  });
  it('nothing outside timeline photo paths can be read or written', async () => {
    await assertFails(uploadBytes(ref(storageAs('admin'), 'notes/a.webp'), bytes(10), { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(storageAs('editor'), `timelines/t1/${GENERATION}/${PHOTO}.webp`), bytes(10), { contentType: 'image/webp' }));
  });
});
