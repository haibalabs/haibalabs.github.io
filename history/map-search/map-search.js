// Map search, started by script.js for every visitor. A field at the map's top right finds what you type among the
// release's landmarks, then the places the events are at (the event forms' search, place-search.js, by event
// count), then Wikidata items with coordinates. Picking one flies the map there: a landmark opens its own
// bubble, a place with events opens the same bubble with its events, and a Wikidata item gets a pin with its
// name. "/" focuses the field while the map is open; the arrow keys move through the results and Enter picks.
import { PlaceSearch, fold } from '../modules/place-search.js';

const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
};
// a bubble's title, as the landmarks' bubble has
const listTitle = label => {
    const heading = element('p', null, 'map-event-list-title');
    heading.append(element('strong', label));
    return heading;
};

const WIKIDATA_WAIT_MS = 300;
// how close the map flies in, by the place's precision
const ZOOM = { site: 15, settlement: 11, approximate: 10, region: 7, country: 5, polity: 5 };
const LANDMARK_ZOOM = 14;
let active = null;

export function setSearch(app, on) {
    if (!on) {
        active?.stop();
        active = null;
    } else if (!active) {
        active = new MapSearch(app);
    }
}

class MapSearch {
    constructor(app) {
        this.app = app;
        this.browser = app.browser;
        this.map = app.map;
        this.places = new PlaceSearch(() => app.eventManager.events);
        this.css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('map-search.css', import.meta.url).href });
        document.head.append(this.css);
        this.results = [];
        this.position = -1;
        this.asked = 0;
        this.control = this.build().addTo(this.map);
        document.body.classList.add('map-search-on');
        this.onKey = event => {
            const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
            if (event.key !== '/' || typing || !this.map.getContainer().offsetParent) return;
            event.preventDefault();
            this.open();
        };
        document.addEventListener('keydown', this.onKey);
    }

    build() {
        const search = this;
        return new (L.Control.extend({
            options: { position: 'topright' },
            onAdd() {
                const box = element('div', null, 'map-search');
                search.box = box;
                search.toggle = element('button', null, 'map-search-toggle');
                Object.assign(search.toggle, { type: 'button', title: 'Search places' });
                search.toggle.setAttribute('aria-label', 'Search places');
                search.toggle.innerHTML = '<i class="fa-light fa-magnifying-glass" aria-hidden="true"></i>';
                search.toggle.addEventListener('click', () => search.open());
                const field = element('label', null, 'map-search-field');
                field.innerHTML = '<i class="fa-light fa-magnifying-glass" aria-hidden="true"></i>';
                search.input = Object.assign(element('input'), { type: 'search', placeholder: 'Search places', autocomplete: 'off', spellcheck: false });
                search.input.setAttribute('aria-label', 'Search places');
                search.input.setAttribute('role', 'combobox');
                search.input.setAttribute('aria-expanded', 'false');
                search.input.setAttribute('aria-controls', 'map-search-list');
                search.input.addEventListener('input', () => search.find(search.input.value));
                search.input.addEventListener('keydown', event => search.key(event));
                search.clear = element('button', null, 'map-search-clear');
                Object.assign(search.clear, { type: 'button', title: 'Clear', hidden: true });
                search.clear.setAttribute('aria-label', 'Clear the search');
                search.clear.innerHTML = '<i class="fa-light fa-xmark" aria-hidden="true"></i>';
                search.clear.addEventListener('click', () => search.reset(true));
                field.append(search.input, search.clear);
                search.list = element('ul', null, 'map-search-list');
                search.list.id = 'map-search-list';
                search.list.setAttribute('role', 'listbox');
                search.list.hidden = true;
                box.append(search.toggle, field, search.list);
                L.DomEvent.disableClickPropagation(box);
                L.DomEvent.disableScrollPropagation(box);
                return box;
            },
        }))();
    }

    open() {
        this.box.classList.add('open');
        this.input.focus();
        this.input.select();
    }

    // Landmarks first, then the events' places, as typed; Wikidata a moment later, without what is listed.
    find(text) {
        const asked = ++this.asked;
        this.clear.hidden = !text;
        clearTimeout(this.wait);
        const query = fold(text);
        if (query.length < 2) return this.show([]);
        const landmarks = (this.browser.landmarks?.entries ?? [])
            .map(entry => entry.landmark)
            .filter(landmark => fold(landmark.label).split(/[\s,()-]+/).some(word => word.startsWith(query)) || fold(landmark.label).startsWith(query))
            .sort((a, b) => Number(!fold(a.label).startsWith(query)) - Number(!fold(b.label).startsWith(query)) || a.tier - b.tier)
            .slice(0, 3)
            .map(landmark => ({ kind: 'landmark', label: landmark.label, landmark }));
        // the events' places are listed once per load of the events
        if (this.index !== this.app.eventManager.placeIndex) {
            this.index = this.app.eventManager.placeIndex;
            this.places.reset();
        }
        const local = this.places.local(text);
        // place records with one label (two "Mecca, Saudi Arabia" rows) are one result, with all their events, at
        // the point of the one with the most
        const byLabel = new Map();
        for (const place of local) {
            const ids = this.eventIds(place);
            if (!ids.length) continue;
            const found = byLabel.get(place.label);
            if (!found) byLabel.set(place.label, { kind: 'place', label: place.label, place, ids, most: ids.length });
            else {
                if (ids.length > found.most) Object.assign(found, { place, most: ids.length });
                found.ids = [...new Set([...found.ids, ...ids])];
            }
        }
        const places = [...byLabel.values()].map(result => ({ ...result, events: result.ids.length }));
        this.show([...landmarks, ...places]);
        this.wait = setTimeout(async () => {
            const more = await this.places.remote(text, local);
            if (asked !== this.asked) return;
            this.show([...landmarks, ...places, ...more.slice(0, 4).map(place => ({ kind: 'wikidata', label: place.label, place }))]);
        }, WIKIDATA_WAIT_MS);
    }

    eventIds(place) {
        const index = this.app.eventManager.placeIndex;
        return [...(index.places.get(place.location.place_id) ?? [])].sort((a, b) => (index.years.get(a) ?? 0) - (index.years.get(b) ?? 0));
    }

    show(results) {
        this.results = results;
        this.position = results.length ? 0 : -1;
        this.list.replaceChildren();
        const groups = { landmark: 'Landmarks', place: 'Places in the timeline', wikidata: 'More places' };
        let group = null;
        results.forEach((result, i) => {
            if (result.kind !== group) {
                group = result.kind;
                const heading = element('li', groups[group], 'map-search-group');
                heading.setAttribute('role', 'presentation');
                this.list.append(heading);
            }
            const item = element('li', null, `map-search-item map-search-${result.kind}`);
            item.id = `map-search-${i}`;
            item.setAttribute('role', 'option');
            item.append(element('span', result.label, 'map-search-label'));
            const note = result.kind === 'place' ? `${result.events.toLocaleString()} event${result.events === 1 ? '' : 's'}`
                : result.kind === 'wikidata' ? result.place.subtitle : '';
            if (note) item.append(element('span', note, 'map-search-note'));
            item.addEventListener('mousedown', event => event.preventDefault());
            item.addEventListener('click', () => this.pick(result));
            this.list.append(item);
        });
        this.list.hidden = !results.length;
        this.input.setAttribute('aria-expanded', String(!this.list.hidden));
        this.highlight();
    }

    highlight() {
        for (const item of this.list.querySelectorAll('.map-search-item')) item.setAttribute('aria-selected', String(item.id === `map-search-${this.position}`));
        if (this.position >= 0) this.input.setAttribute('aria-activedescendant', `map-search-${this.position}`);
        else this.input.removeAttribute('aria-activedescendant');
    }

    key(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!this.results.length) return;
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            this.position = (this.position + step + this.results.length) % this.results.length;
            this.highlight();
            this.list.querySelector(`#map-search-${this.position}`)?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (this.results[this.position]) this.pick(this.results[this.position]);
        } else if (event.key === 'Escape') {
            // closes the list, not the full-window map
            event.stopPropagation();
            if (!this.list.hidden) this.show([]);
            else this.input.blur();
        }
    }

    // Flies to the result, then opens its bubble (a landmark, a place with events) or pins it (Wikidata).
    pick(result) {
        this.input.value = result.label;
        this.clear.hidden = false;
        this.show([]);
        this.input.blur();
        this.pin?.remove();
        this.pin = null;
        this.map.closePopup();
        const point = result.kind === 'landmark' ? result.landmark.point : result.place.location.point;
        const zoom = result.kind === 'landmark' ? LANDMARK_ZOOM : ZOOM[result.place.location.precision] ?? ZOOM.settlement;
        // a pick made while the map still flies to an earlier one replaces it, so only the last opens
        if (this.arrive) this.map.off('moveend', this.arrive);
        this.arrive = () => {
            this.arrive = null;
            if (result.kind === 'landmark') {
                const entry = this.browser.landmarks.entries.find(e => e.landmark === result.landmark);
                this.browser.landmarks.open(result.landmark, entry.marker);
            } else if (result.kind === 'place') {
                const index = this.app.eventManager.placeIndex;
                const ids = [...result.ids].sort((a, b) => (index.years.get(a) ?? 0) - (index.years.get(b) ?? 0));
                this.browser.clusters.showList(point, ids, null, null,
                    { title: () => listTitle(result.label) });
            } else {
                this.pin = L.circleMarker(point, { radius: 7, weight: 2, color: '#fff', fillColor: '#1d4ed8', fillOpacity: 1, className: 'map-search-pin' })
                    .bindTooltip(result.label, { permanent: true, direction: 'top', offset: [0, -8], className: 'map-event-label' })
                    .addTo(this.map);
            }
        };
        this.map.once('moveend', this.arrive);
        this.map.flyTo(point, Math.max(zoom, Math.min(this.map.getZoom(), zoom + 2)), { duration: 0.8 });
    }

    reset(focus) {
        this.input.value = '';
        this.clear.hidden = true;
        this.show([]);
        this.pin?.remove();
        this.pin = null;
        if (focus) this.input.focus();
    }

    stop() {
        clearTimeout(this.wait);
        if (this.arrive) this.map.off('moveend', this.arrive);
        this.pin?.remove();
        this.control.remove();
        this.css.remove();
        document.body.classList.remove('map-search-on');
        document.removeEventListener('keydown', this.onKey);
    }
}
