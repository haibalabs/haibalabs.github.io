import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals for the TimelineUI methods under test; the DOM wiring in its
// constructor is skipped (see ui() below).
globalThis.location = { href: 'http://localhost/history/', search: '' };
globalThis.history = { replaceState() {} };
globalThis.confirm = () => true;
const element = () => ({
  checked: false, hidden: true, style: {}, dataset: {}, textContent: '',
  classList: { add() {}, remove() {}, toggle() {} }, removeAttribute() {}, querySelector: () => element(),
});
globalThis.document = { getElementById: element, createElement: element, querySelectorAll: () => [] };

const { TimelineUI } = await import('../../modules/timeline-ui.js');
const { ModalManager } = await import('../../modules/modal-manager.js');
const { PersonalImages } = await import('../../modules/personal-images.js');
const { MemoryImageStore } = await import('../../modules/image-store.js');
const { timelineGeneration } = await import('../../modules/timeline-model.js');

const A = { id: 'tl_A', title: 'Family', createdAt: { seconds: 100, nanoseconds: 1 } };
const B = { id: 'tl_B', title: 'Projects', createdAt: { seconds: 200, nanoseconds: 2 } };
const secret = { event_id: 'evt_00000000-0000-4000-8000-000000000001', name: 'Private note', enhanced_time: '1950' };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A TimelineUI signed in as an editor, with DOM and manager doubles that record what is shown.
function ui(store) {
  const instance = Object.create(TimelineUI.prototype);
  const shown = { personal: [], timelineId: null, toasts: [], list: null, personalFilters: false };
  Object.assign(instance, {
    store, shown, current: null, user: { uid: 'alice' }, role: 'editor', session: 1, selection: 0,
    pendingId: null, worldLoaded: true,
    section: { hidden: false }, status: element(),
    list: { replaceChildren(...items) { shown.list = items; }, append() {}, querySelectorAll: () => [] },
    pill: { hidden: true, querySelector: () => element() },
    menu: { hidden: true, querySelectorAll: () => [] },
    pillButton: { setAttribute() {} },
    addEventBtn: { style: {}, setAttribute() {} },
    addChoice: { hidden: true },
    renderListItem: (timeline) => timeline.id,
  });
  instance.uiManager = {
    showToast: (message) => shown.toasts.push(message), resetLayout() {}, scrollToEventId() {}, eventHeights: new Map(),
    setPersonalFiltersVisible(visible) { shown.personalFilters = visible; },
  };
  instance.eventManager = {
    timelineView: 'with-world',
    placeIndex: { idFor: (event) => event.event_id },
    setPersonalEvents(id, events) { shown.timelineId = id; shown.personal = [...events]; },
    clearPersonalEvents() { shown.timelineId = null; shown.personal = []; },
    upsertPersonalEvent(id, event) { shown.personal.push({ ...event, timelineId: id }); },
    removePersonalEvent(eventId) { shown.personal = shown.personal.filter(e => e.event_id !== eventId); },
    setTimelineView(view) { this.timelineView = view; },
  };
  // photos: the real loader over an in-memory adapter, guarded by this instance's tokens
  instance.imageStore = new MemoryImageStore();
  instance.images = new PersonalImages(instance.imageStore, {
    token: () => instance.token(),
    isCurrent: (token) => instance.isCurrent(token),
    generation: () => (instance.current ? timelineGeneration(instance.current.createdAt) : null),
  });
  instance.viewer = element();
  return instance;
}

// A store whose loadEvents for the given timeline waits until released.
function slowLoadStore(slowId) {
  const slow = deferred();
  const entered = deferred();
  const store = {
    get: async (id) => ({ [A.id]: A, [B.id]: B })[id] ?? null,
    loadEvents: (timeline) => {
      if (timeline.id !== slowId) return Promise.resolve([]);
      entered.resolve();
      return slow.promise;
    },
    listMine: async () => [],
  };
  return { store, slow, entered };
}

describe('TimelineUI — results that arrive after the user moved on', () => {
  it('a timeline still loading when the user signs out is never shown', async () => {
    const { store, slow, entered } = slowLoadStore(A.id);
    const view = ui(store);
    const opening = view.open(A.id);
    await entered.promise;
    await view.setAccount(null, null);
    slow.resolve([secret]);
    await opening;
    assert.equal(view.current, null);
    assert.deepEqual(view.shown.personal, []);
    assert.equal(view.pill.hidden, true);
  });

  it('a slow open of one timeline does not replace a timeline opened after it', async () => {
    const { store, slow, entered } = slowLoadStore(A.id);
    const view = ui(store);
    const openingA = view.open(A.id);
    await entered.promise;
    await view.open(B.id);
    slow.resolve([secret]);
    await openingA;
    assert.equal(view.current.id, B.id);
    assert.equal(view.shown.timelineId, B.id);
    assert.deepEqual(view.shown.personal, []);
  });

  it('closing a timeline while it loads keeps it closed', async () => {
    const { store, slow, entered } = slowLoadStore(A.id);
    const view = ui(store);
    const opening = view.open(A.id);
    await entered.promise;
    view.close();
    slow.resolve([secret]);
    await opening;
    assert.equal(view.current, null);
    assert.deepEqual(view.shown.personal, []);
  });

  it('a failed load after sign-out shows no message', async () => {
    const { store, slow, entered } = slowLoadStore(A.id);
    const view = ui(store);
    const opening = view.open(A.id);
    await entered.promise;
    await view.setAccount(null, null);
    slow.reject(new Error('offline'));
    await opening;
    assert.deepEqual(view.shown.toasts, []);
  });

  it('a save finishing after another timeline was opened is stored in its own timeline and not shown in the new one', async () => {
    const write = deferred();
    const writes = [];
    const view = ui({
      get: async (id) => (id === B.id ? B : A), loadEvents: async () => [],
      saveEvent: (timeline, event) => { writes.push({ timelineId: timeline.id, event }); return write.promise; },
    });
    await view.open(A.id);
    const saving = view.saveEvent({ ...secret }, null, view.formTarget());
    await view.open(B.id);
    write.resolve();
    assert.equal(await saving, null);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].timelineId, A.id);
    assert.equal(view.current.id, B.id);
    assert.deepEqual(view.shown.personal, []);
  });

  it('a save finishing after the timeline was closed does not throw or show the event', async () => {
    const write = deferred();
    const view = ui({ get: async () => A, loadEvents: async () => [], saveEvent: () => write.promise });
    await view.open(A.id);
    const saving = view.saveEvent({ ...secret }, null, view.formTarget());
    view.close();
    write.resolve();
    assert.equal(await saving, null);
    assert.deepEqual(view.shown.personal, []);
  });

  it('a save with no open timeline is refused instead of throwing', async () => {
    const view = ui({ saveEvent: () => assert.fail('nothing should be written') });
    assert.match(await view.saveEvent({ ...secret }, null, null), /timeline was closed/);
  });

  it('a delete finishing after the timeline was closed leaves the screen alone', async () => {
    const removal = deferred();
    const view = ui({ get: async () => A, loadEvents: async () => [secret], deleteEvent: () => removal.promise });
    let removed = 0;
    view.eventManager.removePersonalEvent = () => { removed++; };
    await view.open(A.id);
    const deleting = view.deleteEvent(secret);
    view.close();
    removal.resolve();
    await deleting;
    assert.equal(removed, 0);
  });

  it('switching straight to another account closes the previous account\'s timeline and list', async () => {
    const view = ui({ get: async () => A, loadEvents: async () => [secret], listMine: () => new Promise(() => {}) });
    await view.open(A.id);
    view.shown.list = [A.id];
    // no sign-out in between; Bob's own list is still loading
    view.setAccount({ uid: 'bob' }, 'editor');
    assert.equal(view.current, null);
    assert.deepEqual(view.shown.personal, []);
    assert.equal(view.pill.hidden, true);
    assert.deepEqual(view.shown.list, []);
    // Alice's link is not kept for Bob
    assert.equal(view.pendingId, null);
  });

  it('signing out keeps the open timeline\'s link to reopen after the next sign-in', async () => {
    const view = ui({ get: async () => A, loadEvents: async () => [secret] });
    await view.open(A.id);
    await view.setAccount(null, null);
    assert.equal(view.current, null);
    assert.equal(view.pendingId, A.id);
  });

  it('a save for a form opened before the account changed is refused without writing', async () => {
    const view = ui({ get: async () => A, loadEvents: async () => [], listMine: async () => [],
      saveEvent: () => assert.fail('nothing should be written') });
    await view.open(A.id);
    const target = view.formTarget();
    await view.setAccount(null, null);
    assert.match(await view.saveEvent({ ...secret }, secret, target), /account changed/);
  });

  it('the previous account\'s timeline list never replaces the current account\'s', async () => {
    const aliceList = deferred();
    const view = ui({ listMine: () => aliceList.promise });
    const refreshing = view.refreshList();
    view.store = { listMine: async () => [B] };
    await view.setAccount({ uid: 'bob' }, 'editor');
    aliceList.resolve([A]);
    await refreshing;
    assert.deepEqual(view.shown.list, [B.id]);
  });
});

describe('ModalManager — the event form keeps the destination it was opened for', () => {
  // FormData over the form double's values
  globalThis.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name] ?? ''; }
    getAll(name) { return this.values[name] ? [this.values[name]] : []; }
  };
  const FIELDS = ['name', 'enhanced_time', 'enhanced_description', 'wikipedia_url', 'categories', 'location_name',
    'location_city', 'location_region', 'location_country', 'location_historical'];

  function form(view) {
    const values = {};
    const elements = Object.fromEntries(FIELDS.map(name => [name, {
      get value() { return values[name] ?? ''; }, set value(v) { values[name] = v; },
    }]));
    const manager = Object.create(ModalManager.prototype);
    Object.assign(manager, {
      form: {
        values, elements, reset() { for (const key of Object.keys(values)) delete values[key]; },
        querySelector: () => element(), querySelectorAll: () => [element(), element()],
      },
      modal: { style: {}, querySelector: () => element() },
      uiManager: view.uiManager,
      eventManager: { added: [], addEvent(event) { this.added.push(event); } },
      // the photo field's choice; tests set photoChoice to simulate picking or removing a photo
      photoChoice: { action: 'keep' },
    });
    manager.photoField = { shown: false, reset(visible) { this.shown = visible; }, settled: async () => manager.photoChoice };
    // the shared location picker and image link (location-picker.js, image-field.js), empty here
    manager.locations = { set() {}, values: () => [] };
    manager.imageLink = { set() {}, input: { value: '' }, image: async () => ({ ok: true, image: null }) };
    manager.photoMode = { set() {}, dataset: { mode: 'upload' } };
    view.uiManager.timelineUI = view;
    view.uiManager.modalManager = manager;
    return manager;
  }
  const submit = (manager) => manager.handleSubmit({ preventDefault() {} });

  it('a personal editor is closed and emptied when the account signs out, and adds nothing to world events', async () => {
    const view = ui({ get: async () => A, loadEvents: async () => [secret], listMine: async () => [] });
    const manager = form(view);
    await view.open(A.id);
    manager.open(secret);
    assert.equal(manager.form.values.name, secret.name);
    await view.setAccount(null, null);
    assert.equal(manager.modal.style.display, 'none');
    assert.deepEqual(manager.form.values, {});
    await submit(manager);
    assert.deepEqual(manager.eventManager.added, []);
  });

  it('a personal editor is discarded when its timeline closes', async () => {
    const view = ui({ get: async () => A, loadEvents: async () => [secret] });
    const manager = form(view);
    await view.open(A.id);
    manager.open(secret);
    view.close();
    assert.equal(manager.modal.style.display, 'none');
    assert.equal(manager.target, null);
  });

  it('a personal save goes to the timeline the form was opened for', async () => {
    const writes = [];
    const view = ui({ get: async () => A, loadEvents: async () => [], saveEvent: async (timeline) => { writes.push(timeline.id); } });
    const manager = form(view);
    await view.open(A.id);
    manager.open();
    Object.assign(manager.form.values, { name: 'Wedding', enhanced_time: '1930', enhanced_description: 'x' });
    await submit(manager);
    assert.deepEqual(writes, [A.id]);
    assert.deepEqual(manager.eventManager.added, []);
    assert.equal(manager.modal.style.display, 'none');
  });

  it('the photo field shows only for a personal timeline, and its choice is saved with the event', async () => {
    const saved = [];
    const view = ui({ get: async () => A, loadEvents: async () => [], saveEvent: async (timeline, event) => { saved.push(event); } });
    const manager = form(view);
    manager.open();
    assert.equal(manager.photoField.shown, false);
    manager.close();
    await view.open(A.id);
    manager.open();
    assert.equal(manager.photoField.shown, true);
    manager.photoChoice = {
      action: 'add',
      resized: { full: new Blob(['f'], { type: 'image/webp' }), thumb: new Blob(['t'], { type: 'image/webp' }), width: 10, height: 8, mime: 'image/webp' },
    };
    Object.assign(manager.form.values, { name: 'Wedding', enhanced_time: '1930', enhanced_description: 'x' });
    await submit(manager);
    assert.equal(saved[0].image.width, 10);
    assert.equal(view.imageStore.files.size, 2);
  });

  it('with no timeline open, the form adds no world event and stays open', async () => {
    const view = ui({});
    const manager = form(view);
    manager.open();
    Object.assign(manager.form.values, { name: 'Treaty signed', enhanced_time: '1648', enhanced_description: 'x' });
    await submit(manager);
    assert.deepEqual(manager.eventManager.added, []);
    assert.equal(manager.modal.style.display, 'flex');
  });

  it('a new event in a personal timeline starts in the People category; world events start with none', async () => {
    const view = ui({ get: async () => A, loadEvents: async () => [] });
    const manager = form(view);
    manager.open();
    assert.equal(manager.form.values.categories, undefined);
    manager.close();
    await view.open(A.id);
    manager.open();
    assert.equal(manager.form.values.categories, 'people');
    manager.close();
    manager.open({ ...secret, categories: ['culture'] });
    assert.equal(manager.form.values.categories, 'culture');
  });
});

describe('TimelineUI — the ordinary path still applies results', () => {
  let view;
  beforeEach(() => {
    view = ui({ get: async () => A, loadEvents: async () => [secret], saveEvent: async () => {}, listMine: async () => [A] });
  });

  it('opening shows the timeline and its events', async () => {
    await view.open(A.id);
    assert.equal(view.current.id, A.id);
    assert.equal(view.shown.timelineId, A.id);
    assert.equal(view.shown.personal[0].name, secret.name);
    assert.equal(view.pill.hidden, false);
  });

  it('the People filter shows while a timeline is open and hides when it closes', async () => {
    assert.equal(view.shown.personalFilters, false);
    await view.open(A.id);
    assert.equal(view.shown.personalFilters, true);
    view.close();
    assert.equal(view.shown.personalFilters, false);
  });

  it('a save shows the event in the timeline it was saved to', async () => {
    await view.open(A.id);
    assert.equal(await view.saveEvent({ name: 'Wedding', enhanced_time: '1930' }, null, view.formTarget()), null);
    assert.equal(view.shown.personal.at(-1).timelineId, A.id);
  });
});

describe('TimelineUI — an event\'s photo', () => {
  const resized = () => ({
    full: new Blob(['f'.repeat(1000)], { type: 'image/webp' }), thumb: new Blob(['t'], { type: 'image/webp' }),
    width: 1600, height: 1200, mime: 'image/webp',
  });
  // A timeline store that records saved events and can be told to fail.
  function photoStore(events = []) {
    return {
      saved: [], deleted: [], removedTimelines: [], fail: false,
      get: async () => A, loadEvents: async () => events, listMine: async () => [],
      async saveEvent(timeline, event) { if (this.fail) throw new Error('offline'); this.saved.push({ timelineId: timeline.id, event }); },
      async deleteEvent(timeline, eventId) { this.deleted.push(eventId); },
      async remove(timeline) { this.removedTimelines.push(timeline.id); },
    };
  }
  async function openWith(store) {
    const view = ui(store);
    await view.open(A.id);
    return view;
  }
  const quiet = async (work) => {
    const original = console.error;
    console.error = () => {};
    try { return await work(); } finally { console.error = original; }
  };

  it('a new photo is uploaded under the timeline\'s generation and recorded on the saved event', async () => {
    const store = photoStore();
    const view = await openWith(store);
    assert.equal(await view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, null, view.formTarget()), null);
    const { event } = store.saved[0];
    assert.equal('photo' in event, false);
    assert.equal(event.image.image_role, 'personal_photo');
    assert.deepEqual([event.image.width, event.image.height, event.image.mime, event.image.bytes], [1600, 1200, 'image/webp', 1000]);
    const prefix = `memory/${A.id}/${timelineGeneration(A.createdAt)}/${event.event_id}/img_`;
    assert.ok(event.image.ref.startsWith(prefix) && event.image.ref.endsWith('.webp'));
    assert.ok(event.image.thumb_ref.startsWith(prefix) && event.image.thumb_ref.endsWith('_thumb.webp'));
    assert.deepEqual([...view.imageStore.files.keys()].sort(), [event.image.ref, event.image.thumb_ref].sort());
  });

  it('saving without touching the photo keeps it', async () => {
    const store = photoStore();
    const view = await openWith(store);
    await view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, null, view.formTarget());
    const first = store.saved[0].event;
    await view.saveEvent({ ...secret, name: 'Renamed' }, first, view.formTarget());
    assert.deepEqual(store.saved[1].event.image, first.image);
    assert.equal(view.imageStore.files.size, 2);
  });

  it('replacing a photo stores the new one and deletes the old files after the save', async () => {
    const store = photoStore();
    const view = await openWith(store);
    await view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, null, view.formTarget());
    const first = store.saved[0].event;
    await view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, first, view.formTarget());
    const second = store.saved[1].event;
    assert.notEqual(second.image.ref, first.image.ref);
    assert.deepEqual([...view.imageStore.files.keys()].sort(), [second.image.ref, second.image.thumb_ref].sort());
  });

  it('removing a photo saves the event without one and deletes its files', async () => {
    const store = photoStore();
    const view = await openWith(store);
    await view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, null, view.formTarget());
    await view.saveEvent({ ...secret, photo: { action: 'remove' } }, store.saved[0].event, view.formTarget());
    assert.equal('image' in store.saved[1].event, false);
    assert.equal(view.imageStore.files.size, 0);
  });

  it('if the event cannot be saved, the photo just uploaded is deleted and the old one kept', async () => {
    const store = photoStore();
    const view = await openWith(store);
    await view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, null, view.formTarget());
    const first = store.saved[0].event;
    store.fail = true;
    const problem = await quiet(() => view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, first, view.formTarget()));
    assert.match(problem, /Could not save the event/);
    assert.deepEqual([...view.imageStore.files.keys()].sort(), [first.image.ref, first.image.thumb_ref].sort());
  });

  it('if the upload fails, nothing is saved', async () => {
    const store = photoStore();
    const view = await openWith(store);
    view.imageStore.upload = async () => { throw new Error('quota'); };
    const problem = await quiet(() => view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, null, view.formTarget()));
    assert.match(problem, /Could not upload the photo/);
    assert.equal(store.saved.length, 0);
  });

  it('deleting an event deletes its photo files first', async () => {
    const store = photoStore();
    const view = await openWith(store);
    await view.saveEvent({ ...secret, photo: { action: 'add', resized: resized() } }, null, view.formTarget());
    const event = store.saved[0].event;
    view.imageStore.remove = async function (ref) {
      assert.equal(store.deleted.length, 0, 'files go before the event');
      this.files.delete(ref);
    };
    await view.deleteEvent(event);
    assert.equal(view.imageStore.files.size, 0);
    assert.deepEqual(store.deleted, [event.event_id]);
  });

  it('deleting a timeline deletes the photo files of its events, then the timeline', async () => {
    const view = ui(photoStore());
    const where = { timelineId: A.id, generation: timelineGeneration(A.createdAt), eventId: secret.event_id };
    const stored = await view.imageStore.upload(where, resized());
    const store = photoStore([{ ...secret, image: { ...stored } }, { event_id: 'evt_2', name: 'No photo' }]);
    view.store = store;
    view.timelines = [];
    await view.remove({ ...A, count: 2 });
    assert.equal(view.imageStore.files.size, 0);
    assert.deepEqual(store.removedTimelines, [A.id]);
  });

  it('closing the timeline clears the photo cache', async () => {
    const view = await openWith(photoStore());
    let cleared = false;
    view.images.clear = () => { cleared = true; };
    view.close();
    assert.equal(cleared, true);
  });
});
