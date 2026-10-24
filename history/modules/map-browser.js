import { containsPoint } from './place-event-index.js';

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
        this.focusedEvent = false;
        this.movingToEvent = false;
        this.lastEvents = null;
        this.pointMarkers = new Map();
        this.layer = L.layerGroup().addTo(this.map);
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
        this.map.on('dragstart', () => this.browsePlaces());
        this.map.on('zoomstart', () => { if (!this.movingToEvent) this.browsePlaces(); });
        this.map.on('moveend', () => this.refresh(this.lastEvents || [], true));
    }
    browsePlaces() {
        if (!this.focusedEvent) return;
        this.focusedEvent = false;
        this.refresh(this.lastEvents || [], true);
    }
    applyGeography(filter) {
        this.manager.setGeographicFilter(filter);
        if (this.areaOutline) this.map.removeLayer(this.areaOutline);
        this.areaOutline = null;
        if (filter.bounds) {
            const { south, north, west, east } = filter.bounds;
            this.areaOutline = L.rectangle([[south, west], [north, east]], { color: '#9b783f', weight: 1, fill: false, interactive: false }).addTo(this.map);
        }
        this.reset();
    }
    reset() {
        this.selectedId = null;
        this.selection.clearLayers();
        this.focusedEvent = false;
        this.ui.timelineContainer.scrollTop = 0;
        this.ui.resetWindow();
    }
    refresh(events, force = false) {
        if (events === this.lastEvents && !force) return;
        const dataChanged = events !== this.lastEvents;
        this.lastEvents = events;
        const index = this.manager.placeIndex;
        const order = new Map(events.map((event, position) => [index.idFor(event), position]));
        const ids = new Set(order.keys());
        if (this.selectedId && !ids.has(this.selectedId)) {
            this.selectedId = null;
            this.selection.clearLayers();
            this.focusedEvent = false;
        }
        if (dataChanged || this.focusedEvent) {
            this.layer.clearLayers();
            this.pointMarkers.clear();
        }
        const retained = new Set();
        const visible = this.map.getBounds();
        const bounds = { south: visible.getSouth(), north: visible.getNorth(), west: visible.getWest(), east: visible.getEast() };
        let points = 0;
        for (const point of this.focusedEvent ? [] : index.points.values()) {
            if (!containsPoint(bounds, point.coordinates)) continue;
            const matches = [...point.eventIds].filter(id => ids.has(id)).sort((a, b) => order.get(a) - order.get(b));
            if (!matches.length) continue;
            points++;
            if (points > 200) continue;
            retained.add(point.key);
            if (this.pointMarkers.has(point.key)) continue;
            const marker = L.circleMarker(point.coordinates, {
                radius: 4, stroke: false, fillColor: '#526675', fillOpacity: 0.3,
                className: 'map-event-dot'
            }).addTo(this.layer);
            // Co-located events remain reachable without a popup: successive clicks
            // advance through the currently filtered timeline order.
            marker.on('click', () => {
                const current = matches.indexOf(this.selectedId);
                this.selectEvent(matches[(current + 1) % matches.length], true);
            });
            marker.getElement()?.setAttribute('aria-label', `${point.name}: ${matches.length} events`);
            this.pointMarkers.set(point.key, marker);
        }
        for (const [key, marker] of this.pointMarkers) {
            if (!retained.has(key)) { this.layer.removeLayer(marker); this.pointMarkers.delete(key); }
        }
        const filter = this.manager.geographicFilter;
        this.clear.hidden = !filter.bounds;
        this.status.textContent = filter.bounds ? `${events.length.toLocaleString()} ${events.length === 1 ? 'event' : 'events'} in selected area` : '';
        this.status.hidden = !this.status.textContent;
    }
    selectEvent(id, scroll = false) {
        const index = this.manager.placeIndex;
        const event = index.events.get(id);
        if (!event) return;
        this.selectedId = id;
        this.panels.openMapPanel();
        this.panels.bringMapToFront();
        this.selection.clearLayers();
        const points = index.eventPoints.get(id) || [];
        this.focusedEvent = !scroll;
        for (const point of points) {
            L.circleMarker(point.coordinates, {
                radius: 5, stroke: false, fillColor: '#3573a1', fillOpacity: 0.45,
                interactive: false, className: 'map-selected-dot'
            }).addTo(this.selection);
        }
        this.refresh(this.lastEvents || [], true);
        if (scroll) {
            // A dot click navigates the timeline without moving the map.
            this.ui.scrollToEventId(id);
        } else if (points.length) {
            setTimeout(() => {
                if (this.selectedId !== id || !this.focusedEvent) return;
                this.movingToEvent = true;
                this.map.invalidateSize();
                this.map.fitBounds(L.latLngBounds(points.map(point => point.coordinates)), {
                    maxZoom: 6, padding: [35, 60], animate: false
                });
                this.movingToEvent = false;
            }, 350);
        }
        this.ui.renderEvents();
    }
}
