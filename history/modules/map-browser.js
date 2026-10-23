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
        this.selectedId = null;
        this.lastEvents = null;
        this.pointMarkers = new Map();
        this.layer = L.layerGroup().addTo(this.map);
        this.selection = panels.markersLayer;
        const controls = element('section', null, 'map-browser');
        controls.setAttribute('aria-label', 'Explore events by place');
        controls.append(element('strong', 'Explore by place'));
        const actions = element('div', null, 'map-actions');
        actions.append(button('Search this area', () => {
            const bounds = this.map.getBounds();
            this.applyGeography({ bounds: { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() } });
        }), button('Clear area / place', () => this.applyGeography({})),
        button('Unmapped events', () => this.applyGeography({ unmappedOnly: true })));
        controls.append(actions);
        const form = element('form', null, 'map-years');
        this.from = element('input'); this.through = element('input');
        for (const [input, label] of [[this.from, 'From year'], [this.through, 'Through year']]) {
            input.type = 'number'; input.step = '1'; input.placeholder = label;
            input.setAttribute('aria-label', label);
            form.append(input);
        }
        const apply = element('button', 'Apply years'); apply.type = 'submit'; form.append(apply);
        form.append(button('Clear years', () => { this.from.value = ''; this.through.value = ''; this.applyYears(); }));
        form.addEventListener('submit', event => { event.preventDefault(); this.applyYears(); });
        controls.append(form, element('small', 'Negative years = BCE. Dates use the recorded start year; blank = any year.'));
        const label = element('label', null, 'map-precision');
        this.approximate = element('input'); this.approximate.type = 'checkbox'; this.approximate.checked = true;
        this.approximate.addEventListener('change', () => this.applyGeography(this.manager.geographicFilter));
        label.append(this.approximate, document.createTextNode(' Include approximate / unknown precision points'));
        controls.append(label, element('small', 'Points represent saved locations, not historical borders. Unmapped events remain available.'));
        this.status = element('p', null, 'map-status'); this.status.setAttribute('role', 'status');
        this.selected = element('div', null, 'map-selection');
        controls.append(this.status, this.selected);
        this.results = element('div', null, 'map-results');
        this.results.setAttribute('aria-label', 'Map event results');
        panels.mapPanel.prepend(controls);
        panels.mapPanel.append(this.results);
        this.map.on('moveend', () => this.refresh(this.lastEvents || [], true));
    }
    applyYears() {
        const from = this.from.value === '' ? null : Number(this.from.value);
        const through = this.through.value === '' ? null : Number(this.through.value);
        if ([from, through].some(value => value !== null && (!Number.isSafeInteger(value) || value === 0)) || (from !== null && through !== null && from > through)) {
            this.status.textContent = 'Use whole years other than zero, with From before Through.';
            return;
        }
        this.manager.setTimeRange(from, through);
        this.reset();
    }
    applyGeography(filter) {
        this.manager.setGeographicFilter({ ...filter, includeApproximate: this.approximate.checked });
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
            if ((!this.approximate.checked && point.approximate) || !containsPoint(bounds, point.coordinates)) continue;
            const matches = [...point.eventIds].filter(id => ids.has(id));
            if (!matches.length) continue;
            points++;
            if (points > 200) continue;
            retained.add(point.key);
            if (this.pointMarkers.has(point.key)) continue;
            const marker = L.circleMarker(point.coordinates, { radius: 6, color: point.approximate ? '#9b783f' : '#355b70', fillOpacity: point.approximate ? 0.35 : 0.8, dashArray: point.approximate ? '3 3' : null }).addTo(this.layer);
            const popup = element('div');
            popup.append(element('strong', point.name), element('p', `${point.precision} point · ${matches.length} matching events`));
            popup.append(button('Filter to this place', () => this.applyGeography({ placeId: point.placeId })));
            for (const id of matches.slice(0, 20)) popup.append(button(index.events.get(id).name, () => this.selectEvent(id, true)));
            if (matches.length > 20) popup.append(element('p', 'First 20 shown. Filter to this place to browse the timeline.'));
            marker.bindPopup(popup, { autoPan: true, maxHeight: 120, autoPanPadding: [8, 8] });
            this.pointMarkers.set(point.key, marker);
        }
        for (const [key, marker] of this.pointMarkers) {
            if (!retained.has(key)) { this.layer.removeLayer(marker); this.pointMarkers.delete(key); }
        }
        const filter = this.manager.geographicFilter;
        const scope = filter.unmappedOnly ? 'Unmapped only' : filter.placeId ? 'Selected place' : filter.bounds ? 'Selected area' : 'All areas';
        const unmapped = events.filter(event => index.unmapped.has(index.idFor(event))).length;
        this.status.textContent = `${scope}: ${events.length.toLocaleString()} events (${unmapped.toLocaleString()} unmapped). ${Math.min(points, 200)} of ${points.toLocaleString()} matching points in view. ${points > 200 ? 'Zoom in to see more points.' : ''}`;
        this.results.replaceChildren(element('small', `First ${Math.min(50, events.length)} results; browse the timeline for all matches.`));
        for (const event of events.slice(0, 50)) {
            const node = button(`${event.enhanced_time} · ${event.name}`, () => this.selectEvent(index.idFor(event), true));
            node.dataset.eventId = index.idFor(event);
            this.results.append(node);
        }
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
        this.selected.replaceChildren(element('strong', event.name), element('p', `${points.length} saved points across ${(event.locations || []).length} recorded locations. ${points.length ? 'All saved points shown; uncertain points are labelled.' : 'No saved coordinates. This event remains browsable.'}`));
        for (const point of points) {
            const label = element('span', `${point.name} · ${point.precision}`);
            L.marker(point.coordinates).bindTooltip(label).addTo(this.selection);
            this.selected.append(element('small', `${point.name} (${point.precision}) `));
        }
        // Changing selection never changes the geographic filter.
        setTimeout(() => {
            if (this.selectedId !== id) return;
            this.map.invalidateSize();
            if (points.length) this.map.fitBounds(L.latLngBounds(points.map(point => point.coordinates)), { maxZoom: 6, padding: [25, 25] });
            if (scroll) this.ui.scrollToEventId(id);
        }, 350);
        this.ui.renderEvents();
    }
}
