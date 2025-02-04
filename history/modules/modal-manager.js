import { PROMINENT_LABELS } from './config.js'; 

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
        document.getElementById('add-event').addEventListener('click', () => {
            this.modal.style.display = 'flex';
        });

        document.getElementById('cancel-add').addEventListener('click', () => {
            this.modal.style.display = 'none';
        });

        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    handleSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(this.form);
        const newEvent = {
            name: formData.get('name'),
            enhanced_time: formData.get('enhanced_time'),
            categories: Array.from(formData.getAll('categories')),
            locations: [{
                name: formData.get('location_name'),
                city: formData.get('location_city'),
                region: formData.get('location_region'),
                country: formData.get('location_country'),
                historical_name: formData.get('location_historical')
            }],
            enhanced_description: formData.get('enhanced_description'),
            wikipedia_url: formData.get('wikipedia_url'),
            confidence: 'high'
        };

        this.eventManager.addEvent(newEvent);
        this.uiManager.resetLayout();
        this.modal.style.display = 'none';
        this.form.reset();
    }
}