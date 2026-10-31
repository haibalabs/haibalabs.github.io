import { eventDateLabel } from './date-handlers.js';
import { EventClusters } from './event-clusters.js';

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

// How a selected event's reviewed point is drawn, by its precision. A dot with metres is a ring that grows
// with the zoom to cover that much ground, never below its radius; the sizes are display choices, and
// 10 km is the resolver's placement tolerance for approximate points.
const BLUE = '#3b82f6';
const DOTS = {
    site: { options: { radius: 6, weight: 2, color: '#fff', fillColor: '#1d4ed8', fillOpacity: 1 } },
    settlement: { metres: 3000, options: { radius: 7, weight: 1.5, color: BLUE, fillColor: BLUE, fillOpacity: 0.2 } },
    approximate: { metres: 10000, options: { radius: 16, weight: 1.5, dashArray: '3 3', color: BLUE, fillColor: BLUE, fillOpacity: 0.16 } },
    region: { metres: 100000, options: { radius: 26, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.1 } },
    country: { metres: 300000, options: { radius: 34, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.08 } },
};
DOTS.polity = DOTS.country;
// An unreviewed point may name a town or a whole region, so its ring keeps one size on screen; its
// grey follows the theme (map-browser.css).
const UNREVIEWED = { className: 'map-unreviewed', options: { radius: 16, weight: 2, dashArray: '3 3', color: '#6b7280', fillColor: '#6b7280', fillOpacity: 0.12 } };
// a reviewed point with no recorded precision is shown as a dot, never assumed to be an area
const dotFor = point => point.reviewed ? DOTS[point.precision] ?? DOTS.site : UNREVIEWED;
// Selecting an event fits a square 1.65 times each ring's width, rounded out to a whole zoom; a site is
// framed as if it had a 2.5 km ring. An event with an unreviewed point zooms no closer than 6.
const SITE_VIEW_METRES = 2500;
const UNREVIEWED_MAX_ZOOM = 6;

const EARTH_CIRCUMFERENCE = 40075016.686;
const metresPerPixel = (lat, zoom) => EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180) / 2 ** (zoom + 8);

// The selected event's name and date over its first point.
function eventLabel(event) {
    const label = element('span');
    label.append(element('strong', event.name), element('span', eventDateLabel(event)));
    return label;
}

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
        this.rings = [];
        this.map.on('zoomend', () => this.resizeRings());
        this.fullWindow = fullWindowControl().addTo(this.map);
        this.clusters = new EventClusters(this);
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
        // Area filtering changes the timeline and shows the area's events as bubbles (event-clusters.js).
        // Keep the selection if it still matches; refresh clears it otherwise.
        this.ui.timelineContainer.scrollTop = 0;
        this.ui.resetWindow();
    }
    refresh(events) {
        // before the early return: a new selection re-renders with the same events, and the bubbles leave it out
        this.clusters.update(events);
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
    resizeRings() {
        const zoom = this.map.getZoom();
        for (const { marker, dot } of this.rings) {
            const radius = Math.max(dot.options.radius, dot.metres / metresPerPixel(marker.getLatLng().lat, zoom));
            // a ring wider than the dot fades its fill, so it tints rather than covers the map
            marker.setRadius(radius).setStyle({ fillOpacity: dot.options.fillOpacity * Math.min(1, Math.max(0.4, dot.options.radius * 2 / radius)) });
        }
    }
    drawSelection() {
        this.selection.clearLayers();
        this.rings = [];
        const index = this.manager.placeIndex;
        const event = index.events.get(this.selectedId);
        if (!event) return;
        const id = this.selectedId;
        for (const [i, point] of (index.eventPoints.get(id) || []).entries()) {
            const look = dotFor(point);
            const marker = L.circleMarker(point.coordinates, { ...look.options, className: `map-selected-dot ${look.className ?? ''}` }).addTo(this.selection);
            if (look.metres) this.rings.push({ marker, dot: look });
            if (look.metres || !point.reviewed) {
                L.circleMarker(point.coordinates, { radius: 3, stroke: false, fillColor: look.options.fillColor, fillOpacity: 1, interactive: false, className: look.className ?? '' }).addTo(this.selection);
            }
            // the label sits just above the dot or the ring's smallest size
            marker.bindTooltip(eventLabel(event), { direction: 'top', permanent: i === 0, className: 'map-event-label', offset: [0, -(look.options.radius + 2)], opacity: 1 });
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
        this.resizeRings();
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
        if (points.length) {
            const bounds = L.latLngBounds([]);
            for (const point of points) bounds.extend(L.latLng(point.coordinates).toBounds((dotFor(point).metres ?? SITE_VIEW_METRES) * 3.3));
            const maxZoom = points.every(point => point.reviewed) ? this.map.getMaxZoom() : UNREVIEWED_MAX_ZOOM;
            this.map.fitBounds(bounds, { maxZoom, padding: [35, 60], animate: false });
        }
        this.ui.renderEvents();
    }
}
