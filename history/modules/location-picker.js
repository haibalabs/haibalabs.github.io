// location-picker.js
// The location field both event forms share (Rachid, 2026-10-31: one design and one code path, so an
// improvement reaches both). Each place is a row with a small map; a search box finds the loaded
// events' places first, then Wikidata (place-search.js), and picking one gives the event its point.
// When those miss, the author can search OpenStreetMap, or paste coordinates or a map link: the point
// opens the hand fields, filled in from the link and OpenStreetMap, so the author names the place.
// "Enter it by hand" takes the five text fields alone, for a place no source has; such a place
// stays off the map. Rows keep their positions: a removed place stays listed, struck through, until
// the form is sent, because world edits change locations per position (history-dp docs/site/WORLD-EDITS.md).
import { pastedPoint } from './place-search.js';
import { locationText, normalizeLocation, sameValue } from './world-edits.js';

const SEARCH_DELAY_MS = 250;
const TILE_SIZE = 256;
// how close the row's map is for what the point stands for
const ZOOM = { site: 15, settlement: 11, approximate: 10, region: 6, country: 4, polity: 4 };
const PRECISION_TEXT = { site: 'site', settlement: 'town or city', approximate: 'approximate point', region: 'region', country: 'country', polity: 'state or empire' };
const HAND_FIELDS = [['name', 'Name'], ['city', 'City'], ['region', 'Region'], ['country', 'Country'], ['historical_name', 'Historical name']];

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * The OpenStreetMap tile holding a point, and where in it the point falls, in pixels.
 *
 * @param {number[]} point - [lat, lon]
 * @param {number} zoom
 */
export function tileFor([lat, lon], zoom) {
    const n = 2 ** zoom;
    const x = ((lon + 180) / 360) * n;
    const rad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return { url: `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`, tx, ty, px: (x - tx) * TILE_SIZE, py: (y - ty) * TILE_SIZE };
}

/** A small map centred on a location's point, with a pin; a plain box when it has none. */
export function miniMap(location, className = 'loc-map') {
    const box = element('div', className);
    box.setAttribute('aria-hidden', 'true');
    if (!location?.point) {
        box.classList.add('empty');
        box.append(element('i', 'fa-light fa-location-dot'));
        return box;
    }
    const zoom = ZOOM[location.precision] ?? 8;
    const { tx, ty, px, py } = tileFor(location.point, zoom);
    // Four tiles, the point's and the three nearest it, so a point near a tile's edge never leaves the box
    // half blank; the grid is placed so the point sits at the box's centre (CSS: 96 × 72).
    const left = px < TILE_SIZE / 2 ? tx - 1 : tx;
    const top = py < TILE_SIZE / 2 ? ty - 1 : ty;
    const n = 2 ** zoom;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const x = left + dx;
        const y = top + dy;
        if (y < 0 || y >= n) continue;
        const img = element('img');
        img.src = `https://tile.openstreetmap.org/${zoom}/${((x % n) + n) % n}/${y}.png`;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'strict-origin-when-cross-origin';
        img.style.left = `calc(50% - ${((tx - x) * TILE_SIZE + px).toFixed(0)}px)`;
        img.style.top = `calc(50% - ${((ty - y) * TILE_SIZE + py).toFixed(0)}px)`;
        box.append(img);
    }
    // OpenStreetMap's tile policy asks for attribution wherever its tiles are shown
    box.append(element('span', 'loc-pin'), element('span', 'loc-attribution', '© OpenStreetMap'));
    return box;
}

/** What the row says about a place's point. */
export function pointNote(location) {
    if (!location?.point) return 'Not on the map until the place is identified';
    return `On the map · ${PRECISION_TEXT[location.precision] ?? 'approximate point'}`;
}

const HAND_NOTE = 'A place entered by hand stays off the map until it is identified.';
const pointText = ([lat, lon]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

export class LocationPicker {
    /**
     * @param {HTMLElement} root - an empty container
     * @param {{ search: import('./place-search.js').PlaceSearch, max?: number, idPrefix: string,
     *     onChange?: () => void }} options
     */
    constructor(root, { search, max = Infinity, idPrefix, onChange = () => {} }) {
        this.root = root;
        this.search = search;
        this.max = max;
        this.onChange = onChange;
        this.slots = [];
        this.target = null;
        this.ticket = 0;
        // the point a pasted coordinate or map link gave the hand fields
        this.handPoint = null;
        root.classList.add('location-picker');
        this.list = element('ul', 'loc-list');
        this.adder = element('div', 'loc-add');
        this.searchBox = element('div', 'loc-search');
        this.input = element('input', 'loc-input');
        this.input.type = 'text';
        this.input.autocomplete = 'off';
        this.input.id = `${idPrefix}-search`;
        this.results = element('ul', 'loc-results');
        this.results.id = `${idPrefix}-results`;
        this.results.setAttribute('role', 'listbox');
        this.results.hidden = true;
        this.input.setAttribute('aria-controls', this.results.id);
        this.input.setAttribute('aria-expanded', 'false');
        this.searchBox.append(element('i', 'fa-light fa-magnifying-glass loc-mag'), this.input, this.results);
        this.targetLine = element('p', 'loc-target');
        this.targetLine.hidden = true;
        this.handButton = element('button', 'link-btn loc-hand-toggle', 'Enter it by hand');
        this.handButton.type = 'button';
        this.hand = this.buildHandEntry(idPrefix);
        this.adder.append(this.targetLine, this.searchBox, this.handButton, this.hand);
        root.append(this.list, this.adder);

        this.input.addEventListener('input', () => this.scheduleSearch());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.results.querySelector('button')?.click();
            } else if (e.key === 'Escape' && !this.results.hidden) {
                e.stopPropagation();
                this.hideResults();
            }
        });
        this.handButton.addEventListener('click', () => this.openHand());
    }

    buildHandEntry(idPrefix) {
        const box = element('div', 'loc-hand');
        box.hidden = true;
        const grid = element('div', 'location-fields');
        this.handInputs = {};
        for (const [key, label] of HAND_FIELDS) {
            const input = element('input');
            input.type = 'text';
            input.placeholder = label;
            input.setAttribute('aria-label', label);
            input.id = `${idPrefix}-${key}`;
            input.maxLength = 200;
            this.handInputs[key] = input;
            grid.append(input);
        }
        const actions = element('div', 'loc-hand-actions');
        const add = element('button', 'btn btn-secondary', 'Use this place');
        add.type = 'button';
        const cancel = element('button', 'link-btn', 'Cancel');
        cancel.type = 'button';
        add.addEventListener('click', () => {
            const fields = Object.fromEntries(HAND_FIELDS.map(([key]) => [key, this.handInputs[key].value]));
            if (!normalizeLocation(fields)) return this.handInputs.name.focus();
            // a pasted point stands for the exact spot the author chose
            this.pick(normalizeLocation(this.handPoint ? { ...fields, point: this.handPoint, precision: 'site' } : fields));
        });
        cancel.addEventListener('click', () => this.closeHand());
        actions.append(add, cancel);
        this.handNote = element('p', 'muted', HAND_NOTE);
        box.append(grid, this.handNote, actions);
        return box;
    }

    /** Starts over with an event's locations, each kept at its position. */
    set(locations = []) {
        this.slots = locations.map(location => {
            const original = normalizeLocation(location);
            return { original, current: original };
        });
        this.target = null;
        this.input.value = '';
        this.hideResults();
        this.closeHand();
        this.render();
    }

    /** Puts a proposed place (or a removal, null) at a position, as a revision of an edit had it. */
    propose(index, location) {
        while (this.slots.length <= index) this.slots.push({ original: null, current: null });
        this.slots[index].current = normalizeLocation(location);
        // positions past the event's own places are additions; an empty one is dropped
        this.slots = this.slots.filter(slot => slot.original || slot.current);
        this.render();
    }

    /** The current place at each position: null where one was removed; added places at the end. */
    values() {
        return this.slots.map(slot => slot.current);
    }

    changed() {
        return this.slots.some(slot => !sameValue(slot.original, slot.current));
    }

    render() {
        this.list.replaceChildren(...this.slots.map((slot, index) => this.row(slot, index)));
        const full = this.slots.filter(slot => slot.current || slot.original).length >= this.max && this.target === null;
        this.adder.hidden = full;
        const count = this.slots.filter(slot => slot.current).length;
        this.input.placeholder = this.target !== null ? 'Search the new place…' : count ? 'Add another place…' : 'Search a place, or paste a map link…';
        this.targetLine.hidden = this.target === null;
        if (this.target !== null) {
            this.targetLine.replaceChildren(`Replacing “${locationText(this.slots[this.target].current ?? this.slots[this.target].original)}”. `);
            const cancel = element('button', 'link-btn', 'Keep it');
            cancel.type = 'button';
            cancel.addEventListener('click', () => {
                this.target = null;
                this.input.value = '';
                this.hideResults();
                this.closeHand();
                this.render();
            });
            this.targetLine.append(cancel);
        }
        this.onChange();
    }

    row(slot, index) {
        const removed = !slot.current;
        const location = slot.current ?? slot.original;
        const item = element('li', removed ? 'loc-row removed' : 'loc-row');
        const meta = element('div', 'loc-meta');
        meta.append(element('span', 'loc-label', locationText(location) || '(unnamed place)'));
        meta.append(element('span', location.point && !removed ? 'loc-note ok' : 'loc-note', removed ? 'Will be removed' : pointNote(location)));
        if (slot.original && !removed && !sameValue(slot.original, slot.current)) meta.append(element('span', 'loc-note changed', `Was: ${locationText(slot.original)}`));
        const actions = element('div', 'loc-actions');
        const button = (label, handler) => {
            const b = element('button', 'link-btn', label);
            b.type = 'button';
            b.addEventListener('click', handler);
            actions.append(b);
        };
        if (removed) {
            button('Undo', () => {
                slot.current = slot.original;
                this.render();
            });
        } else {
            button('Change', () => {
                this.target = index;
                this.closeHand();
                this.render();
                this.input.focus();
            });
            button('Remove', () => {
                if (slot.original) slot.current = null;
                else this.slots.splice(index, 1);
                if (this.target === index) this.target = null;
                this.render();
            });
        }
        item.append(miniMap(removed ? null : location), meta, actions);
        return item;
    }

    pick(location) {
        if (this.target !== null) this.slots[this.target].current = location;
        else this.slots.push({ original: null, current: location });
        this.target = null;
        this.input.value = '';
        this.hideResults();
        this.closeHand();
        this.render();
    }

    /**
     * Opens the hand fields, seeded with the search text, or with a pasted point and the name its link
     * carries; the city, region and country, and a missing name, come from OpenStreetMap.
     */
    openHand(pasted = null) {
        this.hand.hidden = false;
        this.handButton.hidden = true;
        this.hideResults();
        const seed = pasted ? pasted.name : this.input.value.trim();
        for (const input of Object.values(this.handInputs)) input.value = '';
        this.handInputs.name.value = seed;
        this.handPoint = pasted?.point ?? null;
        this.handNote.textContent = this.handPoint ? `On the map at ${pointText(this.handPoint)}. Name the place, then use it.` : HAND_NOTE;
        this.handInputs.name.focus();
        if (!this.handPoint) return;
        const point = this.handPoint;
        this.search.reverse(point).then(found => {
            if (!found || this.handPoint !== point) return;
            for (const key of ['name', 'city', 'region', 'country']) {
                if (!this.handInputs[key].value) this.handInputs[key].value = found[key] ?? '';
            }
        });
    }

    closeHand() {
        this.hand.hidden = true;
        this.handButton.hidden = false;
        this.handPoint = null;
    }

    scheduleSearch() {
        clearTimeout(this.timer);
        const text = this.input.value.trim();
        const ticket = ++this.ticket;
        if (text.length < 2) return this.hideResults();
        const pasted = pastedPoint(text);
        if (pasted) return this.showPasted(pasted);
        const local = this.search.local(text);
        this.showResults(text, local, null);
        this.timer = setTimeout(async () => {
            const remote = await this.search.remote(text, local);
            if (ticket === this.ticket) this.showResults(text, local, remote);
        }, SEARCH_DELAY_MS);
    }

    // A pasted point is offered as one result, which opens the hand fields to name it.
    showPasted(pasted) {
        const items = [element('li', 'loc-group', 'Map point')];
        if (pasted.short) {
            items.push(element('li', 'loc-group muted', 'A shortened map link can’t be read here. Open it, then copy the full link from the address bar, or copy the coordinates.'));
        } else {
            items.push(this.resultItem(pasted.name || pointText(pasted.point), `${pointText(pasted.point)} · name it next`, () => this.openHand(pasted)));
        }
        this.setResults(items);
    }

    resultItem(title, description, onPick) {
        const li = element('li');
        li.setAttribute('role', 'option');
        const b = element('button');
        b.type = 'button';
        b.append(element('span', 'result-title', title), element('span', 'result-description', description));
        b.addEventListener('click', onPick);
        li.append(b);
        return li;
    }

    /**
     * @param {object[]|null} remote - Wikidata's places, null while it is searched
     * @param {object[]|null|undefined} osm - OpenStreetMap's places once asked for, null while it is searched
     */
    showResults(text, local, remote, osm) {
        const items = [];
        const group = (title, places) => {
            if (!places.length) return;
            items.push(element('li', 'loc-group', title));
            for (const place of places) items.push(this.resultItem(place.label, place.subtitle || pointNote(place.location), () => this.pick(place.location)));
        };
        group('Our places', local);
        if (remote === null) items.push(element('li', 'loc-group muted', 'Searching Wikidata…'));
        else group('From Wikidata', remote);
        if (remote !== null && osm === undefined) {
            const li = this.resultItem(`Search OpenStreetMap for “${text}”`, 'Streets, buildings and places missing from Wikidata', () => this.searchOsm(text, local, remote));
            li.classList.add('loc-osm');
            items.push(li);
        } else if (osm === null) {
            items.push(element('li', 'loc-group muted', 'Searching OpenStreetMap…'));
        } else if (osm) {
            group('From OpenStreetMap', osm);
            if (!local.length && !remote.length && !osm.length) items.push(element('li', 'loc-group muted', `No place found for “${text}”. Paste its coordinates or a map link, or enter it by hand below.`));
        }
        this.setResults(items);
    }

    async searchOsm(text, local, remote) {
        const ticket = ++this.ticket;
        this.showResults(text, local, remote, null);
        const osm = await this.search.osm(text, [...local, ...remote]);
        if (ticket === this.ticket) this.showResults(text, local, remote, osm);
    }

    setResults(items) {
        this.results.replaceChildren(...items);
        this.results.hidden = !items.length;
        this.input.setAttribute('aria-expanded', String(!this.results.hidden));
    }

    hideResults() {
        clearTimeout(this.timer);
        this.ticket++;
        this.results.hidden = true;
        this.results.replaceChildren();
        this.input.setAttribute('aria-expanded', 'false');
    }
}
