// Many events on the map at once, grouped by Supercluster: places close together on screen merge into
// a numbered bubble that splits as you zoom in. A bubble lists its events when clicked; a place with a
// single event is a dot that selects it. The selected event is left out, so its ring and label (main's
// MapBrowser) show beneath the bubbles instead of under one.
import { eventDateLabel } from '../../modules/date-handlers.js';

const SUPERCLUSTER = 'https://unpkg.com/supercluster@8.0.1/dist/supercluster.min.js';
let loading = null;
function loadSupercluster() {
    loading ??= new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = SUPERCLUSTER;
        tag.onload = resolve;
        tag.onerror = () => { loading = null; reject(new Error(`Could not load ${SUPERCLUSTER}`)); };
        document.head.append(tag);
    });
    return loading;
}

const LIST_LIMIT = 25;
// In "period" scope the map shows the years of the cards on screen, widened to at least this span.
const MIN_PERIOD_YEARS = 20;

const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
};
const countText = count => count >= 10000 ? `${Math.round(count / 1000)}k` : count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
// Years as the note shows them: deep time in millions or billions of years ago, then BC and AD.
const yearText = year => {
    const ago = 2026 - year;
    if (ago >= 1e9) return `${+(ago / 1e9).toPrecision(3)} billion years ago`;
    if (ago >= 1e6) return `${+(ago / 1e6).toPrecision(3)} million years ago`;
    if (year <= -10000) return `${Math.round(ago).toLocaleString()} years ago`;
    return year < 0 ? `${-year} BC` : String(year);
};
const periodText = ([from, to]) => {
    const [a, b] = [yearText(from), yearText(to)];
    return a === b ? a : `${a} – ${b}`;
};

export class EventClusters {
    // scope: 'results', every event the timeline's filters match, or 'period', those from the stretch of
    // time on screen in the timeline. click: 'list' shows a bubble's events, 'zoom' zooms until it splits.
    constructor(browser, { scope, click }) {
        this.browser = browser;
        this.map = browser.map;
        this.scope = scope;
        this.click = click;
        if (!this.map.getPane('labEvents')) this.map.createPane('labEvents').style.zIndex = 450;
        this.layer = L.layerGroup().addTo(this.map);
        this.note = element('p', 'map-status lab-events-note');
        this.note.setAttribute('role', 'status');
        browser.panels.mapPanel.querySelector('.map-browser').append(this.note);
        this.onMove = () => this.render();
        this.map.on('moveend', this.onMove);
        this.shown = null;
        this.events = null;
        loadSupercluster().then(() => this.update(this.events), err => console.error('Map lab: Supercluster did not load', err));
    }
    remove() {
        this.removed = true;
        this.map.off('moveend', this.onMove);
        this.map.closePopup();
        this.layer.remove();
        this.note.remove();
    }
    get index() { return this.browser.manager.placeIndex; }

    // Called with the timeline's filtered events on every render, scrolls included. Events show only
    // while "Filter by visible area" is on (Rachid, 2026-10-31); otherwise the map shows just the selection.
    update(events) {
        this.events = events;
        if (!events || !window.Supercluster || this.removed) return;
        if (!this.browser.manager.geographicFilter.bounds) return this.hide();
        if (this.scope === 'period') {
            // after the timeline has laid out the cards this render produced
            requestAnimationFrame(() => {
                const period = this.period();
                this.build(period ? events.filter(event => {
                    const year = this.index.years.get(this.index.idFor(event));
                    return year >= period[0] && year <= period[1];
                }) : [], events, period ? periodText(period) : '');
            });
        } else {
            this.build(events, events, '');
        }
    }
    hide() {
        if (!this.clusters) return;
        this.clusters = null;
        this.shown = null;
        this.map.closePopup();
        this.layer.clearLayers();
        this.note.textContent = '';
    }
    // The years of the cards on screen, widened to MIN_PERIOD_YEARS around their middle.
    period() {
        const wrapper = document.getElementById('timeline-wrapper').getBoundingClientRect();
        const years = [...document.querySelectorAll('#timeline-content > .event[data-event-id]')]
            .filter(card => { const box = card.getBoundingClientRect(); return box.width > 0 && box.bottom > wrapper.top && box.top < wrapper.bottom; })
            .map(card => this.index.years.get(card.dataset.eventId))
            .filter(Number.isFinite);
        if (!years.length) return null;
        let from = Math.min(...years), to = Math.max(...years);
        if (to - from < MIN_PERIOD_YEARS) {
            const middle = (from + to) / 2;
            from = middle - MIN_PERIOD_YEARS / 2;
            to = middle + MIN_PERIOD_YEARS / 2;
        }
        return [Math.floor(from), Math.ceil(to)];
    }
    // source and period say what the events were drawn from, so a scroll that changes neither costs nothing.
    build(events, source, period) {
        const selected = this.browser.selectedId;
        if (this.shown && this.shown.source === source && this.shown.period === period && this.shown.selected === selected) return;
        this.shown = { source, period, selected };
        // one feature per place, carrying the ids of its events
        this.groups = new Map();
        for (const event of events) {
            const id = this.index.idFor(event);
            if (id === selected) continue;
            for (const point of this.index.eventPoints.get(id) || []) {
                if (!this.groups.has(point.key)) this.groups.set(point.key, { point, ids: [] });
                this.groups.get(point.key).ids.push(id);
            }
        }
        const features = [...this.groups.values()].map(({ point, ids }) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point.coordinates[1], point.coordinates[0]] },
            properties: { key: point.key, count: ids.length },
        }));
        this.clusters = new Supercluster({
            // Supercluster measures in 512-pixel tiles and Leaflet's are 256, so 80 keeps bubbles about 40 px apart
            radius: 80, maxZoom: this.map.getMaxZoom() - 1,
            map: props => ({ count: props.count }),
            reduce: (sum, props) => { sum.count += props.count; },
        });
        this.clusters.load(features);
        const shown = new Set([...this.groups.values()].flatMap(group => group.ids)).size;
        // the area filter's own status already counts the events; the note adds the years in "period" scope
        this.note.textContent = period ? `${period} · ${shown.toLocaleString()} ${shown === 1 ? 'event' : 'events'} on the map` : '';
        this.render();
    }
    render() {
        if (!this.clusters) return;
        this.layer.clearLayers();
        const bounds = this.map.getBounds();
        const bbox = [Math.max(-180, bounds.getWest()), Math.max(-85, bounds.getSouth()), Math.min(180, bounds.getEast()), Math.min(85, bounds.getNorth())];
        for (const feature of this.clusters.getClusters(bbox, Math.round(this.map.getZoom()))) {
            const [lng, lat] = feature.geometry.coordinates;
            const { cluster, count } = feature.properties;
            if (cluster || count > 1) this.bubble([lat, lng], feature);
            else this.dot([lat, lng], this.groups.get(feature.properties.key).ids[0]);
        }
    }
    bubble(latlng, feature) {
        const { count } = feature.properties;
        const size = Math.round(24 + 7 * Math.log10(count));
        const marker = L.marker(latlng, {
            pane: 'labEvents', title: `${count.toLocaleString()} events`,
            icon: L.divIcon({ className: 'lab-cluster', html: `<span>${countText(count)}</span>`, iconSize: [size, size] }),
        }).addTo(this.layer);
        marker.on('click', () => {
            const expansion = feature.properties.cluster ? this.clusters.getClusterExpansionZoom(feature.properties.cluster_id) : null;
            if (this.click === 'zoom' && expansion !== null && expansion <= this.map.getMaxZoom()) this.map.setView(latlng, expansion);
            else this.list(latlng, feature, expansion);
        });
    }
    dot(latlng, id) {
        const event = this.index.events.get(id);
        const marker = L.marker(latlng, {
            pane: 'labEvents', title: event.name,
            icon: L.divIcon({ className: 'lab-event-dot', iconSize: [12, 12] }),
        }).addTo(this.layer);
        marker.on('click', () => this.select(id, { moveMap: false }));
    }
    // The bubble's events, earliest first, each one a button that selects it.
    list(latlng, feature, expansion) {
        const keys = feature.properties.cluster
            ? this.clusters.getLeaves(feature.properties.cluster_id, Infinity).map(leaf => leaf.properties.key)
            : [feature.properties.key];
        const ids = [...new Set(keys.flatMap(key => this.groups.get(key).ids))]
            .sort((a, b) => (this.index.years.get(a) ?? 0) - (this.index.years.get(b) ?? 0));
        const box = element('div', 'lab-event-list');
        box.append(element('p', 'lab-event-list-head', `${ids.length.toLocaleString()} ${ids.length === 1 ? 'event' : 'events'}${keys.length > 1 ? ` in ${keys.length.toLocaleString()} places` : ' here'}`));
        const items = element('ol');
        for (const id of ids.slice(0, LIST_LIMIT)) {
            const event = this.index.events.get(id);
            const item = element('button');
            item.type = 'button';
            item.append(element('span', null, event.name), element('small', null, eventDateLabel(event)));
            item.addEventListener('click', () => this.select(id, { moveMap: true }));
            const row = element('li');
            row.append(item);
            items.append(row);
        }
        box.append(items);
        if (ids.length > LIST_LIMIT) box.append(element('p', 'lab-event-list-more', `and ${(ids.length - LIST_LIMIT).toLocaleString()} more`));
        if (expansion !== null && expansion <= this.map.getMaxZoom()) {
            const zoom = element('button', 'lab-event-list-zoom', 'Zoom in');
            zoom.type = 'button';
            zoom.addEventListener('click', () => { this.map.closePopup(); this.map.setView(latlng, expansion); });
            box.append(zoom);
        }
        // the top padding keeps the list below the map's own buttons
        L.popup({ className: 'lab-event-popup', maxWidth: 300, minWidth: 220, autoPanPaddingTopLeft: [60, 110], autoPanPaddingBottomRight: [20, 30] })
            .setLatLng(latlng).setContent(box).openOn(this.map);
    }
    // From a list the map goes to the event, whose place the bubble hid, zooming in but never out: the
    // selection's own framing (zoom 6 for an unreviewed point) is wider than a list opened at street level.
    // From a dot the map stays put.
    select(id, { moveMap }) {
        this.map.closePopup();
        const { browser } = this;
        if (moveMap) {
            const zoom = this.map.getZoom();
            browser.selectEvent(id);
            browser.fitOutlineOf = null;
            if (this.map.getZoom() < zoom) this.map.setView(this.map.getCenter(), zoom, { animate: false });
        } else {
            browser.selectedId = id;
            browser.drawSelection();
        }
        browser.ui.scrollToEventId(id);
    }
}
