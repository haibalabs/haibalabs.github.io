// timeline-ui.js
// Personal timelines in the page (see PERSONAL-TIMELINES.md): "My timelines" in the settings
// panel, the open timeline's pill in the top bar, and saving its events as they change. The UI
// hides what an account cannot use; the Firestore rules decide what it can reach.
import { permissionsFor } from './roles.js';
import { newEventId } from './sync-identity.js';
import { TimelineStore } from './timeline-store.js';
import { eventProblem, timelineIdFromSearch, titleProblem } from './timeline-model.js';

export class TimelineUI {
    constructor(eventManager, uiManager) {
        this.eventManager = eventManager;
        this.uiManager = uiManager;
        this.store = new TimelineStore(eventManager.db, eventManager.auth);
        // the open timeline document ({ id, title, createdAt, ... }), or null
        this.current = null;
        this.user = null;
        this.role = null;
        this.worldLoaded = false;
        // a ?timeline= link waiting for sign-in or for world events to load
        this.pendingId = timelineIdFromSearch(location.search);

        this.section = document.getElementById('my-timelines');
        this.list = document.getElementById('timeline-list');
        this.status = document.getElementById('timeline-status');
        this.pill = document.getElementById('timeline-pill');
        this.pillButton = document.getElementById('timeline-pill-btn');
        this.menu = document.getElementById('timeline-menu');
        this.addEventBtn = document.getElementById('add-event');

        this.setupListeners();
        uiManager.personalEventActions = {
            edit: (event) => uiManager.modalManager?.open(event),
            remove: (event) => this.deleteEvent(event),
        };
        uiManager.onAccountChange = (user, role) => this.setAccount(user, role);
        if (uiManager.account) this.setAccount(uiManager.account.user, uiManager.account.role);
    }

    setupListeners() {
        document.getElementById('timeline-create').addEventListener('submit', (e) => {
            e.preventDefault();
            this.create();
        });
        this.pillButton.addEventListener('click', () => this.toggleMenu());
        this.menu.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            this.toggleMenu(false);
            if (button.dataset.view) this.setView(button.dataset.view);
            else if (button.dataset.action === 'close') this.close();
        });
        document.addEventListener('click', (e) => {
            if (!this.pill.contains(e.target)) this.toggleMenu(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.toggleMenu(false);
        });
    }

    // Called once the world events have loaded, since loading them replaces every event.
    worldReady() {
        this.worldLoaded = true;
        this.openPending();
    }

    async setAccount(user, role) {
        this.user = user;
        this.role = role;
        const { member, canEdit } = permissionsFor(role);
        this.section.hidden = !(user && canEdit);
        if (!user || !member) {
            if (this.current) {
                this.pendingId = this.current.id;
                this.close({ keepAddress: true });
            }
            this.list.replaceChildren();
            return;
        }
        if (canEdit) await this.refreshList();
        this.openPending();
    }

    showStatus(message) {
        this.status.textContent = message;
        this.status.hidden = !message;
    }

    async refreshList() {
        try {
            this.timelines = await this.store.listMine();
        } catch (error) {
            console.error('Could not list timelines:', error);
            this.showStatus('Could not load your timelines. Reload to try again.');
            return;
        }
        this.list.replaceChildren(...this.timelines.map(timeline => this.renderListItem(timeline)));
        if (!this.timelines.length) {
            const empty = document.createElement('li');
            empty.className = 'timeline-empty';
            empty.textContent = 'No timelines yet.';
            this.list.append(empty);
        }
    }

    renderListItem(timeline) {
        const item = document.createElement('li');
        item.className = 'timeline-item';
        item.dataset.timelineId = timeline.id;
        item.classList.toggle('current', timeline.id === this.current?.id);

        const label = document.createElement('div');
        label.className = 'timeline-label';
        const title = document.createElement('span');
        title.className = 'timeline-title';
        title.textContent = timeline.title;
        const count = document.createElement('span');
        count.className = 'timeline-count';
        count.textContent = timeline.count === 1 ? '1 event' : `${timeline.count} events`;
        label.append(title, count);

        const actions = document.createElement('div');
        actions.className = 'timeline-actions';
        actions.append(
            this.actionButton('Open', () => this.open(timeline.id)),
            this.actionButton('Rename', () => this.startRename(item, timeline)),
            this.actionButton('Delete', () => this.remove(timeline)),
        );
        item.append(label, actions);
        return item;
    }

    actionButton(text, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'timeline-action';
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    async create() {
        const input = document.getElementById('timeline-title');
        const problem = titleProblem(input.value);
        if (problem) return this.showStatus(problem);
        this.showStatus('');
        try {
            const id = await this.store.create(input.value);
            input.value = '';
            await this.refreshList();
            await this.open(id);
        } catch (error) {
            console.error('Could not create timeline:', error);
            this.showStatus('Could not create the timeline. Try again.');
        }
    }

    startRename(item, timeline) {
        const form = document.createElement('form');
        form.className = 'timeline-rename';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = timeline.title;
        input.maxLength = 120;
        input.setAttribute('aria-label', 'Timeline name');
        const save = this.actionButton('Save', () => {});
        save.type = 'submit';
        const cancel = this.actionButton('Cancel', () => this.refreshList());
        form.append(input, save, cancel);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const problem = titleProblem(input.value);
            if (problem) return this.showStatus(problem);
            this.showStatus('');
            try {
                await this.store.rename(timeline.id, input.value);
                if (this.current?.id === timeline.id) {
                    this.current.title = input.value.trim();
                    this.renderPill();
                }
                await this.refreshList();
            } catch (error) {
                console.error('Could not rename timeline:', error);
                this.showStatus('Could not rename the timeline. Try again.');
            }
        });
        item.replaceChildren(form);
        input.focus();
        input.select();
    }

    async remove(timeline) {
        const events = timeline.count === 1 ? '1 event' : `${timeline.count} events`;
        if (!confirm(`Delete "${timeline.title}" and its ${events}? This cannot be undone.`)) return;
        this.showStatus('');
        try {
            await this.store.remove(timeline);
            if (this.current?.id === timeline.id) this.close();
            await this.refreshList();
        } catch (error) {
            console.error('Could not delete timeline:', error);
            this.showStatus('Could not delete the timeline. Try again.');
        }
    }

    openPending() {
        if (!this.pendingId || !this.worldLoaded) return;
        if (!this.user) {
            this.uiManager.showToast('Sign in from the settings panel to open this timeline.');
            return;
        }
        const id = this.pendingId;
        this.pendingId = null;
        this.open(id);
    }

    async open(id) {
        try {
            const timeline = await this.store.get(id);
            if (!timeline) {
                this.uiManager.showToast('That timeline does not exist, or this account cannot open it.');
                if (timelineIdFromSearch(location.search) === id) this.setAddress(null);
                return;
            }
            const events = await this.store.loadEvents(timeline);
            this.current = timeline;
            this.eventManager.setPersonalEvents(id, events);
            this.eventManager.setTimelineView('with-world');
            this.setAddress(id);
            this.renderPill();
            this.addEventBtn.style.display = 'block';
            this.markCurrentInList();
            document.getElementById('settings-panel').classList.remove('open');
            this.uiManager.resetLayout();
        } catch (error) {
            console.error('Could not open timeline:', error);
            this.uiManager.showToast('Could not open the timeline. Try again.');
        }
    }

    close({ keepAddress = false } = {}) {
        this.current = null;
        this.eventManager.clearPersonalEvents();
        if (!keepAddress) this.setAddress(null);
        this.pill.hidden = true;
        this.toggleMenu(false);
        // back to whatever the admin debug toggle allows
        this.addEventBtn.style.display = document.getElementById('debug-add-event').checked ? 'block' : 'none';
        this.markCurrentInList();
        this.uiManager.resetLayout();
    }

    markCurrentInList() {
        for (const item of this.list.querySelectorAll('.timeline-item')) {
            item.classList.toggle('current', item.dataset.timelineId === this.current?.id);
        }
    }

    // Keeps ?timeline=<id> in the address so an open timeline can be bookmarked or reloaded.
    setAddress(id) {
        const url = new URL(location.href);
        if (id) url.searchParams.set('timeline', id);
        else url.searchParams.delete('timeline');
        history.replaceState(null, '', url);
    }

    renderPill() {
        this.pill.hidden = false;
        this.pill.querySelector('.timeline-pill-title').textContent = this.current.title;
        for (const button of this.menu.querySelectorAll('[data-view]')) {
            button.setAttribute('aria-checked', String(button.dataset.view === this.eventManager.timelineView));
        }
    }

    toggleMenu(open = this.menu.hidden) {
        this.menu.hidden = !open;
        this.pillButton.setAttribute('aria-expanded', String(open));
    }

    setView(view) {
        this.eventManager.setTimelineView(view);
        this.renderPill();
        this.uiManager.resetLayout();
    }

    /**
     * Saves an event from the event form to the open timeline. Returns a message to show in the
     * form when the event cannot be saved, or null once it is saved.
     *
     * @param {object} fields - the form's event fields
     * @param {object|null} editing - the personal event being edited, or null for a new one
     * @returns {Promise<string|null>}
     */
    async saveEvent(fields, editing) {
        const problem = eventProblem(fields);
        if (problem) return problem;
        const event = { ...fields, event_id: editing?.event_id ?? newEventId() };
        try {
            await this.store.saveEvent(this.current, event);
        } catch (error) {
            console.error('Could not save event:', error);
            return error.code === 'permission-denied'
                ? 'This account can no longer edit this timeline.'
                : 'Could not save the event. Try again.';
        }
        const id = this.eventManager.placeIndex.idFor(editing ?? event);
        this.uiManager.eventHeights.delete(id);
        this.eventManager.upsertPersonalEvent(this.current.id, event);
        this.uiManager.resetLayout();
        this.uiManager.scrollToEventId(this.eventManager.placeIndex.idFor(event));
        return null;
    }

    async deleteEvent(event) {
        if (!confirm(`Delete "${event.name}" from this timeline?`)) return;
        try {
            await this.store.deleteEvent(this.current, event.event_id);
        } catch (error) {
            console.error('Could not delete event:', error);
            this.uiManager.showToast('Could not delete the event. Try again.');
            return;
        }
        this.eventManager.removePersonalEvent(event.event_id);
        this.uiManager.resetLayout();
    }
}
