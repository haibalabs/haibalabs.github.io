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
        this.selected = element('div', null, 'map-selection');
        this.selected.setAttribute('aria-live', 'polite');
        panels.mapPanel.append(controls, this.selected);
        this.map.on('moveend', () => this.refresh(this.lastEvents || [], true));
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
        this.selected.replaceChildren();
        this.ui.timelineContainer.scrollTop = 0;
        this.ui.resetWindow();
    }
    refresh(events, force = false) {
        if (events === this.lastEvents && !force) return;
        const dataChanged = events !== this.lastEvents;
        this.lastEvents = events;
        const index = this.manager.placeIndex;
        const ids = new Set(events.map(event => index.idFor(event)));
        if (this.selectedId && !ids.has(this.selectedId)) {
            this.selectedId = null;
            this.selection.clearLayers();
            this.selected.replaceChildren();
        }
        if (dataChanged) {
            this.layer.clearLayers();
            this.pointMarkers.clear();
        }
        const retained = new Set();
        const visible = this.map.getBounds();
        const bounds = { south: visible.getSouth(), north: visible.getNorth(), west: visible.getWest(), east: visible.getEast() };
        let points = 0;
        for (const point of index.points.values()) {
            if (!containsPoint(bounds, point.coordinates)) continue;
            const matches = [...point.eventIds].filter(id => ids.has(id));
            if (!matches.length) continue;
            points++;
            if (points > 200) continue;
            retained.add(point.key);
            if (this.pointMarkers.has(point.key)) continue;
            const marker = L.circleMarker(point.coordinates, { radius: 6, color: point.approximate ? '#9b783f' : '#355b70', fillOpacity: point.approximate ? 0.35 : 0.8, dashArray: point.approximate ? '3 3' : null }).addTo(this.layer);
            const popup = element('div');
            popup.append(element('strong', point.name), element('p', `${point.precision} point · ${matches.length} matching events`));
            for (const id of matches.slice(0, 20)) {
                const result = button(index.events.get(id).name, () => this.selectEvent(id, true));
                result.dataset.eventId = id;
                popup.append(result);
            }
            if (matches.length > 20) popup.append(element('p', 'First 20 shown. Narrow your timeline search to find more.'));
            marker.bindPopup(popup, { autoPan: true, maxHeight: 120, autoPanPadding: [8, 8] });
            this.pointMarkers.set(point.key, marker);
        }
        for (const [key, marker] of this.pointMarkers) {
            if (!retained.has(key)) { this.layer.removeLayer(marker); this.pointMarkers.delete(key); }
        }
        const filter = this.manager.geographicFilter;
        this.clear.hidden = !filter.bounds;
        this.status.textContent = filter.bounds ? `${events.length.toLocaleString()} ${events.length === 1 ? 'event' : 'events'} in selected area` : '';
        if (points > 200) this.status.textContent += `${filter.bounds ? ' · ' : ''}Zoom in to see more places`;
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
        const locationCount = new Set(points.map(point => point.placeId)).size;
        const uncertain = points.some(point => point.approximate);
        this.selected.replaceChildren(element('strong', event.name), element('p', points.length
            ? `${locationCount} saved ${locationCount === 1 ? 'location' : 'locations'}${uncertain ? ' · approximate or uncertain points' : ''}`
            : 'No saved map location'));
        for (const point of points) {
            const label = element('span', `${point.name} · ${point.precision}`);
            L.marker(point.coordinates).bindTooltip(label).addTo(this.selection);
        }
        // Changing selection never changes the geographic filter.
        setTimeout(() => {
            if (this.selectedId !== id) return;
            this.map.invalidateSize();
            if (points.length) this.map.fitBounds(L.latLngBounds(points.map(point => point.coordinates)), { maxZoom: 6, paddingTopLeft: [35, 100], paddingBottomRight: [35, 100] });
            if (scroll) this.ui.scrollToEventId(id);
        }, 350);
        this.ui.renderEvents();
    }
}
