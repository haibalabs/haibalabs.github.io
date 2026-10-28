// edit-ui.js
// The screens for suggesting edits to world events (WORLD-EDITS.md, Editor screens): the Editing
// switch in the top bar, the pencil on each world event while it is on, the Suggest an edit form,
// the author's "pending" mark on an event, and My edits in the profile drawer. Only signed-in
// editors, reviewers and admins see any of it; the rules decide what is actually allowed.
import { PROMINENT_LABELS } from './config.js';
import { permissionsFor } from './roles.js';
import {
    changesFor, contentSha256, DAILY_LIMIT, EDIT_FIELDS, editorStatus, EDITOR_STATUS_LABELS, editProblem,
    FIELD_LABELS, isOpen, newEditId, normalizeField, normalizeFigures, normalizeWikipediaUrl, sameValue,
} from './world-edits.js';
import { articleInfo, searchArticles } from './wikipedia-lookup.js';

const EDITING_KEY = 'historiline.editing';
const SEARCH_DELAY_MS = 300;
const WIKI_CHECK_DELAY_MS = 500;

function readEditingPreference() {
    try {
        return localStorage.getItem(EDITING_KEY) === 'on';
    } catch {
        return false;
    }
}

function writeEditingPreference(on) {
    try {
        localStorage.setItem(EDITING_KEY, on ? 'on' : 'off');
    } catch {
        // private windows may refuse storage; the switch still works for this page
    }
}

const isToday = (timestamp) => {
    const millis = timestamp?.toMillis?.();
    return millis !== undefined && new Date(millis).toDateString() === new Date().toDateString();
};

export class EditUI {
    constructor(eventManager, uiManager, store) {
        this.eventManager = eventManager;
        this.uiManager = uiManager;
        this.store = store;
        this.user = null;
        this.canEdit = false;
        this.editing = false;
        this.edits = [];
        this.session = 0;

        this.toggle = document.getElementById('editing-toggle');
        this.section = document.getElementById('my-edits');
        this.list = document.getElementById('my-edits-list');
        this.count = document.getElementById('my-edits-count');
        this.status = document.getElementById('my-edits-status');
        this.modal = document.getElementById('suggest-edit-modal');
        this.form = document.getElementById('suggest-edit-form');
        this.peopleList = this.form.querySelector('.people-list');
        this.personInput = document.getElementById('se-person');
        this.personResults = document.getElementById('se-person-results');
        this.wikiCheckLine = document.getElementById('se-wiki-check');

        this.populateCategories();
        this.setupListeners();
        uiManager.worldEdits = this;
        uiManager.onEditAccountChange = (user, role) => this.setAccount(user, role);
        if (uiManager.account) this.setAccount(uiManager.account.user, uiManager.account.role);
    }

    populateCategories() {
        const select = document.getElementById('se-category');
        for (const label of PROMINENT_LABELS) {
            if (label.name === 'all') continue;
            const option = document.createElement('option');
            option.value = label.name;
            option.textContent = label.name.charAt(0).toUpperCase() + label.name.slice(1);
            select.append(option);
        }
    }

    setupListeners() {
        this.toggle.addEventListener('click', () => this.setEditing(!this.editing));
        document.getElementById('se-cancel').addEventListener('click', () => this.close());
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submit();
        });
        this.modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close();
        });
        for (const group of this.form.querySelectorAll('.form-group[data-field]')) {
            const field = group.dataset.field;
            group.querySelector('.undo-change').addEventListener('click', () => this.undo(field));
            if (field === 'figures') continue;
            group.querySelector('input, textarea, select').addEventListener('input', () => {
                this.markChanged(field);
                if (field === 'wikipedia_url') this.scheduleWikiCheck();
            });
        }
        this.personInput.addEventListener('input', () => this.schedulePersonSearch());
        this.personInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const first = this.personResults.querySelector('button');
                if (first) first.click();
            }
        });
        document.getElementById('se-add-source').addEventListener('click', () => this.addSourceInput());
    }

    // --- account and the Editing switch ---

    async setAccount(user, role) {
        this.session++;
        const session = this.session;
        this.user = user;
        this.canEdit = Boolean(user) && permissionsFor(role).canEdit;
        this.toggle.hidden = !this.canEdit;
        this.section.hidden = !this.canEdit;
        this.edits = [];
        this.list.replaceChildren();
        this.close();
        this.setEditing(this.canEdit && readEditingPreference(), { remember: false });
        if (!this.canEdit) return;
        await this.refresh(session);
    }

    setEditing(on, { remember = true } = {}) {
        this.editing = Boolean(on) && this.canEdit;
        this.toggle.setAttribute('aria-pressed', String(this.editing));
        this.toggle.classList.toggle('on', this.editing);
        if (remember) writeEditingPreference(this.editing);
        this.uiManager.resetLayout?.();
    }

    async refresh(session = this.session) {
        let edits;
        try {
            edits = await this.store.listMine();
        } catch (error) {
            console.error('Could not load your edits:', error);
            if (session === this.session) this.showStatus('Could not load your edits. Reload to try again.');
            return;
        }
        if (session !== this.session) return;
        this.showStatus('');
        this.edits = edits;
        this.renderMyEdits();
        if (this.editing) this.uiManager.resetLayout?.();
    }

    showStatus(message) {
        this.status.textContent = message;
        this.status.hidden = !message;
    }

    // The author's open edit of a world event, if any, for its pending mark.
    openEditFor(eventId) {
        return this.edits.find(edit => edit.event_id === eventId && isOpen(edit));
    }

    // Called by UIManager for every world event it renders.
    decorate(eventDiv, event) {
        if (!this.editing || event.personal) return;
        const bar = document.createElement('div');
        bar.className = 'edit-bar';
        const open = this.openEditFor(event.event_id);
        if (open) {
            const mark = document.createElement('span');
            mark.className = `edit-pending ${editorStatus(open)}`;
            mark.textContent = editorStatus(open) === 'rejected' ? 'Your edit was rejected' : 'Your edit is pending review';
            bar.append(mark);
        }
        const pencil = document.createElement('button');
        pencil.type = 'button';
        pencil.className = 'edit-pencil';
        pencil.title = 'Suggest an edit';
        pencil.setAttribute('aria-label', 'Suggest an edit');
        pencil.innerHTML = '<i class="fa-light fa-pen" aria-hidden="true"></i>';
        pencil.addEventListener('click', (e) => {
            e.stopPropagation();
            this.open(event);
        });
        bar.append(pencil);
        eventDiv.append(bar);
    }

    // --- My edits ---

    renderMyEdits() {
        const visible = this.edits.filter(edit => editorStatus(edit) !== 'withdrawn');
        const order = ['rejected', 'waiting', 'accepted', 'published'];
        visible.sort((a, b) => order.indexOf(editorStatus(a)) - order.indexOf(editorStatus(b)));
        const today = this.edits.filter(edit => isToday(edit.created_at)).length;
        this.count.textContent = `${today} of ${DAILY_LIMIT} today`;
        this.list.replaceChildren(...visible.map(edit => this.renderEditItem(edit)));
        if (!visible.length) {
            const empty = document.createElement('li');
            empty.className = 'my-edits-empty';
            empty.textContent = 'No edits yet. Turn on Editing and use the pencil on an event.';
            this.list.append(empty);
        }
    }

    renderEditItem(edit) {
        const status = editorStatus(edit);
        const item = document.createElement('li');
        item.className = `my-edit ${status}`;
        item.dataset.editId = edit.edit_id;

        const head = document.createElement('div');
        head.className = 'my-edit-head';
        const badge = document.createElement('span');
        badge.className = `status-badge ${status}`;
        badge.textContent = EDITOR_STATUS_LABELS[status];
        head.append(badge);
        const title = document.createElement('span');
        title.className = 'my-edit-title';
        title.textContent = edit.event_name;
        const fields = document.createElement('span');
        fields.className = 'my-edit-fields';
        fields.textContent = Object.keys(edit.changes ?? {}).map(f => FIELD_LABELS[f] ?? f).join(', ');
        item.append(head, title, fields);

        const reason = status === 'rejected' ? (edit.review?.note || this.firstFailure(edit)) : '';
        if (reason) {
            const p = document.createElement('p');
            p.className = 'my-edit-reason';
            p.textContent = reason;
            item.append(p);
        }
        if (isOpen(edit)) {
            const actions = document.createElement('div');
            actions.className = 'my-edit-actions';
            for (const [label, handler, primary] of [['Withdraw', () => this.withdraw(edit), false], ['Revise', () => this.revise(edit), status === 'rejected']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = primary ? 'btn btn-primary' : 'btn btn-secondary';
                button.textContent = label;
                button.addEventListener('click', handler);
                actions.append(button);
            }
            item.append(actions);
        }
        return item;
    }

    firstFailure(edit) {
        return (edit.checks?.automatic?.results ?? []).find(r => r.outcome === 'fail')?.detail ?? '';
    }

    async withdraw(edit) {
        if (!confirm(`Withdraw your edit to "${edit.event_name}"?`)) return;
        try {
            await this.store.withdraw(edit);
        } catch (error) {
            console.error('Could not withdraw the edit:', error);
            this.showStatus('Could not withdraw the edit. Try again.');
            return;
        }
        await this.refresh();
    }

    revise(edit) {
        const event = this.eventManager.events.find(e => !e.personal && e.event_id === edit.event_id);
        if (!event) {
            this.showStatus("This event isn't in the timeline that's loaded, so the edit can't be revised here.");
            return;
        }
        document.getElementById('settings-panel')?.classList.remove('open');
        this.open(event, edit);
    }

    // --- the Suggest an edit form ---

    // Opens the form for a world event, filled with its values, or with a revision's values when
    // revising one of the author's edits.
    open(event, edit = null) {
        // a send still in flight from an earlier form must not land in this one
        this.formSession = (this.formSession ?? 0) + 1;
        this.event = event;
        this.revising = edit;
        this.form.reset();
        this.showError('');
        this.original = Object.fromEntries(EDIT_FIELDS.map(f => [f, normalizeField(f, event[f])]));
        const values = { ...this.original };
        for (const [field, change] of Object.entries(edit?.changes ?? {})) values[field] = change.after;
        this.form.elements.name.value = values.name ?? '';
        this.form.elements.enhanced_time.value = values.enhanced_time ?? '';
        this.form.elements.enhanced_description.value = values.enhanced_description ?? '';
        this.form.elements.categories.value = values.categories?.[0] ?? '';
        this.form.elements.wikipedia_url.value = values.wikipedia_url ?? '';
        this.people = normalizeFigures(values.figures).map(person => ({ ...person, description: '' }));
        this.linkTarget = null;
        this.personInput.value = '';
        this.hideResults();
        this.renderPeople();
        this.resetSources(edit?.sources ?? []);
        document.getElementById('se-reason').value = edit?.reason ?? '';
        document.getElementById('se-source-conflict').checked = Boolean(edit?.source_conflict);
        this.cancelWikiCheck();
        this.wikiCheckLine.hidden = true;
        for (const field of EDIT_FIELDS) this.markChanged(field);
        if (edit?.changes?.wikipedia_url) this.scheduleWikiCheck(0);
        document.getElementById('se-submit').textContent = edit ? 'Send revision' : 'Send for review';
        this.modal.style.display = 'flex';
        this.form.elements.name.focus();
    }

    close() {
        this.formSession = (this.formSession ?? 0) + 1;
        this.modal.style.display = 'none';
        this.event = null;
        this.revising = null;
        clearTimeout(this.searchTimer);
        this.cancelWikiCheck();
    }

    showError(message) {
        const error = this.form.querySelector('.form-error');
        error.textContent = message;
        error.hidden = !message;
    }

    // The form's current value for a field.
    value(field) {
        if (field === 'figures') return this.people.map(({ name, wikipedia_url }) => (wikipedia_url ? { name, wikipedia_url } : { name }));
        if (field === 'categories') {
            // the select shows the first category; leaving it alone keeps all of the event's
            const chosen = this.form.elements.categories.value;
            if (chosen === this.original.categories?.[0]) return this.original.categories;
            return chosen ? [chosen] : [];
        }
        return this.form.elements[field].value;
    }

    markChanged(field) {
        const group = this.form.querySelector(`.form-group[data-field="${field}"]`);
        const changed = !sameValue(normalizeField(field, this.value(field)), this.original[field]);
        group.classList.toggle('changed', changed);
        group.querySelector('.changed-tag').hidden = !changed;
        group.querySelector('.undo-change').hidden = !changed;
    }

    undo(field) {
        const original = this.original[field];
        if (field === 'figures') {
            this.people = normalizeFigures(original).map(person => ({ ...person, description: '' }));
            this.renderPeople();
        } else if (field === 'categories') {
            this.form.elements.categories.value = original?.[0] ?? '';
        } else {
            this.form.elements[field].value = original ?? '';
        }
        if (field === 'wikipedia_url') {
            this.cancelWikiCheck();
            this.wikiCheckLine.hidden = true;
        }
        this.markChanged(field);
    }

    // --- people ---

    renderPeople() {
        this.peopleList.replaceChildren(...this.people.map((person, index) => {
            const item = document.createElement('li');
            item.className = 'person';
            const name = document.createElement('span');
            name.className = 'person-name';
            name.textContent = person.name;
            const link = document.createElement('span');
            link.className = person.wikipedia_url ? 'person-link linked' : 'person-link';
            link.textContent = person.wikipedia_url
                ? `Linked${person.description ? ` · ${person.description}` : ''}`
                : 'Not linked';
            const linkButton = document.createElement('button');
            linkButton.type = 'button';
            linkButton.className = 'link-btn';
            linkButton.textContent = person.wikipedia_url ? 'Change link' : 'Link to article';
            linkButton.addEventListener('click', () => this.startLinking(index));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'person-remove';
            remove.setAttribute('aria-label', `Remove ${person.name}`);
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                this.people.splice(index, 1);
                this.renderPeople();
            });
            const details = document.createElement('span');
            details.className = 'person-details';
            details.append(name, link, linkButton);
            item.append(details, remove);
            return item;
        }));
        this.markChanged('figures');
    }

    startLinking(index) {
        this.linkTarget = index;
        this.personInput.value = this.people[index].name;
        this.personInput.focus();
        this.schedulePersonSearch(0);
    }

    schedulePersonSearch(delay = SEARCH_DELAY_MS) {
        clearTimeout(this.searchTimer);
        const text = this.personInput.value.trim();
        if (!text) {
            this.linkTarget = null;
            this.hideResults();
            return;
        }
        this.searchTimer = setTimeout(async () => {
            const results = await searchArticles(text);
            if (this.personInput.value.trim() !== text) return;
            this.showResults(text, results);
        }, delay);
    }

    showResults(text, results) {
        const items = results.map(result => this.resultItem(result.title, result.description, () => this.choosePerson(result.title, result.url, result.description)));
        if (this.linkTarget === null) items.push(this.resultItem(`Add “${text}” without a link`, '', () => this.choosePerson(text, null, '')));
        this.personResults.replaceChildren(...items);
        this.personResults.hidden = !items.length;
        this.personInput.setAttribute('aria-expanded', String(!this.personResults.hidden));
    }

    resultItem(title, description, choose) {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        const button = document.createElement('button');
        button.type = 'button';
        const strong = document.createElement('span');
        strong.className = 'result-title';
        strong.textContent = title;
        button.append(strong);
        if (description) {
            const desc = document.createElement('span');
            desc.className = 'result-description';
            desc.textContent = description;
            button.append(desc);
        }
        button.addEventListener('click', choose);
        item.append(button);
        return item;
    }

    hideResults() {
        this.personResults.hidden = true;
        this.personResults.replaceChildren();
        this.personInput.setAttribute('aria-expanded', 'false');
    }

    // Adds a person, or links the one being linked, keeping the name the event used.
    choosePerson(title, url, description) {
        const wikipedia_url = url ? normalizeWikipediaUrl(url) : null;
        if (this.linkTarget !== null) {
            const person = this.people[this.linkTarget];
            this.people[this.linkTarget] = wikipedia_url ? { name: person.name, wikipedia_url, description } : { name: person.name, description: '' };
        } else {
            this.people.push(wikipedia_url ? { name: title, wikipedia_url, description } : { name: title, description: '' });
        }
        this.linkTarget = null;
        this.personInput.value = '';
        this.hideResults();
        this.renderPeople();
    }

    // --- the Wikipedia link ---

    scheduleWikiCheck(delay = WIKI_CHECK_DELAY_MS) {
        this.cancelWikiCheck();
        const text = this.form.elements.wikipedia_url.value.trim();
        if (!text || sameValue(normalizeField('wikipedia_url', text), this.original.wikipedia_url)) {
            this.wikiCheckLine.hidden = true;
            return;
        }
        const check = { text, done: null, cancel: null };
        check.done = new Promise(resolve => {
            // a replaced or abandoned check settles as cancelled instead of never settling, so a
            // send waiting on it stops and the form can send again
            check.cancel = () => resolve({ ok: null, cancelled: true, problem: 'The link changed before it was checked.' });
            this.wikiTimer = setTimeout(async () => resolve(await articleInfo(text)), delay);
        }).then(result => {
            if (this.wikiCheck === check && !result.cancelled) this.showWikiCheck(result);
            return result;
        });
        this.wikiCheck = check;
    }

    cancelWikiCheck() {
        clearTimeout(this.wikiTimer);
        this.wikiCheck?.cancel?.();
        this.wikiCheck = null;
    }

    showWikiCheck(result) {
        this.wikiCheckLine.hidden = false;
        this.wikiCheckLine.classList.toggle('ok', result.ok === true);
        this.wikiCheckLine.classList.toggle('problem', result.ok === false);
        this.wikiCheckLine.textContent = result.ok ? `✓ Article found: “${result.title}”` : result.problem;
    }

    // --- sources ---

    resetSources(sources) {
        const container = document.getElementById('se-sources');
        container.replaceChildren();
        for (const source of sources.length ? sources : ['']) this.addSourceInput(source);
    }

    addSourceInput(value = '') {
        const container = document.getElementById('se-sources');
        if (container.children.length >= 5) return;
        const input = document.createElement('input');
        input.type = 'url';
        input.className = 'source-input';
        input.placeholder = 'https://…';
        input.setAttribute('aria-label', 'Source link');
        input.value = typeof value === 'string' ? value : '';
        if (!container.children.length) input.id = 'se-source';
        container.append(input);
        document.getElementById('se-add-source').hidden = container.children.length >= 5;
    }

    sources() {
        return [...document.querySelectorAll('#se-sources .source-input')].map(i => i.value.trim()).filter(Boolean);
    }

    // --- sending ---

    // One send at a time: the form locks before the first awaited check, so a second click while
    // the Wikipedia lookup is pending can't write a second edit, and a send whose form was closed
    // or replaced (or whose account changed) in the meantime writes nothing.
    async submit() {
        if (this.submitting || !this.event) return;
        const session = this.formSession;
        const current = () => session === this.formSession;
        const event = this.event;
        const revising = this.revising;
        // only Send locks; Cancel stays available and cancels a send that is still checking
        const buttons = [document.getElementById('se-submit')];
        this.submitting = true;
        buttons.forEach(button => button.disabled = true);
        try {
            const values = Object.fromEntries(EDIT_FIELDS.map(f => [f, this.value(f)]));
            const changes = changesFor(event, values);
            const reason = document.getElementById('se-reason').value.trim();
            const sources = this.sources();
            const sourceConflict = document.getElementById('se-source-conflict').checked;
            const problem = editProblem({ changes, reason, sources });
            if (problem) return this.showError(problem);
            if (!revising && this.edits.filter(edit => isToday(edit.created_at)).length >= DAILY_LIMIT) {
                return this.showError(`You've sent ${DAILY_LIMIT} edits today. You can send more tomorrow.`);
            }
            const browserChecks = [{ check: 'format', outcome: 'pass' }];
            if (changes.wikipedia_url?.after) {
                const result = await (this.wikiCheck?.done ?? articleInfo(changes.wikipedia_url.after));
                // closed, or the link changed while it was being checked: send nothing
                if (!current() || result.cancelled) return;
                if (result.ok === false) return this.showError(result.problem);
                browserChecks.push({ check: 'wikipedia_article', outcome: result.ok ? 'pass' : 'unsure', detail: result.ok ? result.title : result.problem });
            }
            const contentSha = await contentSha256({ changes, reason, sources, source_conflict: sourceConflict });
            const datasetSha256 = await this.eventManager.loadedSha256 ?? null;
            if (!current()) return;
            try {
                if (revising) {
                    await this.store.revise(revising, { changes, reason, sources, sourceConflict, contentSha, browserChecks, eventName: event.name, datasetSha256 });
                } else {
                    await this.store.submit({ editId: newEditId(), event, changes, reason, sources, sourceConflict, datasetSha256, contentSha, browserChecks });
                }
            } catch (error) {
                console.error('Could not send the edit:', error);
                if (current()) this.showError('Could not send the edit. Check your connection and try again.');
                return;
            }
            if (current()) this.close();
            this.uiManager.showToast?.(revising ? 'Revision sent for review.' : 'Sent for review.');
        } finally {
            this.submitting = false;
            buttons.forEach(button => button.disabled = false);
        }
        await this.refresh();
    }
}
