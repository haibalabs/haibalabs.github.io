import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals for the TimelineUI methods under test; the DOM wiring in its
// constructor is skipped (see ui() below).
globalThis.location = { href: 'http://localhost/history/', search: '' };
globalThis.history = { replaceState() {} };
globalThis.confirm = () => true;
const element = () => ({ checked: false, hidden: true, style: {}, classList: { remove() {} }, textContent: '' });
globalThis.document = { getElementById: element, createElement: element };

const { TimelineUI } = await import('../../modules/timeline-ui.js');

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
  const shown = { personal: [], timelineId: null, toasts: [], list: null };
  Object.assign(instance, {
    store, shown, current: null, user: { uid: 'alice' }, role: 'editor', session: 1, selection: 0,
    pendingId: null, worldLoaded: true,
    section: { hidden: false }, status: element(),
    list: { replaceChildren(...items) { shown.list = items; }, append() {}, querySelectorAll: () => [] },
    pill: { hidden: true, querySelector: () => element() },
    menu: { hidden: true, querySelectorAll: () => [] },
    pillButton: { setAttribute() {} },
    addEventBtn: { style: {} },
    renderListItem: (timeline) => timeline.id,
  });
  instance.uiManager = {
    showToast: (message) => shown.toasts.push(message), resetLayout() {}, scrollToEventId() {}, eventHeights: new Map(),
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
    const saving = view.saveEvent({ ...secret }, null);
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
    const saving = view.saveEvent({ ...secret }, null);
    view.close();
    write.resolve();
    assert.equal(await saving, null);
    assert.deepEqual(view.shown.personal, []);
  });

  it('a save with no open timeline is refused instead of throwing', async () => {
    const view = ui({ saveEvent: () => assert.fail('nothing should be written') });
    assert.match(await view.saveEvent({ ...secret }, null), /timeline was closed/);
  });

  it('a delete finishing after sign-out leaves the screen alone', async () => {
    const removal = deferred();
    const view = ui({ get: async () => A, loadEvents: async () => [secret], deleteEvent: () => removal.promise, listMine: async () => [] });
    await view.open(A.id);
    const deleting = view.deleteEvent(secret);
    await view.setAccount({ uid: 'bob' }, 'editor');
    view.shown.personal = [{ ...secret, owner: 'bob' }];
    removal.resolve();
    await deleting;
    assert.equal(view.shown.personal.length, 1);
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

  it('a save shows the event in the timeline it was saved to', async () => {
    await view.open(A.id);
    assert.equal(await view.saveEvent({ name: 'Wedding', enhanced_time: '1930' }, null), null);
    assert.equal(view.shown.personal.at(-1).timelineId, A.id);
  });
});
