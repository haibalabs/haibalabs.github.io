// timeline-ui.js
// Personal timelines in the page (see PERSONAL-TIMELINES.md): "My timelines" in the settings
// panel, the open timeline's pill in the top bar, and saving its events as they change. The UI
// hides what an account cannot use; the Firestore rules decide what it can reach.
import { PersonalImages } from './personal-images.js';
import { permissionsFor } from './roles.js';
import { newEventId } from './event-id.js';
import { eventProblem, PERSONAL_PHOTO_ROLE, timelineGeneration, timelineIdFromSearch, titleProblem } from './timeline-model.js';
import { setEventImage } from './world-edits.js';

// Every Firestore call here is awaited while the user can still sign out, open another timeline
// or close this one. Each call notes the session (bumped on every account change) and the
// selection (bumped on every open and close) it started under, and applies its result only if
// neither has moved on; a write still lands in the timeline it was made for.
export class TimelineUI {
    /**
     * @param {object} eventManager
     * @param {object} uiManager
     * @param {import('./timeline-store.js').TimelineStore} store
     * @param {object} imageStore - the personal-photo adapter (see image-store.js)
     */
    constructor(eventManager, uiManager, store, imageStore) {
        this.eventManager = eventManager;
        this.uiManager = uiManager;
        this.store = store;
        this.imageStore = imageStore;
        // photos load under the same account and timeline guards as everything else here
        this.images = new PersonalImages(imageStore, {
            token: () => this.token(),
            isCurrent: (token) => this.isCurrent(token),
            generation: () => (this.current ? timelineGeneration(this.current.createdAt) : null),
        });
        this.images.onReady = (ref, url) => this.showPhoto(ref, url);
        this.images.onFailed = (ref) => {
            if (!this.viewer.hidden && this.viewer.querySelector('img').dataset.photoRef === ref) this.showViewerError();
        };
        // the open timeline document ({ id, title, createdAt, ... }), or null
        this.current = null;
        this.user = null;
        this.role = null;
        this.session = 0;
        this.selection = 0;
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
        this.addChoice = document.getElementById('add-choice');
        this.viewer = document.getElementById('photo-viewer');

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
        this.addEventBtn.addEventListener('click', () => this.addEvent());
        this.addChoice.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            this.toggleAddChoice(false);
            if (button.dataset.target === 'world') this.uiManager.editUI.openNew();
            else this.uiManager.modalManager.open();
        });
        document.addEventListener('click', (e) => {
            if (!this.pill.contains(e.target)) this.toggleMenu(false);
            if (!this.addChoice.contains(e.target) && !this.addEventBtn.contains(e.target)) this.toggleAddChoice(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            this.toggleMenu(false);
            this.toggleAddChoice(false);
            this.closePhoto();
        });
        // a click anywhere closes the viewer, except on a link or button in its details
        this.viewer.addEventListener('click', (e) => {
            if (!e.target.closest('a, button')) this.closePhoto();
        });
    }

    // Called once the world events have loaded, since loading them replaces every event.
    worldReady() {
        this.worldLoaded = true;
        this.openPending();
    }

    // The session and selection an awaited call started under.
    token() {
        return { session: this.session, selection: this.selection };
    }

    isCurrent(token, { selection = true } = {}) {
        return token.session === this.session && (!selection || token.selection === this.selection);
    }

    async setAccount(user, role) {
        const sameAccount = Boolean(user) && user.uid === this.user?.uid;
        this.session++;
        const token = this.token();
        this.user = user;
        this.role = role;
        const { member, canEdit } = permissionsFor(role);
        this.section.hidden = !(user && canEdit);
        // A different account (or none) must not keep the previous one's timeline or list on
        // screen; Firebase can switch accounts without signing out in between.
        if (!(sameAccount && member)) {
            if (this.current) {
                // signed out: reopen the same link after the next sign-in
                if (!user) this.pendingId = this.current.id;
                this.close({ keepAddress: !user });
            }
            this.list.replaceChildren();
        }
        if (!user || !member) return;
        if (canEdit) await this.refreshList();
        if (this.isCurrent(token, { selection: false })) this.openPending();
    }

    showStatus(message) {
        this.status.textContent = message;
        this.status.hidden = !message;
    }

    async refreshList() {
        const token = this.token();
        let timelines;
        try {
            timelines = await this.store.listMine();
        } catch (error) {
            console.error('Could not list timelines:', error);
            if (this.isCurrent(token, { selection: false })) this.showStatus('Could not load your timelines. Reload to try again.');
            return;
        }
        // another account's list must never replace this one
        if (!this.isCurrent(token, { selection: false })) return;
        this.timelines = timelines;
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
        const token = this.token();
        try {
            const id = await this.store.create(input.value);
            if (!this.isCurrent(token, { selection: false })) return;
            input.value = '';
            await this.refreshList();
            if (this.isCurrent(token, { selection: false })) await this.open(id);
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
            const token = this.token();
            try {
                await this.store.rename(timeline.id, input.value);
                if (!this.isCurrent(token, { selection: false })) return;
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
        const token = this.token();
        try {
            // photos first, then events and the timeline (see PERSONAL-IMAGES.md, Flows)
            for (const event of await this.store.loadEvents(timeline)) {
                if (event.image) await this.removePhotoFiles(event.image);
            }
            await this.store.remove(timeline);
            if (!this.isCurrent(token, { selection: false })) return;
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
        this.selection++;
        const token = this.token();
        try {
            const timeline = await this.store.get(id);
            if (!this.isCurrent(token)) return;
            if (!timeline) {
                this.uiManager.showToast('That timeline does not exist, or this account cannot open it.');
                if (timelineIdFromSearch(location.search) === id) this.setAddress(null);
                return;
            }
            const events = await this.store.loadEvents(timeline);
            if (!this.isCurrent(token)) return;
            this.current = timeline;
            this.eventManager.setPersonalEvents(id, events);
            this.eventManager.setTimelineView('with-world');
            this.setAddress(id);
            this.renderPill();
            this.addEventBtn.style.display = 'block';
            this.uiManager.editUI?.updateNewEventButton();
            this.uiManager.setPersonalFiltersVisible(true);
            this.markCurrentInList();
            document.getElementById('settings-panel').classList.remove('open');
            this.uiManager.resetLayout();
        } catch (error) {
            console.error('Could not open timeline:', error);
            if (this.isCurrent(token)) this.uiManager.showToast('Could not open the timeline. Try again.');
        }
    }

    close({ keepAddress = false } = {}) {
        this.selection++;
        this.current = null;
        this.uiManager.modalManager?.discardPersonal();
        this.closePhoto();
        this.images.clear();
        this.eventManager.clearPersonalEvents();
        if (!keepAddress) this.setAddress(null);
        this.pill.hidden = true;
        this.toggleMenu(false);
        // Add event is for personal timelines; world events are proposed through Suggest an edit
        this.addEventBtn.style.display = 'none';
        this.toggleAddChoice(false);
        this.uiManager.editUI?.updateNewEventButton();
        this.uiManager.setPersonalFiltersVisible(false);
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

    // Add event adds to the open timeline. With world history shown and editing on, where it goes is a
    // choice, so it asks first: this timeline, or a suggested world event.
    addEvent() {
        if (this.eventManager.timelineView === 'only' || !this.uiManager.editUI?.editing) {
            this.uiManager.modalManager.open();
            return;
        }
        this.addChoice.querySelector('.add-choice-title').textContent = this.current?.title ?? 'this timeline';
        this.toggleAddChoice(this.addChoice.hidden);
    }

    toggleAddChoice(open) {
        this.addChoice.hidden = !open;
        this.addEventBtn.setAttribute('aria-expanded', String(open));
    }

    setView(view) {
        this.eventManager.setTimelineView(view);
        this.renderPill();
        this.uiManager.resetLayout();
    }

    // Where the event form saves to, noted when the form opens: the open timeline under the
    // current account, or null for world events.
    formTarget() {
        return this.current ? { timeline: this.current, token: this.token() } : null;
    }

    /**
     * Saves an event from the event form to the timeline the form was opened for. Returns a
     * message to show in the form when the event cannot be saved, or null once it is saved.
     *
     * @param {object} fields - the form's event fields
     * @param {object|null} editing - the personal event being edited, or null for a new one
     * @param {{ timeline: object, token: object }|null} target - formTarget() when the form opened
     * @returns {Promise<string|null>}
     */
    async saveEvent(fields, editing, target) {
        if (!target || !this.isCurrent(target.token)) {
            return 'The timeline was closed or the account changed, so this event was not saved.';
        }
        // photo: { action: 'keep' } (the default), { action: 'remove' }, { action: 'add', resized }, or
        // { action: 'link', image }: an image shown from its link, with its credit (image-link.js)
        const { photo = { action: 'keep' }, ...eventFields } = fields;
        const problem = eventProblem(eventFields);
        if (problem) return problem;
        const { timeline, token } = target;
        const event = { ...eventFields, event_id: editing?.event_id ?? newEventId() };
        const previous = editing?.image ?? null;
        let uploaded = null;
        if (photo.action === 'add') {
            const { full, width, height, mime } = photo.resized;
            const where = { timelineId: timeline.id, generation: timelineGeneration(timeline.createdAt), eventId: event.event_id };
            try {
                uploaded = await this.imageStore.upload(where, photo.resized);
            } catch (error) {
                console.error('Could not upload photo:', error);
                if (!this.isCurrent(token)) return null;
                return 'Could not upload the photo. Try again.';
            }
            event.image = { ...uploaded, width, height, mime, bytes: full.size, image_role: PERSONAL_PHOTO_ROLE };
        } else if (photo.action === 'link') {
            // a link replaces the private photo, whose files are removed once the event is saved
            setEventImage(event, photo.image);
        } else if (photo.action === 'keep' && previous) {
            event.image = previous;
        } else if (photo.action === 'keep' && editing?.image_url) {
            event.image_url = editing.image_url;
            if (editing.image_preview) event.image_preview = editing.image_preview;
        }
        try {
            await this.store.saveEvent(timeline, event);
        } catch (error) {
            console.error('Could not save event:', error);
            if (uploaded) await this.removePhotoFiles(uploaded);
            if (!this.isCurrent(token)) return null;
            return error.code === 'permission-denied'
                ? 'This account can no longer edit this timeline.'
                : 'Could not save the event. Try again.';
        }
        // the event no longer points at its previous photo, whatever is on screen now
        const replaced = previous && event.image !== previous;
        if (replaced) await this.removePhotoFiles(previous);
        // saved to its timeline, but that timeline is no longer the one on screen
        if (!this.isCurrent(token)) return null;
        if (replaced) {
            this.images.forget(previous.ref);
            this.images.forget(previous.thumb_ref);
        }
        const id = this.eventManager.placeIndex.idFor(editing ?? event);
        this.uiManager.eventHeights.delete(id);
        this.eventManager.upsertPersonalEvent(timeline.id, event);
        this.uiManager.resetLayout();
        this.uiManager.scrollToEventId(this.eventManager.placeIndex.idFor(event));
        return null;
    }

    async deleteEvent(event) {
        const timeline = this.current;
        if (!timeline || !confirm(`Delete "${event.name}" from this timeline?`)) return;
        const token = this.token();
        try {
            // the photo first, then the event (see PERSONAL-IMAGES.md, Flows)
            if (event.image) await this.removePhotoFiles(event.image);
            await this.store.deleteEvent(timeline, event.event_id);
        } catch (error) {
            console.error('Could not delete event:', error);
            if (this.isCurrent(token)) this.uiManager.showToast('Could not delete the event. Try again.');
            return;
        }
        if (!this.isCurrent(token)) return;
        this.eventManager.removePersonalEvent(event.event_id);
        this.uiManager.resetLayout();
    }

    // Deletes a photo's two files. A failure is logged, not raised: the event no longer points at
    // them, so they are unreachable garbage at worst.
    async removePhotoFiles(image) {
        for (const ref of [image.ref, image.thumb_ref]) {
            try {
                await this.imageStore.remove(ref);
            } catch (error) {
                console.error('Could not delete photo file:', error);
            }
        }
    }

    // Fills a personal card's photo from the cache, or when it loads; clicking opens it full size.
    decoratePhoto(eventDiv, event) {
        const img = eventDiv.querySelector('img[data-photo-ref]');
        const url = this.images.url(event.image.thumb_ref);
        if (url) this.setPhotoSource(img, url);
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPhoto(event);
        });
    }

    setPhotoSource(img, url) {
        img.src = url;
        img.parentElement.classList.remove('loading');
    }

    // A photo arrived for the open timeline: show it wherever it is waiting.
    showPhoto(ref, url) {
        for (const img of document.querySelectorAll('img[data-photo-ref]')) {
            if (img.dataset.photoRef === ref) this.setPhotoSource(img, url);
        }
    }

    openPhoto(event) {
        this.openViewer({ alt: event.name, ref: event.image.ref });
    }

    /**
     * Opens the full-window viewer on a photo: a private one by ref, loaded through the image
     * adapter, or a public one by src (world images). details, a DOM node, appears under it.
     *
     * @param {{ alt: string, ref?: string, src?: string, fallbackSrc?: string, details?: Node|null }} photo
     *     fallbackSrc replaces src if it fails to load
     */
    openViewer({ alt, ref = null, src = null, fallbackSrc = null, details = null }) {
        const img = this.viewer.querySelector('img');
        if (ref) img.dataset.photoRef = ref;
        else delete img.dataset.photoRef;
        img.alt = alt;
        img.removeAttribute('src');
        const area = this.viewer.querySelector('.photo-viewer-details');
        area.replaceChildren(...(details ? [details] : []));
        area.hidden = !details;
        this.viewer.classList.remove('failed');
        this.viewer.querySelector('.photo-viewer-error').hidden = true;
        this.viewer.classList.add('loading');
        this.viewer.hidden = false;
        const fail = () => this.showViewerError();
        if (src) {
            img.onload = () => this.viewer.classList.remove('loading');
            img.onerror = fallbackSrc && fallbackSrc !== src ? () => {
                img.onerror = fail;
                img.src = fallbackSrc;
            } : fail;
            img.src = src;
            return;
        }
        img.onload = null;
        img.onerror = fail;
        const url = this.images.url(ref);
        if (url) this.setPhotoSource(img, url);
        else if (this.images.hasFailed(ref)) fail();
    }

    // Replaces the viewer's spinner with a message once the photo cannot load.
    showViewerError() {
        this.viewer.classList.remove('loading');
        this.viewer.classList.add('failed');
        this.viewer.querySelector('.photo-viewer-error').hidden = false;
    }

    closePhoto() {
        if (this.viewer.hidden) return;
        this.viewer.hidden = true;
        const img = this.viewer.querySelector('img');
        delete img.dataset.photoRef;
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        this.viewer.classList.remove('failed');
        this.viewer.querySelector('.photo-viewer-error').hidden = true;
        this.viewer.querySelector('.photo-viewer-details').replaceChildren();
    }
}
