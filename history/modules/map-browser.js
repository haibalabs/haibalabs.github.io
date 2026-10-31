const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
};
const button = (text, action) => {
    const node = element('button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
};

// The button under + / − that lets the map fill the window; Esc or the button returns.
const fullWindowControl = () => new (L.Control.extend({
    options: { position: 'topleft' },
    onAdd(map) {
        const bar = L.DomUtil.create('div', 'leaflet-bar map-full-control');
        this.link = L.DomUtil.create('a', '', bar);
        this.link.href = '#';
        this.link.setAttribute('role', 'button');
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(this.link, 'click', e => { L.DomEvent.preventDefault(e); this.set(!this.full); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.full) this.set(false); });
        this.map = map;
        this.full = false;
        this.render();
        return bar;
    },
    set(full) {
        this.full = full;
        document.body.classList.toggle('map-full', full);
        this.render();
        requestAnimationFrame(() => this.map.invalidateSize({ pan: false }));
    },
    render() {
        const label = this.full ? 'Exit full window' : 'Fill the window';
        this.link.title = label;
        this.link.setAttribute('aria-label', label);
        this.link.innerHTML = `<i class="fa-light ${this.full ? 'fa-compress' : 'fa-expand'}" aria-hidden="true"></i>`;
    },
}))();

export class MapBrowser {
    constructor(manager, ui, panels) {
        this.manager = manager;
        this.ui = ui;
        this.panels = panels;
        this.map = panels.map;
        // The header establishes the panel height after Leaflet first initializes.
        this.map.invalidateSize({ pan: true, animate: false });
        this.selectedId = null;
        this.lastEvents = null;
        this.selection = panels.markersLayer;
        this.fullWindow = fullWindowControl().addTo(this.map);
        const controls = element('section', null, 'map-browser');
        controls.setAttribute('aria-label', 'Map area filter');
        const actions = element('div', null, 'map-actions');
        actions.append(button('Filter by visible area', () => {
            this.map.invalidateSize({ pan: true, animate: false });
            const bounds = this.map.getBounds();
            this.applyGeography({ bounds: { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() } });
        }));
        this.clear = button('Clear', () => this.applyGeography({}));
        this.clear.setAttribute('aria-label', 'Clear area filter');
        this.clear.hidden = true;
        actions.append(this.clear);
        this.status = element('p', null, 'map-status');
        this.status.setAttribute('role', 'status');
        controls.append(actions, this.status);
        panels.mapPanel.append(controls);
    }
    applyGeography(filter) {
        this.manager.setGeographicFilter(filter);
        if (this.areaOutline) this.map.removeLayer(this.areaOutline);
        this.areaOutline = null;
        if (filter.bounds) {
            const { south, north, west, east } = filter.bounds;
            this.areaOutline = L.rectangle([[south, west], [north, east]], { color: '#9b783f', weight: 1, fill: false, interactive: false }).addTo(this.map);
        }
        // Area filtering changes the timeline and never adds unrelated map points.
        // Keep the selection if it still matches; refresh clears it otherwise.
        this.ui.timelineContainer.scrollTop = 0;
        this.ui.resetWindow();
    }
    refresh(events) {
        const index = this.manager.placeIndex;
        if (events === this.lastEvents && index === this.lastIndex) return;
        const indexChanged = index !== this.lastIndex;
        this.lastEvents = events;
        this.lastIndex = index;
        if (this.selectedId && !events.some(event => index.idFor(event) === this.selectedId)) {
            this.selectedId = null;
            this.selection.clearLayers();
        } else if (this.selectedId && indexChanged) {
            this.drawSelection();
        }
        const filter = this.manager.geographicFilter;
        this.clear.hidden = !filter.bounds;
        this.status.textContent = filter.bounds ? `${events.length.toLocaleString()} ${events.length === 1 ? 'event' : 'events'} in selected area` : '';
        this.status.hidden = !this.status.textContent;
    }
    drawSelection() {
        this.selection.clearLayers();
        const index = this.manager.placeIndex;
        const event = index.events.get(this.selectedId);
        if (!event) return;
        const id = this.selectedId;
        for (const point of index.eventPoints.get(id) || []) {
            const marker = L.circleMarker(point.coordinates, {
                radius: 8, stroke: false, fillColor: '#60a5fa', fillOpacity: 0.85,
                className: 'map-selected-dot'
            }).addTo(this.selection);
            // a dot leaves full window first, so its card is there to see
            const select = () => {
                if (this.fullWindow.full) this.fullWindow.set(false);
                this.ui.scrollToEventId(id);
            };
            marker.on('click', select);
            const dot = marker.getElement();
            dot?.setAttribute('aria-label', `Select ${event.name} in timeline`);
            dot?.setAttribute('role', 'button');
            dot?.setAttribute('tabindex', '0');
            dot?.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
            });
        }
    }
    selectEvent(id) {
        const index = this.manager.placeIndex;
        if (!index.events.has(id)) return;
        this.selectedId = id;
        this.panels.openMapPanel();
        this.panels.bringMapToFront();
        this.drawSelection();
        const points = index.eventPoints.get(id) || [];
        this.map.invalidateSize();
        if (points.length) this.map.fitBounds(L.latLngBounds(points.map(point => point.coordinates)), {
            maxZoom: 6, padding: [35, 60], animate: false
        });
        this.ui.renderEvents();
    }
}
