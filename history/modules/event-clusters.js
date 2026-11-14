// event-clusters.js
// While "Filter by visible area" is on, the filtered events show on the map, grouped by Supercluster:
// spots close together on screen merge into a numbered bubble that splits as you zoom in. A bubble lists
// its events; a spot with one event is a dot that selects it. See history-dp docs/site/MAP-BROWSING.md, "Events on the map".
import { eventDateLabel } from './date-handlers.js';

const SUPERCLUSTER = 'https://unpkg.com/supercluster@8.0.1/dist/supercluster.min.js';
// the file's sha384, the same as node_modules/supercluster/dist/supercluster.min.js
const SUPERCLUSTER_INTEGRITY = 'sha384-HkQmq7PC2BUVUkCsRUnOyzpliMb5M4pVPnjEiyI92tdS8buRHN6ZnehP1n1Acj84';
// A failed load stays failed until the page reloads; trying again on every map move added a script tag each time.
let loading = null;
let loadFailed = false;
function loadSupercluster() {
    loading ??= new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = SUPERCLUSTER;
        tag.integrity = SUPERCLUSTER_INTEGRITY;
        tag.crossOrigin = 'anonymous';
        tag.onload = resolve;
        tag.onerror = () => { loadFailed = true; reject(new Error(`Could not load ${SUPERCLUSTER}`)); };
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
const countText = count => count >= 1000 ? '1000+' : String(count);
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
    constructor(browser) {
        this.browser = browser;
        this.map = browser.map;
        // scope: 'results', every event the timeline's filters match, or 'period', those from the stretch of
        // time on screen. click: 'list' shows a bubble's events, 'zoom' zooms until it splits. The site
        // uses the defaults; the map lab sets the others through configure().
        this.scope = 'results';
        this.click = 'list';
        // always: show the events without the area filter too; only(event): just the events it accepts. The site
        // leaves both off; the lab's character cards use them to show one person's events.
        this.always = false;
        this.only = null;
        // under the area filter's count: the years in "period" scope, or that the bubbles could not load
        this.note = element('p', 'map-events-note');
        this.note.setAttribute('role', 'status');
        this.note.hidden = true;
        // above the selected event's rings (overlay pane, 400), below its label (tooltip pane, 650)
        this.map.createPane('eventClusters').style.zIndex = 450;
        this.layer = L.layerGroup().addTo(this.map);
        this.stepperLayer = L.layerGroup().addTo(this.map);
        this.stepper = null;
        this.clusters = null;
        this.shown = null;
        this.events = null;
        this.map.on('moveend', () => this.render());
    }
    get index() { return this.browser.manager.placeIndex; }

    configure({ scope = this.scope, click = this.click, always = this.always, only = this.only }) {
        this.scope = scope;
        this.click = click;
        this.always = always;
        this.only = only;
        this.shown = null;
        this.update(this.events);
    }
    showNote(text) {
        this.note.textContent = text;
        this.note.hidden = !text;
    }

    // Called with the timeline's filtered events on every render, scrolls included.
    update(events) {
        this.events = events;
        if (!events || (!this.always && !this.browser.manager.geographicFilter.bounds)) return this.hide();
        if (!window.Supercluster) {
            if (loadFailed) {
                this.hide();
                return this.showNote('The events can’t be shown on the map right now; the timeline lists them.');
            }
            loadSupercluster().then(() => this.update(this.events), err => {
                console.error('Events on the map: Supercluster did not load', err);
                this.update(this.events);
            });
            return;
        }
        const shown = this.only ? events.filter(this.only) : events;
        if (this.scope !== 'period') return this.build(shown, events, '');
        // after the timeline has laid out the cards this render produced
        requestAnimationFrame(() => {
            if (this.events !== events) return;
            const period = this.period();
            this.build(period ? shown.filter(event => {
                const year = this.index.years.get(this.index.idFor(event));
                return year >= period[0] && year <= period[1];
            }) : [], events, period ? periodText(period) : '');
        });
    }
    hide() {
        this.clearStepper();
        this.showNote('');
        if (!this.clusters) return;
        this.clusters = null;
        this.shown = null;
        this.map.closePopup();
        this.layer.clearLayers();
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
    // source and period say what the events were drawn from, so a render that changes neither costs nothing.
    build(events, source, period) {
        // the selected event is left out, so its own ring and label show
        const selected = this.browser.selectedId;
        if (this.shown && this.shown.source === source && this.shown.period === period && this.shown.selected === selected) return;
        this.shown = { source, period, selected };
        // an event selected some other way (its card, a dot) ends the stepping
        if (this.stepper && this.stepper.ids[this.stepper.position] !== selected) this.clearStepper();
        // One feature per spot on the map, carrying the ids of its events. Grouped by coordinates, not by
        // place: about 1,000 spots hold several place records (Asunción and "Asunción, Paraguay" share one
        // point), which zooming can never split, so as separate features they would stack and hide each other.
        this.groups = new Map();
        for (const event of events) {
            const id = this.index.idFor(event);
            if (id === selected) continue;
            for (const point of this.index.eventPoints.get(id) || []) {
                const spot = point.coordinates.map(c => c.toFixed(5)).join(',');
                if (!this.groups.has(spot)) this.groups.set(spot, { coordinates: point.coordinates, ids: new Set() });
                this.groups.get(spot).ids.add(id);
            }
        }
        for (const group of this.groups.values()) group.ids = [...group.ids];
        const features = [...this.groups.entries()].map(([spot, { coordinates, ids }]) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [coordinates[1], coordinates[0]] },
            properties: { key: spot, count: ids.length },
        }));
        this.clusters = new Supercluster({
            // Supercluster measures in 512-pixel tiles and Leaflet's are 256, so 80 keeps bubbles about 40 px apart
            radius: 80, maxZoom: this.map.getMaxZoom() - 1,
            map: props => ({ count: props.count }),
            reduce: (sum, props) => { sum.count += props.count; },
        });
        this.clusters.load(features);
        // the area filter's own status counts the events; in "period" scope the note adds the years
        const shown = new Set([...this.groups.values()].flatMap(group => group.ids)).size;
        this.showNote(period && `${period} · ${shown.toLocaleString()} ${shown === 1 ? 'event' : 'events'} on the map`);
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
        // events that share one spot can't split however far you zoom, so their bubble looks different
        const spot = !feature.properties.cluster;
        const marker = L.marker(latlng, {
            pane: 'eventClusters', title: spot ? `${count.toLocaleString()} events at this spot` : `${count.toLocaleString()} events`,
            icon: L.divIcon({ className: spot ? 'map-cluster map-cluster-spot' : 'map-cluster', html: `<span>${countText(count)}</span>`, iconSize: [size, size] }),
        }).addTo(this.layer);
        marker.on('click', () => {
            const expansion = feature.properties.cluster ? this.clusters.getClusterExpansionZoom(feature.properties.cluster_id) : null;
            if (this.click === 'zoom' && expansion !== null && expansion <= this.map.getMaxZoom()) return this.map.setView(latlng, expansion);
            const keys = feature.properties.cluster
                ? this.clusters.getLeaves(feature.properties.cluster_id, Infinity).map(leaf => leaf.properties.key)
                : [feature.properties.key];
            const ids = [...new Set(keys.flatMap(key => this.groups.get(key).ids))]
                .sort((a, b) => (this.index.years.get(a) ?? 0) - (this.index.years.get(b) ?? 0));
            this.showList(latlng, ids, expansion);
        });
    }
    dot(latlng, id) {
        const event = this.index.events.get(id);
        const marker = L.marker(latlng, {
            pane: 'eventClusters', title: event.name,
            icon: L.divIcon({ className: 'map-cluster-dot', iconSize: [12, 12] }),
        }).addTo(this.layer);
        marker.on('click', () => this.select(id, { moveMap: false }));
    }
    // A bubble's events, earliest first, each one a button that selects it. current: the position of the
    // event picked last, when the stepper reopens the list; the list then starts just before it.
    // options: title(), the list's title row (a landmark's name), and offset, the popup's [x, y] from the
    // point (a landmark's bubble opens above its icon); the stepper keeps both for "Back to the list".
    showList(latlng, ids, expansion = null, current = null, options = {}) {
        const { title = null, offset = [0, 7] } = options;
        const box = element('div', 'map-event-list');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', `${ids.length.toLocaleString()} events here`);
        if (title) box.append(title());
        // a landmark with no events yet shows only its title
        if (!ids.length) box.classList.add('map-event-list-empty');
        const start = current === null ? 0 : Math.max(0, Math.min(current - 2, ids.length - LIST_LIMIT));
        if (start > 0) box.append(element('p', 'map-event-list-more', `${start.toLocaleString()} earlier`));
        const items = element('ol');
        for (const [offset, id] of ids.slice(start, start + LIST_LIMIT).entries()) {
            const event = this.index.events.get(id);
            const item = element('button');
            item.type = 'button';
            if (start + offset === current) item.setAttribute('aria-current', 'true');
            item.append(element('span', null, event.name), element('small', null, eventDateLabel(event)));
            item.addEventListener('click', () => this.pick(ids, start + offset, L.latLng(latlng), options));
            const row = element('li');
            row.append(item);
            items.append(row);
        }
        box.append(items);
        const after = ids.length - start - LIST_LIMIT;
        if (after > 0) box.append(element('p', 'map-event-list-more', `and ${after.toLocaleString()} more`));
        if (expansion !== null && expansion <= this.map.getMaxZoom()) {
            const zoom = element('button', 'map-event-list-zoom', 'Zoom in');
            zoom.type = 'button';
            zoom.addEventListener('click', () => { this.map.closePopup(); this.map.setView(latlng, expansion); });
            box.append(zoom);
        }
        // the top padding keeps the list below the map's own buttons
        L.popup({ className: 'map-event-popup', maxWidth: 300, minWidth: 220, offset, autoPanPaddingTopLeft: [60, 110], autoPanPaddingBottomRight: [20, 30] })
            .setLatLng(latlng).setContent(box).openOn(this.map);
        // keyboard users land in the list: on the event picked last, or the first one, else the title
        (box.querySelector('button[aria-current="true"]') ?? box.querySelector('ol button') ?? box.querySelector('button'))?.focus({ preventScroll: true });
    }
    // The event's place nearest the bubble it was listed in: an event can have places far apart.
    nearestPoint(id, near) {
        const points = this.index.eventPoints.get(id) || [];
        return points.reduce((best, point) => !best || near.distanceTo(point.coordinates) < near.distanceTo(best.coordinates) ? point : best, null);
    }
    // From a list (near: the bubble's position) the map goes to the event, whose place the bubble hid,
    // zooming in but never out: the selection's own framing (zoom 6 for an unreviewed point, or all of an
    // event's places) is wider than a list opened close in. Kept at that zoom, it centres on the place
    // nearest the bubble. From a dot the map stays put.
    select(id, { moveMap, near = null }) {
        this.map.closePopup();
        if (!moveMap) this.clearStepper();
        const { browser } = this;
        if (moveMap) {
            const zoom = this.map.getZoom();
            browser.selectEvent(id);
            // the zoom set below wins over refitting to an outline (map-browser.js)
            browser.fitOutlineOf = null;
            const point = near && this.nearestPoint(id, near);
            if (point && this.map.getZoom() < zoom) this.map.setView(point.coordinates, zoom, { animate: false });
        } else {
            browser.selectedId = id;
            browser.drawSelection();
            // nothing re-renders here, so the bubbles are rebuilt to drop the dot and bring back the last selection
            this.update(this.events);
        }
        browser.ui.scrollToEventId(id);
    }
    // Picks the event at this position of a list, and keeps the list as a stepper under it:
    // ‹ and › go to the previous and next event, and the list button reopens the list there.
    pick(ids, position, near, list = {}) {
        this.stepper = { ids, position, near, list };
        this.select(ids[position], { moveMap: true, near });
        this.showStepper();
    }
    showStepper() {
        this.stepperLayer.clearLayers();
        const { ids, position, near, list } = this.stepper;
        const point = this.nearestPoint(ids[position], near);
        if (!point) return;
        const bar = element('div', 'map-stepper');
        const control = (icon, label, disabled, action) => {
            const node = element('button');
            node.type = 'button';
            node.title = label;
            node.setAttribute('aria-label', label);
            node.disabled = disabled;
            node.innerHTML = `<i class="fa-light ${icon}" aria-hidden="true"></i>`;
            node.addEventListener('click', action);
            return node;
        };
        bar.append(
            control('fa-chevron-left', 'Previous event', position === 0, () => this.pick(ids, position - 1, near, list)),
            element('span', null, `${(position + 1).toLocaleString()} of ${ids.length.toLocaleString()}`),
            control('fa-chevron-right', 'Next event', position === ids.length - 1, () => this.pick(ids, position + 1, near, list)),
            control('fa-list', 'Back to the list', false, () => this.showList(near, ids, null, position, list)),
        );
        L.DomEvent.disableClickPropagation(bar);
        // a zero-size icon at the event's point; the bar hangs below it in CSS, clear of the label above
        L.marker(point.coordinates, { pane: 'eventClusters', interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'map-stepper-anchor', html: bar, iconSize: [0, 0] }) }).addTo(this.stepperLayer);
    }
    clearStepper() {
        this.stepper = null;
        this.stepperLayer.clearLayers();
    }
}
