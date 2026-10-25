import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PhotoField } from '../../modules/modal-manager.js';

const created = [];
const revoked = [];
URL.createObjectURL = (blob) => { const url = `blob:${blob.label}`; created.push(url); return url; };
URL.revokeObjectURL = (url) => { revoked.push(url); };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const node = (extra = {}) => ({
  hidden: true, value: '', dataset: {}, files: [], classList: { toggle() {} },
  addEventListener() {}, removeAttribute(name) { delete this[name]; }, ...extra,
});

// A PhotoField over DOM doubles, whose resizes wait until the test resolves them in any order.
function field() {
  const img = node();
  const preview = node({ querySelector: () => img });
  const parts = { 'input[type="file"]': node(), '.photo-preview': preview, '.photo-remove': node() };
  const root = node({ querySelector: (selector) => parts[selector] });
  const resizes = [];
  const errors = [];
  const photo = new PhotoField(root, {
    images: () => ({ url: () => null }),
    onError: (message) => errors.push(message),
    resize: () => { const resize = deferred(); resizes.push(resize); return resize.promise; },
  });
  return { photo, resizes, errors, img };
}
const resized = (label) => ({ full: { label: `${label}-full` }, thumb: { label }, width: 10, height: 8, mime: 'image/webp' });
const flush = () => new Promise(setImmediate);

describe('PhotoField — a slow resize never lands where it no longer belongs', () => {
  it('a resize finishing after the form was reset (reopened or discarded) is ignored', async () => {
    const { photo, resizes, img } = field();
    photo.reset(true);
    photo.choose({ name: 'old.jpg' });
    photo.reset(true);
    resizes[0].resolve(resized('reset-old'));
    await flush();
    assert.deepEqual(await photo.settled(), { action: 'keep' });
    assert.equal(img.src, undefined);
    assert.equal(created.includes('blob:reset-old'), false);
  });

  it('a newer choice wins over an older one that finishes later', async () => {
    const { photo, resizes } = field();
    photo.reset(true);
    photo.choose({ name: 'first.jpg' });
    photo.choose({ name: 'second.jpg' });
    resizes[1].resolve(resized('newer'));
    await flush();
    resizes[0].resolve(resized('older'));
    await flush();
    const choice = await photo.settled();
    assert.equal(choice.action, 'add');
    assert.equal(choice.resized.thumb.label, 'newer');
  });

  it('a resize finishing after Remove does not undo the removal', async () => {
    const { photo, resizes } = field();
    photo.reset(true);
    photo.choose({ name: 'photo.jpg' });
    photo.remove();
    resizes[0].resolve(resized('after-remove'));
    await flush();
    assert.deepEqual(await photo.settled(), { action: 'remove' });
  });

  it('an error from a superseded resize is not shown', async () => {
    const { photo, resizes, errors } = field();
    photo.reset(true);
    photo.choose({ name: 'broken.jpg' });
    photo.reset(true);
    resizes[0].reject(new Error('could not be read'));
    await flush();
    assert.deepEqual(errors, []);
  });

  it('settled() waits for the latest choice, even one made while it was waiting', async () => {
    const { photo, resizes } = field();
    photo.reset(true);
    photo.choose({ name: 'first.jpg' });
    const settling = photo.settled();
    photo.choose({ name: 'second.jpg' });
    resizes[0].resolve(resized('first-wait'));
    await flush();
    resizes[1].resolve(resized('second-wait'));
    const choice = await settling;
    assert.equal(choice.resized.thumb.label, 'second-wait');
  });

  it('the current choice applies normally and its preview is revoked when the form resets', async () => {
    const { photo, resizes, img } = field();
    photo.reset(true);
    photo.choose({ name: 'photo.jpg' });
    resizes[0].resolve(resized('current'));
    await flush();
    assert.equal((await photo.settled()).action, 'add');
    assert.equal(img.src, 'blob:current');
    photo.reset(false);
    assert.ok(revoked.includes('blob:current'));
  });
});
