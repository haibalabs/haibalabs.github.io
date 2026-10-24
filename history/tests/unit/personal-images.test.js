import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PersonalImages } from '../../modules/personal-images.js';

// Records revoked object URLs.
const revoked = [];
URL.revokeObjectURL = (url) => { revoked.push(url); };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A loader over a store whose loads wait until released, with a guard the test can move on.
function harness() {
  const state = { session: 1, selection: 1, generation: '100_1' };
  const loads = new Map();
  const store = {
    load(ref) {
      const load = deferred();
      loads.set(ref, [...(loads.get(ref) ?? []), load]);
      return load.promise;
    },
  };
  const images = new PersonalImages(store, {
    token: () => ({ session: state.session, selection: state.selection }),
    isCurrent: (token) => token.session === state.session && token.selection === state.selection,
    generation: () => state.generation,
  });
  const ready = [];
  images.onReady = (ref, url) => ready.push([ref, url]);
  const settle = async (ref, url, index = 0) => {
    loads.get(ref)[index].resolve(url);
    await new Promise(setImmediate);
  };
  return { state, loads, images, ready, settle };
}

describe('PersonalImages — loading and caching photos', () => {
  it('starts one load per photo, then serves it from the cache', async () => {
    const { images, loads, ready, settle } = harness();
    assert.equal(images.url('a_thumb'), null);
    assert.equal(images.url('a_thumb'), null);
    assert.equal(loads.get('a_thumb').length, 1);
    await settle('a_thumb', 'blob:a');
    assert.deepEqual(ready, [['a_thumb', 'blob:a']]);
    assert.equal(images.url('a_thumb'), 'blob:a');
  });

  it('loads nothing when no timeline is open', () => {
    const { images, loads, state } = harness();
    state.generation = null;
    assert.equal(images.url('a_thumb'), null);
    assert.equal(loads.size, 0);
  });

  for (const [change, move] of [
    ['the timeline is closed or another is opened', (state) => { state.selection++; }],
    ['the account changes or signs out', (state) => { state.session++; }],
    ['the timeline is recreated with a new generation', (state) => { state.generation = '200_0'; }],
  ]) {
    it(`a load that lands after ${change} is discarded and its object URL revoked`, async () => {
      const { images, ready, settle, state } = harness();
      images.url('a_thumb');
      move(state);
      await settle('a_thumb', `blob:late-${change}`);
      assert.deepEqual(ready, []);
      assert.ok(revoked.includes(`blob:late-${change}`));
      assert.equal(images.urls.size, 0);
    });
  }

  it('a load in flight when the cache is cleared is discarded, and a new load after it applies', async () => {
    const { images, ready, settle } = harness();
    images.url('a_thumb');
    images.clear();
    images.url('a_thumb');
    await settle('a_thumb', 'blob:stale', 0);
    assert.ok(revoked.includes('blob:stale'));
    await settle('a_thumb', 'blob:fresh', 1);
    assert.deepEqual(ready, [['a_thumb', 'blob:fresh']]);
    assert.equal(images.url('a_thumb'), 'blob:fresh');
  });

  it('clear() revokes every cached photo', async () => {
    const { images, settle } = harness();
    images.url('a');
    images.url('b');
    await settle('a', 'blob:clear-a');
    await settle('b', 'blob:clear-b');
    images.clear();
    assert.ok(revoked.includes('blob:clear-a') && revoked.includes('blob:clear-b'));
    assert.equal(images.urls.size, 0);
  });

  it('a failed load is not retried on every render, until the cache is cleared', async () => {
    const { images, loads } = harness();
    const original = console.error;
    console.error = () => {};
    images.url('broken');
    loads.get('broken')[0].reject(new Error('denied'));
    await new Promise(setImmediate);
    console.error = original;
    assert.equal(images.url('broken'), null);
    assert.equal(loads.get('broken').length, 1);
    images.clear();
    images.url('broken');
    assert.equal(loads.get('broken').length, 2);
  });

  it('forget() drops and revokes one photo after it is replaced', async () => {
    const { images, settle } = harness();
    images.url('old');
    await settle('old', 'blob:old');
    images.forget('old');
    assert.ok(revoked.includes('blob:old'));
    assert.equal(images.urls.size, 0);
  });
});
