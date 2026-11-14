import { PROMINENT_LABELS } from './config.js';
import { ImageLinkInput, modeSwitch } from './image-field.js';
import { resizePhoto } from './image-resize.js';
import { LocationPicker } from './location-picker.js';
import { toEventLocation } from './world-edits.js';

// The event form's photo field, shown only in forms for a personal timeline (one photo per event;
// see history-dp docs/site/PERSONAL-IMAGES.md). A chosen file is resized right away, so the preview shows what will be
// stored. choice is what saving does with the photo: keep it, remove it, or add the resized one.
// Resizing is asynchronous: each reset, removal and new choice takes a new ticket, and a resize
// result applies only if its ticket is still the latest, so a slow resize never lands in a form
// that was reopened or discarded, never overrides a newer choice and never undoes a removal.
export class PhotoField {
    /**
     * @param {HTMLElement} root - the field's container (#photo-group)
     * @param {{ images: () => import('./personal-images.js').PersonalImages, onError: (message: string) => void,
     *     resize?: (file: Blob) => Promise<object> }} hooks - resize defaults to resizePhoto
     */
    constructor(root, hooks) {
        this.root = root;
        this.hooks = hooks;
        this.resize = hooks.resize ?? resizePhoto;
        this.input = root.querySelector('input[type="file"]');
        this.preview = root.querySelector('.photo-preview');
        this.previewImg = this.preview.querySelector('img');
        this.removeButton = root.querySelector('.photo-remove');
        this.ticket = 0;
        this.choice = { action: 'keep' };
        this.pending = Promise.resolve();
        this.input.addEventListener('change', () => this.choose(this.input.files[0]));
        this.removeButton.addEventListener('click', () => this.remove());
    }

    // Shows the field (or hides it for world events), with the event's current photo if any.
    reset(visible, event = null) {
        this.ticket++;
        this.pending = Promise.resolve();
        this.release();
        this.choice = { action: 'keep' };
        this.root.hidden = !visible;
        this.input.value = '';
        const thumb = visible ? event?.image?.thumb_ref : null;
        if (!thumb) return this.showPreview(null);
        // TimelineUI fills an img carrying data-photo-ref when the thumbnail loads
        this.previewImg.dataset.photoRef = thumb;
        this.showPreview(this.hooks.images().url(thumb));
    }

    choose(file) {
        if (!file) return;
        const ticket = ++this.ticket;
        this.pending = this.resize(file).then((resized) => {
            if (ticket !== this.ticket) return;
            this.release();
            this.choice = { action: 'add', resized };
            this.objectUrl = URL.createObjectURL(resized.thumb);
            this.showPreview(this.objectUrl);
        }, (error) => {
            if (ticket !== this.ticket) return;
            this.input.value = '';
            this.hooks.onError(error.message);
        });
        return this.pending;
    }

    remove() {
        this.ticket++;
        this.pending = Promise.resolve();
        this.release();
        this.choice = { action: 'remove' };
        this.input.value = '';
        this.showPreview(null);
    }

    // The current choice, once the latest resize (if any) has finished.
    async settled() {
        let pending;
        do {
            pending = this.pending;
            await pending;
        } while (pending !== this.pending);
        return this.choice;
    }

    showPreview(url) {
        this.preview.hidden = !url && !this.previewImg.dataset.photoRef;
        this.removeButton.hidden = this.preview.hidden;
        if (url) this.previewImg.src = url;
        else this.previewImg.removeAttribute('src');
        this.preview.classList.toggle('loading', !url);
    }

    // Revokes the preview of a newly chosen photo and stops tracking the event's stored one.
    release() {
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
        delete this.previewImg.dataset.photoRef;
    }
}

export class ModalManager {
    /**
     * @param {object} eventManager
     * @param {object} uiManager
     * @param {{ placeSearch: import('./place-search.js').PlaceSearch }} services
     */
    constructor(eventManager, uiManager, { placeSearch }) {
        this.eventManager = eventManager;
        this.uiManager = uiManager;
        this.modal = document.getElementById('add-event-modal');
        this.form = document.getElementById('add-event-form');
        const photoGroup = document.getElementById('photo-group');
        this.photoField = new PhotoField(photoGroup, {
            images: () => uiManager.timelineUI.images,
            onError: (message) => this.showError(message),
        });
        // Upload keeps a private copy; Link shows the image from where it is, with its credit when it's on Commons
        this.imageLink = new ImageLinkInput('add-img');
        photoGroup.querySelector('.photo-link-pane').append(this.imageLink.root);
        this.photoMode = modeSwitch(mode => this.showPhotoPane(mode));
        photoGroup.querySelector('.photo-mode').append(this.photoMode);
        this.locations = new LocationPicker(document.getElementById('add-locations'), { search: placeSearch, idPrefix: 'add-loc' });
        this.populateCategories();
        this.setupListeners();
    }

    showPhotoPane(mode) {
        this.photoMode.set(mode, true);
        const group = document.getElementById('photo-group');
        group.querySelector('.photo-upload-pane').hidden = mode !== 'upload';
        group.querySelector('.photo-link-pane').hidden = mode !== 'link';
    }

    populateCategories() {
        const select = this.form.querySelector('select[name="categories"]');
        select.innerHTML = '<option value="">Select a category (optional)</option>';
        
        PROMINENT_LABELS.forEach(label => {
            if (label.name !== 'all') {
                const option = document.createElement('option');
                option.value = label.name;
                option.textContent = label.name.charAt(0).toUpperCase() + label.name.slice(1);
                select.appendChild(option);
            }
        });
    }

    setupListeners() {

        document.getElementById('cancel-add').addEventListener('click', () => this.close());

        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    // Opens the form empty to add an event, or filled in to edit a personal event.
    // The destination is fixed here: a form opened for a personal timeline never saves anywhere
    // else, and is discarded if that timeline closes or the account changes.
    open(event = null) {
        this.editing = event;
        this.target = this.uiManager.timelineUI?.formTarget() ?? null;
        this.form.reset();
        this.showError('');
        this.modal.querySelector('.modal-header h3').textContent = event ? 'Edit event' : 'Add event';
        this.form.querySelector('button[type="submit"]').textContent = event ? 'Save' : 'Add';
        if (event) {
            const values = {
                name: event.name, enhanced_time: event.enhanced_time,
                enhanced_description: event.enhanced_description, wikipedia_url: event.wikipedia_url,
                categories: event.categories?.[0],
            };
            for (const [name, value] of Object.entries(values)) this.form.elements[name].value = value ?? '';
        } else if (this.target) {
            // a new event in a personal timeline starts as People; the user can change it
            this.form.elements.categories.value = 'people';
        }
        this.locations.set(event?.locations ?? []);
        this.photoField.reset(Boolean(this.target), event);
        // an event shown from a link reopens on its link
        const preview = event?.image_url && !event.image ? event.image_preview ?? {} : null;
        this.imageLink.set(preview ? (preview.source === 'commons' ? preview.source_url : event.image_url) : '');
        this.showPhotoPane(preview ? 'link' : 'upload');
        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
        this.editing = null;
        this.target = null;
        this.photoField.reset(false);
    }

    // Closes and empties a form opened for a personal timeline, so its private fields go nowhere.
    discardPersonal() {
        if (!this.target) return;
        this.close();
        this.form.reset();
    }

    showError(message) {
        const error = this.form.querySelector('.form-error');
        error.textContent = message;
        error.hidden = !message;
    }

    /**
     * What saving does with the image: the upload pane's choice (keep, remove, add a photo), or a link
     * ({ action: 'link', image }), or removing the link when its box was emptied.
     */
    async imageChoice() {
        if (this.photoMode.dataset.mode === 'upload') return this.photoField.settled();
        if (!this.imageLink.input.value.trim()) {
            return this.editing?.image_url && !this.editing.image ? { action: 'remove' } : this.photoField.settled();
        }
        const result = await this.imageLink.image();
        return result.ok ? { action: 'link', image: result.image } : { problem: result.problem };
    }

    async handleSubmit(e) {
        e.preventDefault();

        const formData = new FormData(this.form);
        const newEvent = {
            name: formData.get('name').trim(),
            enhanced_time: formData.get('enhanced_time').trim(),
            categories: formData.getAll('categories').filter(Boolean),
            // a picked place has a point and shows on the map; one entered by hand doesn't
            locations: this.locations.values().filter(Boolean).map(location => toEventLocation(location, 'personal')),
            enhanced_description: formData.get('enhanced_description'),
            wikipedia_url: formData.get('wikipedia_url'),
            confidence: 'high'
        };

        const target = this.target;
        if (target) {
            // the form stays open, and stays this form, until the save settles
            const buttons = this.form.querySelectorAll('.modal-actions button');
            buttons.forEach(button => button.disabled = true);
            let problem;
            try {
                const photo = await this.imageChoice();
                if (photo.problem) problem = photo.problem;
                else problem = await this.uiManager.timelineUI.saveEvent({ ...newEvent, photo }, this.editing, target);
            } finally {
                buttons.forEach(button => button.disabled = false);
            }
            // discarded while saving (timeline closed or account changed): leave the form alone
            if (this.target !== target) return;
            if (problem) return this.showError(problem);
        } else {
            // world events are proposed through Suggest an edit, not added here
            return this.showError('Open one of your timelines to add an event.');
        }
        this.close();
        this.form.reset();
    }
}