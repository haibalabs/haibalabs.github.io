// image-field.js
// The image parts both event forms share: an Upload | Link switch and the link input, which reads a
// Commons file's credit and license (image-link.js) and shows the picture with its credit line. The
// personal form pairs the link with its private photo upload (PhotoField in modal-manager.js); the
// world form with WorldUpload below, whose photo is shown only once a reviewer confirms it.
import { creditLine, imageFromLink } from './image-link.js';
import { resizePhoto } from './image-resize.js';
import { sha256Hex } from './world-images.js';
import { UPLOAD_LICENSE, UPLOAD_RIGHTS } from './world-edits.js';

const LINK_CHECK_DELAY_MS = 500;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** An image with its credit line, as both forms and the review page show one. */
export function imageCard(image, { src = image?.image_url, note = '' } = {}) {
    const card = element('div', 'image-card');
    const thumb = element('div', 'image-card-thumb');
    if (src) {
        const img = element('img');
        img.src = src;
        img.alt = image?.caption ?? '';
        img.referrerPolicy = 'no-referrer';
        thumb.append(img);
    }
    const text = element('div', 'image-card-text');
    if (image?.caption) text.append(element('span', 'image-card-caption', image.caption));
    text.append(element('span', 'image-card-credit', creditLine(image) || 'No credit yet'));
    if (note) text.append(element('span', 'image-card-note', note));
    card.append(thumb, text);
    return card;
}

/** The Upload | Link switch: calls onSwitch with the chosen mode. */
export function modeSwitch(onSwitch, initial = 'upload') {
    const seg = element('div', 'mode-switch');
    seg.setAttribute('role', 'tablist');
    const buttons = ['upload', 'link'].map(mode => {
        const b = element('button', '', mode === 'upload' ? 'Upload' : 'Link');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.dataset.mode = mode;
        b.addEventListener('click', () => set(mode));
        return b;
    });
    const set = (mode, silent = false) => {
        for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
        seg.dataset.mode = mode;
        if (!silent) onSwitch(mode);
    };
    seg.append(...buttons);
    seg.set = set;
    set(initial, true);
    return seg;
}

/**
 * A pasted image link, checked as the author types: a Commons file shows its credit and license, any
 * other https link shows "License unknown" and asks where the image is from.
 */
export class ImageLinkInput {
    /**
     * @param {string} idPrefix
     * @param {{ askRights?: boolean, onChange?: () => void, lookup?: typeof imageFromLink }} [options]
     *   askRights asks where a non-Commons image is from (world events)
     */
    constructor(idPrefix, { askRights = false, onChange = () => {}, lookup = imageFromLink } = {}) {
        this.lookup = lookup;
        this.onChange = onChange;
        this.root = element('div', 'image-link');
        this.input = element('input', 'image-link-input');
        this.input.type = 'url';
        this.input.id = `${idPrefix}-link`;
        this.input.placeholder = 'commons.wikimedia.org/wiki/File:… or another https:// image link';
        this.input.setAttribute('aria-label', 'Image link');
        this.status = element('p', 'image-link-status');
        this.status.setAttribute('role', 'status');
        this.status.hidden = true;
        this.preview = element('div', 'image-link-preview');
        this.rights = element('div', 'form-subgroup');
        this.rights.hidden = true;
        const rightsLabel = element('label', '', 'Where it is from, and why it may be used ');
        rightsLabel.append(element('span', 'optional', '(helps the reviewer)'));
        this.rightsInput = element('input');
        this.rightsInput.type = 'text';
        this.rightsInput.id = `${idPrefix}-rights`;
        this.rightsInput.maxLength = 1000;
        this.rightsInput.placeholder = 'e.g. press photo, CC BY 2.0 on Flickr, my own photo';
        rightsLabel.htmlFor = this.rightsInput.id;
        this.rights.append(rightsLabel, this.rightsInput);
        this.askRights = askRights;
        this.root.append(this.input, this.status, this.preview, this.rights);
        this.input.addEventListener('input', () => this.schedule());
        this.rightsInput.addEventListener('input', () => onChange());
        this.result = null;
        this.check = null;
    }

    set(link = '', rightsNote = '') {
        clearTimeout(this.timer);
        this.input.value = link;
        this.rightsInput.value = rightsNote;
        this.result = null;
        this.check = null;
        this.status.hidden = true;
        this.preview.replaceChildren();
        this.rights.hidden = true;
        if (link) this.schedule(0);
    }

    schedule(delay = LINK_CHECK_DELAY_MS) {
        clearTimeout(this.timer);
        const text = this.input.value.trim();
        this.result = null;
        this.preview.replaceChildren();
        this.rights.hidden = true;
        if (!text) {
            this.status.hidden = true;
            this.check = null;
            this.onChange();
            return;
        }
        this.check = new Promise(resolve => {
            this.timer = setTimeout(async () => resolve(await this.lookup(text)), delay);
        }).then(result => {
            if (this.input.value.trim() !== text) return { stale: true };
            this.show(result);
            return result;
        });
        this.onChange();
    }

    show(result) {
        this.result = result;
        this.status.hidden = false;
        this.status.classList.toggle('problem', !result.ok);
        this.status.classList.toggle('ok', result.ok && result.image.source === 'commons');
        if (!result.ok) {
            this.status.textContent = result.problem;
        } else if (result.image.source === 'commons') {
            this.status.textContent = `✓ Found on Wikimedia Commons${result.image.license_name ? ` · ${result.image.license_name}` : ''}`;
        } else {
            this.status.textContent = this.askRights
                ? 'License unknown: a reviewer checks it before the image is shown.'
                : 'Shown from that site; if it moves or disappears, the image goes too.';
        }
        this.preview.replaceChildren(...(result.ok ? [imageCard(result.image)] : []));
        this.rights.hidden = !(this.askRights && result.ok && result.image.source === 'link');
        this.onChange();
    }

    /** The checked image record, waiting for a check still running; null when there is no link. */
    async image() {
        if (!this.input.value.trim()) return { ok: true, image: null };
        const result = await (this.check ?? this.lookup(this.input.value.trim()));
        if (result.stale) return this.image();
        if (!result.ok) return result;
        const image = { ...result.image };
        if (image.source === 'link' && this.askRights) image.rights_statement = this.rightsInput.value.trim() || null;
        return { ok: true, image };
    }
}

/**
 * A photo uploaded for a world event: resized as personal photos are, with the credit and the
 * uploader's grant (Rachid, 2026-10-27). The file is stored privately with the edit and becomes
 * public only if a reviewer approves it (edit-uploads.js).
 */
export class WorldUpload {
    /**
     * @param {string} idPrefix
     * @param {{ onChange?: () => void, onError?: (message: string) => void, resize?: typeof resizePhoto }} [options]
     */
    constructor(idPrefix, { onChange = () => {}, onError = () => {}, resize = resizePhoto } = {}) {
        this.resize = resize;
        this.onChange = onChange;
        this.onError = onError;
        this.root = element('div', 'world-upload');
        this.file = element('input');
        this.file.type = 'file';
        this.file.id = `${idPrefix}-file`;
        this.file.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
        this.file.setAttribute('aria-label', 'Photo to upload');
        this.preview = element('div', 'image-link-preview');
        const creditLabel = element('label', '', 'Credit');
        this.credit = element('input');
        this.credit.type = 'text';
        this.credit.id = `${idPrefix}-credit`;
        this.credit.maxLength = 300;
        this.credit.placeholder = 'Who took the photo';
        creditLabel.htmlFor = this.credit.id;
        const rightsRow = element('label', 'checkbox-row');
        this.rights = element('input');
        this.rights.type = 'checkbox';
        this.rights.id = `${idPrefix}-grant`;
        rightsRow.append(this.rights, ` ${UPLOAD_RIGHTS}`);
        const creditGroup = element('div', 'form-subgroup');
        creditGroup.append(creditLabel, this.credit);
        this.root.append(this.file, this.preview, creditGroup, rightsRow);
        this.file.addEventListener('change', () => this.choose(this.file.files[0]));
        for (const input of [this.credit, this.rights]) input.addEventListener('input', () => onChange());
        this.reset();
    }

    reset() {
        this.ticket = (this.ticket ?? 0) + 1;
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
        this.resized = null;
        this.pending = Promise.resolve();
        this.file.value = '';
        this.credit.value = '';
        this.rights.checked = false;
        this.preview.replaceChildren();
    }

    choose(file) {
        if (!file) return;
        const ticket = ++this.ticket;
        this.pending = this.resize(file).then(async (resized) => {
            if (ticket !== this.ticket) return;
            const sha256 = await sha256Hex(new Uint8Array(await resized.full.arrayBuffer()));
            if (ticket !== this.ticket) return;
            if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
            this.resized = { ...resized, sha256 };
            this.objectUrl = URL.createObjectURL(resized.thumb);
            this.preview.replaceChildren(imageCard({ source: 'upload', credit: this.credit.value, license_name: UPLOAD_LICENSE }, { src: this.objectUrl, note: 'Stored privately with your edit until a reviewer approves it.' }));
            this.onChange();
        }, (error) => {
            if (ticket !== this.ticket) return;
            this.file.value = '';
            this.onError(error.message);
        });
        return this.pending;
    }

    /** The chosen photo, resized, with its credit and whether the grant is ticked; null when none was chosen. */
    async settled() {
        let pending;
        do {
            pending = this.pending;
            await pending;
        } while (pending !== this.pending);
        return this.resized ? { resized: this.resized, credit: this.credit.value.trim(), granted: this.rights.checked } : null;
    }
}
