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
                radius: 5, stroke: false, fillColor: '#3573a1', fillOpacity: 0.45,
                className: 'map-selected-dot'
            }).addTo(this.selection);
            const select = () => this.ui.scrollToEventId(id);
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
