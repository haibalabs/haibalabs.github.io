import { PROMINENT_LABELS } from './config.js';
import { eventProblem } from './timeline-model.js';

export class ModalManager {
    constructor(eventManager, uiManager) {
        this.eventManager = eventManager;
        this.uiManager = uiManager;
        this.modal = document.getElementById('add-event-modal');
        this.form = document.getElementById('add-event-form');
        this.populateCategories();
        this.setupListeners();
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
        document.getElementById('add-event').addEventListener('click', () => this.open());

        document.getElementById('cancel-add').addEventListener('click', () => this.close());

        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    // Opens the form empty to add an event, or filled in to edit a personal event.
    open(event = null) {
        this.editing = event;
        this.form.reset();
        this.showError('');
        this.modal.querySelector('.modal-header h3').textContent = event ? 'Edit event' : 'Add event';
        this.form.querySelector('button[type="submit"]').textContent = event ? 'Save' : 'Add';
        if (event) {
            const location = event.locations?.[0] ?? {};
            const values = {
                name: event.name, enhanced_time: event.enhanced_time,
                enhanced_description: event.enhanced_description, wikipedia_url: event.wikipedia_url,
                categories: event.categories?.[0], location_name: location.name, location_city: location.city,
                location_region: location.region, location_country: location.country,
                location_historical: location.historical_name,
            };
            for (const [name, value] of Object.entries(values)) this.form.elements[name].value = value ?? '';
        }
        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
        this.editing = null;
    }

    showError(message) {
        const error = this.form.querySelector('.form-error');
        error.textContent = message;
        error.hidden = !message;
    }

    async handleSubmit(e) {
        e.preventDefault();

        const formData = new FormData(this.form);
        const location = {
            name: formData.get('location_name'),
            city: formData.get('location_city'),
            region: formData.get('location_region'),
            country: formData.get('location_country'),
            historical_name: formData.get('location_historical')
        };
        const newEvent = {
            name: formData.get('name').trim(),
            enhanced_time: formData.get('enhanced_time').trim(),
            categories: formData.getAll('categories').filter(Boolean),
            // an event without a location stays off the map
            locations: Object.values(location).some(value => value.trim()) ? [location] : [],
            enhanced_description: formData.get('enhanced_description'),
            wikipedia_url: formData.get('wikipedia_url'),
            confidence: 'high'
        };

        const timelineUI = this.uiManager.timelineUI;
        if (timelineUI?.current) {
            const submit = this.form.querySelector('button[type="submit"]');
            submit.disabled = true;
            const problem = await timelineUI.saveEvent(newEvent, this.editing);
            submit.disabled = false;
            if (problem) return this.showError(problem);
        } else {
            const problem = eventProblem(newEvent);
            if (problem) return this.showError(problem);
            this.eventManager.addEvent(newEvent);
            this.uiManager.resetLayout();
        }
        this.close();
        this.form.reset();
    }
}