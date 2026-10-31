// review-ui.js
// The admin review page (WORLD-EDITS.md, Admin review page): open edits grouped by event, each
// field's before and after, Approve (every field or the ticked ones) and Reject with a reason the
// author sees; Conflicts, where another approval has changed a field since the edit was written;
// and History, every edit of each event from its original values on, with Revert. Review is by
// hand: there is no automatic checker yet (phase 3). Identities appear only here, to admins; what
// approval publishes names no one.
import { AuthManager } from './auth-manager.js';
import { EditStore } from './edit-store.js';
import { EventManager } from './event-manager.js';
import { ReviewStore } from './review-store.js';
import { permissionsFor } from './roles.js';
import {
    conflictingFields, contentSha256, FIELD_LABELS, newEditId, normalizeFigures, OVERLAY_MAX_BYTES, overlayBytes,
    publishedValue, REVIEWABLE_STATUSES, revertChanges, sameValue, wordDiff,
} from './world-edits.js';

const millis = (timestamp) => timestamp?.toMillis?.() ?? 0;

function age(timestamp) {
    const ms = millis(timestamp);
    if (!ms) return '';
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 2) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 2) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    return new Date(ms).toLocaleDateString();
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const personKey = (person) => person.name;

// A field's value as one line of text, for conflict notes.
function valueText(field, value) {
    if (field === 'figures') return normalizeFigures(value).map(p => p.name).join(', ') || '(none)';
    if (Array.isArray(value)) return value.join(', ') || '(none)';
    return value ?? '(none)';
}

const STATUS_LABELS = {
    published: 'Published', merged: 'Published', rejected: 'Rejected', sent_back: 'Rejected', withdrawn: 'Withdrawn',
};

class ReviewPage {
    constructor() {
        const events = new EventManager(null);
        this.store = new ReviewStore(events.db, events.auth);
        this.editStore = new EditStore(events.db, events.auth);
        this.tab = 'waiting';
        this.edits = [];
        this.overlay = null;
        this.user = null;
        this.list = document.getElementById('review-list');
        this.status = document.getElementById('review-status');
        for (const button of document.querySelectorAll('.review-tabs button')) {
            button.addEventListener('click', () => {
                this.tab = button.dataset.tab;
                this.render();
            });
        }
        new AuthManager().onChange((user, role) => this.setAccount(user, role));
    }

    async setAccount(user, role) {
        this.user = user;
        this.edits = [];
        this.list.replaceChildren();
        if (!user) return this.showStatus('Sign in as an admin on the timeline, then reload this page.');
        if (!permissionsFor(role).isAdmin) return this.showStatus('Only admins can review edits.');
        await this.load();
    }

    async load() {
        try {
            [this.edits, this.overlay] = await Promise.all([this.store.listAll(), this.store.overlay()]);
        } catch (error) {
            console.error('Could not load the edits:', error);
            this.showStatus('Could not load the edits. Reload to try again.');
            return;
        }
        this.showStatus('');
        this.render();
    }

    showStatus(message) {
        this.status.textContent = message;
        this.status.hidden = !message;
    }

    queues() {
        const open = this.edits.filter(edit => REVIEWABLE_STATUSES.includes(edit.status));
        const conflicts = open.filter(edit => conflictingFields(edit, this.overlay).length);
        return { waiting: open.filter(edit => !conflicts.includes(edit)), conflicts, history: this.edits };
    }

    render() {
        const queues = this.queues();
        const counts = { waiting: queues.waiting.length, conflicts: queues.conflicts.length };
        for (const button of document.querySelectorAll('.review-tabs button')) {
            const tab = button.dataset.tab;
            button.setAttribute('aria-selected', String(tab === this.tab));
            button.textContent = `${button.id === 'tab-history' ? 'History' : tab === 'waiting' ? 'Waiting' : 'Conflicts'}${tab in counts ? ` · ${counts[tab]}` : ''}`;
        }
        const share = (overlayBytes(this.overlay ?? {}) / OVERLAY_MAX_BYTES) * 100;
        document.getElementById('review-usage').textContent = `Published changes: ${share > 0 && share < 1 ? 'under 1' : Math.round(share)}% of the limit`;
        const groups = this.byEvent(queues[this.tab]);
        const render = this.tab === 'history' ? (edits) => this.renderHistory(edits) : (edits) => this.renderOpen(edits);
        this.list.replaceChildren(...[...groups.values()].map(render));
        if (!groups.size) {
            const empty = { waiting: 'No edits are waiting for review.', conflicts: 'No edits conflict with published changes.', history: 'No edits yet.' };
            this.list.append(element('p', 'review-empty', empty[this.tab]));
        }
    }

    // Edits grouped by event, oldest first within each, the most recently active event first.
    byEvent(edits) {
        const groups = new Map();
        for (const edit of [...edits].sort((a, b) => millis(a.created_at) - millis(b.created_at))) {
            if (!groups.has(edit.event_id)) groups.set(edit.event_id, []);
            groups.get(edit.event_id).push(edit);
        }
        const latest = (list) => Math.max(...list.map(edit => millis(edit.review?.at) || millis(edit.revised_at)));
        return new Map([...groups].sort(([, a], [, b]) => latest(b) - latest(a)));
    }

    eventCard(edits, countText) {
        const article = element('article', 'review-event');
        const name = edits.at(-1).event_name;
        article.setAttribute('aria-label', `Edits to ${name}`);
        const head = element('div', 'review-event-head');
        head.append(element('h2', '', name));
        if (edits.some(edit => edit.kind === 'create')) head.append(element('span', 'review-chip warn', 'New event'));
        head.append(element('span', 'review-count', countText));
        article.append(head);
        return article;
    }

    author(edit) {
        return edit.author?.uid === this.user?.uid ? 'you' : edit.author?.email ?? 'unknown';
    }

    // --- open edits ---

    renderOpen(edits) {
        const article = this.eventCard(edits, edits.length === 1 ? '1 edit' : `${edits.length} edits`);
        for (const edit of edits) article.append(this.renderOpenEdit(edit));
        return article;
    }

    renderOpenEdit(edit) {
        const block = element('div', 'review-edit');
        block.dataset.editId = edit.edit_id;
        block.append(this.meta(edit));

        const creating = edit.kind === 'create';
        const conflicts = conflictingFields(edit, this.overlay);
        const grid = element('div', creating ? 'review-fields no-select' : 'review-fields');
        const boxes = [];
        for (const [field, change] of Object.entries(edit.changes)) {
            const label = FIELD_LABELS[field] ?? field;
            if (!creating) {
                const box = element('input');
                box.type = 'checkbox';
                box.checked = true;
                box.value = field;
                box.setAttribute('aria-label', `Approve ${label.toLowerCase()} change`);
                boxes.push(box);
                grid.append(box);
            }
            grid.append(element('span', 'review-field-label', label));
            const value = this.change(field, creating ? null : change.before, change.after);
            if (conflicts.includes(field)) {
                const published = publishedValue(this.overlay, edit.event_id, field, change.before);
                value.append(element('p', 'review-conflict',
                    `Published since this edit was written: ${valueText(field, published)}. Approving applies this proposal on top.`));
            }
            grid.append(value);
        }
        block.append(grid);
        this.appendNote(block, edit);

        const error = element('p', 'review-error');
        error.hidden = true;
        const reject = element('div', 'review-reject');
        reject.hidden = true;
        const noteId = `reject-${edit.edit_id}`;
        const noteLabel = element('label', '', 'Reason for the author (they can revise the edit)');
        noteLabel.htmlFor = noteId;
        const note = element('textarea');
        note.id = noteId;
        note.maxLength = 1000;
        reject.append(noteLabel, note);

        const actions = element('div', 'review-actions');
        const rejectButton = element('button', '', 'Reject…');
        rejectButton.type = 'button';
        const approveButton = element('button', 'primary');
        approveButton.type = 'button';
        const label = () => {
            if (creating) return 'Approve new event';
            const n = boxes.filter(box => box.checked).length;
            if (n < boxes.length) return `Approve ${n} of ${boxes.length} changes`;
            return n === 1 ? 'Approve 1 change' : `Approve ${n} changes`;
        };
        approveButton.textContent = label();
        for (const box of boxes) box.addEventListener('change', () => { approveButton.textContent = label(); });
        actions.append(rejectButton, approveButton);
        block.append(reject, error, actions);

        const busy = (on) => [rejectButton, approveButton].forEach(button => button.disabled = on);
        const fail = (message) => {
            error.textContent = message;
            error.hidden = !message;
        };
        rejectButton.addEventListener('click', async () => {
            if (reject.hidden) {
                reject.hidden = false;
                rejectButton.textContent = 'Reject edit';
                note.focus();
                return;
            }
            const reason = note.value.trim();
            if (!reason) return fail('Give the author a reason, so they know what to change.');
            busy(true);
            try {
                await this.store.reject(edit, reason);
            } catch (e) {
                console.error('Could not reject the edit:', e);
                busy(false);
                return fail('Could not reject the edit. Reload and try again.');
            }
            await this.load();
        });
        approveButton.addEventListener('click', async () => {
            const fields = creating ? Object.keys(edit.changes) : boxes.filter(box => box.checked).map(box => box.value);
            if (!fields.length) return fail('Tick at least one change, or reject the edit.');
            busy(true);
            try {
                await this.store.approve(edit, fields);
            } catch (e) {
                console.error('Could not approve the edit:', e);
                busy(false);
                return fail(e.message?.startsWith('This edit changed') || e.message?.startsWith('The published edits are full')
                    ? e.message : 'Could not approve the edit. Reload and try again.');
            }
            await this.load();
        });
        return block;
    }

    meta(edit) {
        const meta = element('div', 'review-meta');
        meta.append(element('span', 'review-author', this.author(edit)), element('span', '', `· ${age(edit.revised_at)}`));
        if (edit.revision > 1) meta.append(element('span', '', `· revision ${edit.revision}`));
        const checks = element('span', 'review-checks');
        for (const check of edit.checks?.browser ?? []) {
            if (check.check === 'wikipedia_article') {
                checks.append(element('span', `review-chip ${check.outcome === 'pass' ? 'pass' : 'warn'}`,
                    check.outcome === 'pass' ? `✓ Article found: ${check.detail}` : `! ${check.detail ?? 'Article not confirmed'}`));
            }
        }
        if (edit.source_conflict) checks.append(element('span', 'review-chip warn', '! The author says a source is wrong'));
        meta.append(checks);
        return meta;
    }

    appendNote(block, edit) {
        if (edit.reason) block.append(element('p', 'review-note', `Note: ${edit.reason}`));
        if (edit.sources?.length) {
            const sources = element('p', 'review-note', 'Sources: ');
            edit.sources.forEach((url, i) => {
                const link = element('a', '', url);
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                sources.append(...(i ? [', ', link] : [link]));
            });
            block.append(sources);
        }
    }

    // One field's before and after: a word diff for text, people and categories as chips.
    change(field, before, after) {
        if (field === 'figures' || field === 'categories') {
            const list = (value) => (field === 'figures' ? normalizeFigures(value) : (value ?? []).map(name => ({ name })));
            const old = list(before);
            const next = list(after);
            const box = element('div', 'review-people');
            for (const person of next) {
                const prior = old.find(p => personKey(p) === personKey(person));
                const linked = person.wikipedia_url && !sameValue(prior?.wikipedia_url ?? null, person.wikipedia_url);
                const chip = element('span', prior && !linked ? 'review-person' : 'review-person added',
                    prior ? (linked ? `${person.name} · now linked` : person.name) : `+ ${person.name}`);
                if (person.wikipedia_url) chip.title = person.wikipedia_url;
                box.append(chip);
            }
            for (const person of old.filter(p => !next.some(n => personKey(n) === personKey(p)))) {
                box.append(element('span', 'review-person removed', person.name));
            }
            return box;
        }
        const p = element('p', 'review-value');
        const runs = field === 'enhanced_description' ? wordDiff(before, after)
            : [{ kind: 'removed', text: before ?? '' }, { kind: 'added', text: after ?? '' }].filter(run => run.text);
        runs.forEach((run, i) => {
            if (i && run.kind !== 'same' && runs[i - 1].kind !== 'same') p.append(' ');
            p.append(run.kind === 'same' ? run.text : element(run.kind === 'removed' ? 'del' : 'ins', '', run.text));
        });
        return p;
    }

    // --- history ---

    renderHistory(edits) {
        const article = this.eventCard(edits, edits.length === 1 ? '1 edit' : `${edits.length} edits`);
        const original = element('div', 'review-edit');
        original.append(element('div', 'review-step-head', edits[0].kind === 'create' ? 'Proposed as a new event' : 'Original values'));
        if (edits[0].kind !== 'create') {
            const grid = element('div', 'review-fields no-select');
            const seen = new Set();
            for (const edit of edits) {
                for (const [field, change] of Object.entries(edit.changes)) {
                    if (seen.has(field)) continue;
                    seen.add(field);
                    grid.append(element('span', 'review-field-label', FIELD_LABELS[field] ?? field),
                        element('p', 'review-value', valueText(field, change.before)));
                }
            }
            original.append(grid);
        }
        article.append(original);
        for (const edit of edits) article.append(this.renderStep(edit));
        return article;
    }

    renderStep(edit) {
        const block = element('div', 'review-edit review-step');
        const head = element('div', 'review-step-head');
        const open = REVIEWABLE_STATUSES.includes(edit.status);
        head.append(element('span', `review-decision ${edit.status}`, open ? 'Waiting' : STATUS_LABELS[edit.status] ?? edit.status),
            element('span', '', `proposed by ${this.author(edit)} · ${age(edit.created_at)}${edit.revision > 1 ? ` · revision ${edit.revision}` : ''}`));
        if (edit.review && !open) {
            const by = edit.review.by?.uid === this.user?.uid ? 'you' : edit.review.by?.email;
            head.append(element('span', '', `· ${edit.review.decision} by ${by} · ${age(edit.review.at)}${edit.review.self_approved ? ' (self-approved)' : ''}`));
        }
        block.append(head);
        for (const earlier of edit.reviews ?? []) {
            block.append(element('p', 'review-note', `Earlier: ${earlier.decision} by ${earlier.by?.email} on revision ${earlier.revision}${earlier.note ? `: ${earlier.note}` : ''}`));
        }
        const grid = element('div', 'review-fields no-select');
        for (const [field, change] of Object.entries(edit.changes)) {
            const disposition = edit.fields?.[field]?.status;
            const label = FIELD_LABELS[field] ?? field;
            grid.append(element('span', 'review-field-label', disposition === 'rejected' && edit.status === 'published' ? `${label} (not approved)` : label),
                this.change(field, edit.kind === 'create' ? null : change.before, change.after));
        }
        block.append(grid);
        if (edit.review?.note) block.append(element('p', 'review-note', `Reviewer's note: ${edit.review.note}`));
        this.appendNote(block, edit);
        const changes = edit.status === 'published' && edit.kind !== 'create' ? revertChanges(edit, this.overlay) : {};
        if (Object.keys(changes).length) {
            const actions = element('div', 'review-actions');
            const error = element('p', 'review-error');
            error.hidden = true;
            const button = element('button', '', 'Revert');
            button.type = 'button';
            button.addEventListener('click', () => this.revert(edit, changes, button, error));
            actions.append(button);
            block.append(error, actions);
        }
        return block;
    }

    // Reverting is an edit like any other (WORLD-EDITS.md, Revert): proposed by this admin with the
    // values from before the approval, then approved, so both steps keep their own records.
    async revert(edit, changes, button, error) {
        if (!confirm(`Revert the approved change to "${edit.event_name}"? Visitors will see the earlier value again.`)) return;
        button.disabled = true;
        const reason = `Reverts edit ${edit.edit_id}.`;
        try {
            const contentSha = await contentSha256({ changes, reason, sources: [], source_conflict: false });
            const editId = newEditId();
            await this.editStore.submit({
                editId, kind: 'update', event: { event_id: edit.event_id, name: edit.event_name }, changes, reason, sources: [],
                sourceConflict: false, datasetSha256: null, contentSha, browserChecks: [{ check: 'format', outcome: 'pass' }],
            });
            await this.store.approve({ edit_id: editId, revision: 1, content_sha256: contentSha }, Object.keys(changes));
        } catch (e) {
            console.error('Could not revert the edit:', e);
            button.disabled = false;
            error.textContent = 'Could not revert the edit. Reload and try again.';
            error.hidden = false;
            return;
        }
        await this.load();
    }
}

new ReviewPage();
