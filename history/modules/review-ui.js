// review-ui.js
// The admin review page (WORLD-EDITS.md, Admin review page): open edits grouped by event, each
// field's before and after, Approve (every field or the ticked ones) and Reject with a reason the
// author sees; Conflicts, where another approval has changed a field since the edit was written;
// and History, every edit of each event from its original values on, with Revert. Review is by
// hand: there is no automatic checker yet (phase 3). Identities appear only here, to admins; what
// approval publishes names no one.
import { AuthManager } from './auth-manager.js';
import { EditStore } from './edit-store.js';
import { EditUploads } from './edit-uploads.js';
import { EventManager } from './event-manager.js';
import { imageCard } from './image-field.js';
import { commonsImage, creditLine } from './image-link.js';
import { miniMap, pointNote } from './location-picker.js';
import { ReviewStore } from './review-store.js';
import { permissionsFor } from './roles.js';
import {
    conflictingFields, contentSha256, fieldLabel, FLAG_OWNERS, FLAG_PART_LABELS, FLAG_STATUS_LABELS, flagExport,
    imageNeedsConfirmation, isFlag, locationIndex, locationText, newEditId, normalizeFigures, OVERLAY_MAX_BYTES, overlayBytes,
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
    if (locationIndex(field) !== null) return value ? locationText(value) : '(none)';
    if (field === 'image') return value ? value.caption ?? value.image_url ?? 'an uploaded photo' : '(none)';
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
        this.uploads = new EditUploads(events.firebaseApp, { emulator: events.usesEmulators });
        // reads a Commons file's license again for the review (image-link.js)
        this.commonsLookup = (link) => commonsImage(link);
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
        // Coming back to this tab (an edit or flag sent from the timeline meanwhile) reads the edits again, unless
        // a decision is being typed here.
        this.reviewing = false;
        this.typed = false;
        this.list.addEventListener('input', () => { this.typed = true; });
        const reread = () => { if (this.reviewing && !this.typed) this.load(); };
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reread(); });
        addEventListener('pageshow', event => { if (event.persisted) reread(); });
    }

    async setAccount(user, role) {
        this.user = user;
        this.edits = [];
        this.reviewing = false;
        this.list.replaceChildren();
        if (!user) return this.showStatus('Sign in as an admin on the timeline, then reload this page.');
        if (!permissionsFor(role).isAdmin) return this.showStatus('Only admins can review edits.');
        this.reviewing = true;
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
        const edits = this.edits.filter(edit => !isFlag(edit));
        const open = edits.filter(edit => REVIEWABLE_STATUSES.includes(edit.status));
        const conflicts = open.filter(edit => conflictingFields(edit, this.overlay).length);
        const flags = this.edits.filter(edit => isFlag(edit) && edit.status !== 'withdrawn');
        return { waiting: open.filter(edit => !conflicts.includes(edit)), conflicts, flags, history: edits };
    }

    render() {
        this.typed = false;
        const queues = this.queues();
        const counts = { waiting: queues.waiting.length, conflicts: queues.conflicts.length,
            flags: queues.flags.filter(flag => flag.status === 'open').length };
        const labels = { waiting: 'Waiting', conflicts: 'Conflicts', flags: 'Flags', history: 'History' };
        for (const button of document.querySelectorAll('.review-tabs button')) {
            const tab = button.dataset.tab;
            button.setAttribute('aria-selected', String(tab === this.tab));
            button.textContent = `${labels[tab]}${tab in counts ? ` · ${counts[tab]}` : ''}`;
        }
        const share = (overlayBytes(this.overlay ?? {}) / OVERLAY_MAX_BYTES) * 100;
        document.getElementById('review-usage').textContent = `Published changes: ${share > 0 && share < 1 ? 'under 1' : Math.round(share)}% of the limit`;
        if (this.tab === 'flags') return this.renderFlags(queues.flags);
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

    // --- quick flags (WORLD-EDITS.md, Quick flags) ---

    // Open flags first, newest first; then the closed ones. Each says what was flagged, what the editor saw
    // and who owns it. Export saves the open ones as a file for the team.
    renderFlags(flags) {
        const open = flags.filter(flag => flag.status === 'open').sort((a, b) => millis(b.created_at) - millis(a.created_at));
        const closed = flags.filter(flag => flag.status !== 'open').sort((a, b) => millis(b.review?.at) - millis(a.review?.at));
        const bar = element('div', 'review-actions review-flags-bar');
        bar.append(element('p', 'review-flags-note', 'Each flag goes to the team member who owns that part. Export saves the open ones as a file for them.'));
        const exportButton = element('button', '', 'Export open flags');
        exportButton.type = 'button';
        exportButton.disabled = !open.length;
        exportButton.addEventListener('click', () => this.exportFlags(open));
        bar.append(exportButton);
        this.list.replaceChildren(bar, ...[...open, ...closed].map(flag => this.renderFlag(flag)));
        if (!flags.length) this.list.append(element('p', 'review-empty', 'No flags yet.'));
    }

    renderFlag(flag) {
        const article = element('article', `review-event review-flag ${flag.status}`);
        article.setAttribute('aria-label', `Flag on ${flag.event_name}`);
        const head = element('div', 'review-event-head');
        head.append(element('h2', '', flag.event_name));
        for (const part of flag.flag.parts) head.append(element('span', 'review-chip flag', FLAG_PART_LABELS[part] ?? part));
        head.append(element('span', `review-count flag-status ${flag.status}`, FLAG_STATUS_LABELS[flag.status] ?? flag.status));
        article.append(head);
        const body = element('div', 'review-edit');
        const seen = element('dl', 'review-flag-seen');
        for (const part of flag.flag.parts) {
            const value = flag.flag.seen?.[part];
            seen.append(element('dt', '', `${FLAG_PART_LABELS[part] ?? part} shown`),
                element('dd', '', Array.isArray(value) ? value.join('; ') || '(none)' : value ?? '(none)'));
        }
        body.append(seen);
        if (flag.flag.note) body.append(element('p', 'review-note', flag.flag.note));
        const owners = [...new Set(flag.flag.parts.map(part => FLAG_OWNERS[part]))].join(', ');
        body.append(element('p', 'review-meta', `From ${this.author(flag)} · ${age(flag.created_at)} · goes to ${owners}`));
        article.append(body);
        if (flag.status === 'open') {
            const actions = element('div', 'review-actions');
            for (const [label, decision, primary] of [['Mark fixed', 'fixed', true], ['Dismiss', 'dismissed', false]]) {
                const button = element('button', primary ? 'primary' : '', label);
                button.type = 'button';
                button.addEventListener('click', () => this.resolveFlag(flag, decision, button));
                actions.append(button);
            }
            body.append(actions);
        } else if (flag.review) {
            body.append(element('p', 'review-meta', `${FLAG_STATUS_LABELS[flag.status]} by ${flag.review.by?.uid === this.user?.uid ? 'you' : flag.review.by?.email ?? 'an admin'} · ${age(flag.review.at)}`));
        }
        return article;
    }

    async resolveFlag(flag, decision, button) {
        button.disabled = true;
        try {
            await this.store.resolveFlag(flag, decision);
        } catch (error) {
            console.error('Could not update the flag:', error);
            this.showStatus('Could not update the flag. Reload to try again.');
            button.disabled = false;
            return;
        }
        await this.load();
    }

    exportFlags(open) {
        const exportedAt = new Date().toISOString();
        const blob = new Blob([`${JSON.stringify(flagExport(open, exportedAt), null, 2)}\n`], { type: 'application/json' });
        const link = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: `historiline-flags-${exportedAt.slice(0, 10)}.json`,
        });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 0);
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
        let confirmation = null;
        let imageBox = null;
        for (const [field, change] of Object.entries(edit.changes)) {
            const label = fieldLabel(field);
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
            if (field === 'image') imageBox = value;
            if (field === 'image' && imageNeedsConfirmation(change.after)) {
                confirmation = this.licenseConfirmation(edit, change.after);
                value.append(confirmation.root);
            }
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
        // a new event whose image's license isn't confirmed can still be published without it
        const withoutImage = element('button', '', 'Approve without image');
        withoutImage.type = 'button';
        withoutImage.hidden = !(creating && confirmation);
        const approveButton = element('button', 'primary');
        approveButton.type = 'button';
        const imageTicked = () => (creating ? 'image' in edit.changes : boxes.some(box => box.value === 'image' && box.checked));
        const label = () => {
            if (creating) return 'Approve new event';
            const n = boxes.filter(box => box.checked).length;
            if (n < boxes.length) return `Approve ${n} of ${boxes.length} changes`;
            return n === 1 ? 'Approve 1 change' : `Approve ${n} changes`;
        };
        // A Commons image's license is read from Commons again, since the author's browser wrote the record;
        // Approve waits for that, and for the reviewer's check and a credit when the image needs them.
        let commonsCheck = 'none';
        const imageAfter = edit.changes.image?.after;
        const refresh = () => {
            approveButton.textContent = label();
            approveButton.disabled = imageTicked() && (commonsCheck === 'pending' || Boolean(confirmation && !confirmation.ready()));
            approveButton.title = approveButton.disabled
                ? (commonsCheck === 'pending' ? 'Checking the image license on Wikimedia Commons…' : 'Confirm the image license and its credit first, or leave the image out.')
                : '';
        };
        let commonsRecord = null;
        if (imageAfter && !confirmation) {
            commonsCheck = 'pending';
            const status = element('p', 'review-commons-check', 'Checking the license on Wikimedia Commons…');
            imageBox.append(status);
            this.commonsLookup(imageAfter.source_url).then((result) => {
                // what is published is Commons' own record for the file the page names: its URL, credit and
                // license, never the author's, who could pair one file's page with another file's URL
                if (result.ok) {
                    commonsRecord = result.image;
                    imageBox.append(element('p', 'review-commons-record', `Publishes Commons' file and credit: ${creditLine(result.image)}`));
                }
                const confirmed = result.ok && result.image.license_name === imageAfter.license_name && !imageNeedsConfirmation(result.image);
                commonsCheck = confirmed ? 'ok' : 'differs';
                status.classList.toggle('ok', confirmed);
                status.textContent = confirmed ? `✓ Commons confirms ${result.image.license_name}`
                    : result.ok ? `Commons says the license is ${result.image.license_name || 'not given'}, not ${imageAfter.license_name}.` : result.problem;
                if (!confirmed) {
                    // what Commons says now goes in the reviewer's check, not what the edit claimed
                    confirmation = this.licenseConfirmation(edit, result.ok
                        ? { ...imageAfter, credit: result.image.credit, license_name: result.image.license_name, license_url: result.image.license_url }
                        : imageAfter);
                    imageBox.append(confirmation.root);
                    confirmation.onChange(refresh);
                    withoutImage.hidden = !creating;
                }
                refresh();
            });
        }
        refresh();
        for (const box of boxes) box.addEventListener('change', refresh);
        confirmation?.onChange(refresh);
        actions.append(rejectButton, withoutImage, approveButton);
        block.append(reject, error, actions);

        const busy = (on) => {
            [rejectButton, withoutImage, approveButton].forEach(button => button.disabled = on);
            if (!on) refresh();
        };
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
        const approve = async ({ dropImage = false } = {}) => {
            const fields = creating ? Object.keys(edit.changes) : boxes.filter(box => box.checked).map(box => box.value);
            if (!fields.length) return fail('Tick at least one change, or reject the edit.');
            busy(true);
            fail('');
            try {
                const values = {};
                if (dropImage) values.image = null;
                else if (fields.includes('image') && edit.changes.image?.after) values.image = await this.publishedImage(edit, confirmation, commonsRecord);
                await this.store.approve(edit, fields, '', values);
            } catch (e) {
                console.error('Could not approve the edit:', e);
                busy(false);
                return fail(e.message?.startsWith('This edit changed') || e.message?.startsWith('The published edits are full')
                    ? e.message : 'Could not approve the edit. Reload and try again.');
            }
            await this.load();
        };
        approveButton.addEventListener('click', () => approve());
        withoutImage.addEventListener('click', () => approve({ dropImage: true }));
        return block;
    }

    /**
     * The confirmation an image with no known free license needs before it is published: the reviewer
     * ticks that it may be shown and gives the credit and license as published (Rachid, 2026-10-31).
     */
    licenseConfirmation(edit, image) {
        const root = element('div', 'review-license');
        const id = `license-${edit.edit_id}`;
        const check = element('label', 'checkbox-row');
        const box = element('input');
        box.type = 'checkbox';
        box.id = `${id}-ok`;
        check.append(box, ' I checked the license: this image may be published with the credit below');
        const field = (key, label, value, placeholder) => {
            const wrap = element('label', 'review-license-field');
            const input = element('input');
            input.type = 'text';
            input.id = `${id}-${key}`;
            input.value = value ?? '';
            input.placeholder = placeholder;
            wrap.append(element('span', '', label), input);
            root.append(wrap);
            return input;
        };
        root.append(check);
        const credit = field('credit', 'Credit', image.credit, 'e.g. Jane Doe');
        const license = field('license', 'License', image.license_name, 'e.g. CC BY 2.0, or Used with permission');
        const licenseUrl = field('license-url', 'License link (optional)', image.license_url, 'https://…');
        const listeners = [];
        for (const input of [box, credit, license, licenseUrl]) input.addEventListener('input', () => listeners.forEach(fn => fn()));
        return {
            root,
            onChange: (fn) => listeners.push(fn),
            ready: () => box.checked && Boolean(credit.value.trim()) && Boolean(license.value.trim()),
            values: () => ({ credit: credit.value.trim(), license_name: license.value.trim(), license_url: licenseUrl.value.trim() || null }),
        };
    }

    /**
     * The image record to publish: for a Commons image, Commons' own record for its file (URL, page,
     * credit, license) with the author's caption, date and role; then the reviewer's credit and license
     * where they had to confirm it; and for an upload, the URL of its public copy, made before the
     * approval is written.
     */
    async publishedImage(edit, confirmation, commons = null) {
        const proposed = edit.changes.image.after;
        const fromCommons = commons
            ? { source: 'commons', image_url: commons.image_url, source_url: commons.source_url, file_page: commons.file_page,
                credit: commons.credit, license_name: commons.license_name, license_url: commons.license_url, rights_statement: commons.rights_statement }
            : {};
        const image = { ...proposed, ...fromCommons, ...(confirmation ? confirmation.values() : {}) };
        if (image.source === 'upload') image.image_url = await this.uploads.publish(edit, image.asset);
        return image;
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

    // A place as the review page shows it: its small map, its text, and what its point stands for.
    placeCard(location, kind) {
        const card = element('div', `review-place ${kind}`);
        const meta = element('div', 'review-place-meta');
        meta.append(element(kind === 'removed' ? 'del' : 'span', 'review-place-label', locationText(location) || '(unnamed place)'),
            element('span', 'review-place-note', [pointNote(location), location.place_id ? 'identified place' : location.wikidata ? `Wikidata ${location.wikidata}` : 'entered by hand'].join(' · ')));
        card.append(miniMap(location, 'loc-map'), meta);
        return card;
    }

    // An image as the review page shows it; a private upload is loaded through the admin's session.
    imageReview(image, kind) {
        const card = imageCard(image, { src: image.source === 'upload' ? null : image.image_url, note: image.rights_statement ?? '' });
        card.classList.add(kind);
        if (image.source === 'upload' && image.asset?.path) {
            this.uploads.objectUrl(image.asset.path).then((url) => {
                const img = element('img');
                img.src = url;
                img.alt = image.caption ?? '';
                card.querySelector('.image-card-thumb').append(img);
            }, (error) => console.error('Could not load the uploaded photo:', error));
        }
        return card;
    }

    // One field's before and after: a word diff for text, people and categories as chips, places and images as cards.
    change(field, before, after) {
        if (locationIndex(field) !== null || field === 'image') {
            const box = element('div', 'review-media');
            const card = (value, kind) => (field === 'image' ? this.imageReview(value, kind) : this.placeCard(value, kind));
            if (before) box.append(card(before, after ? 'before' : 'removed'));
            if (after) box.append(card(after, 'added'));
            if (!before && !after) box.append(element('p', 'review-value', '(none)'));
            return box;
        }
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
                    grid.append(element('span', 'review-field-label', fieldLabel(field)),
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
            const label = fieldLabel(field);
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
