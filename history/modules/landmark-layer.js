// landmark-layer.js
// Landmark icons on the map, from a historiline-landmarks/v1 table (the published release's, read by
// published-data.js; the map lab passes its own rounds). A higher tier shows from a closer zoom, and of two
// icons that overlap on screen, the higher tier is kept, then the one with more events. Clicking an icon
// opens its bubble above it: the landmark's name as the list's title, with the scroll icon the cards use for
// Wikipedia, which opens its first link, then its places' events, or a note that it has none yet.
//
// iconUrl(sha256) gives an icon's address. A landmark with no icon yet is drawn as a circle with its initial.

// the zoom each tier first shows at, and the icon's size on screen
const MIN_ZOOM = { 1: 0, 2: 5, 3: 9 };
const SIZE = 44;
// An icon never covers more than MAX_GROUND_METRES of ground: zoomed out it shrinks, and it reaches SIZE only
// from about zoom 5. Only the world tier shows that far out, so it is what the world view shows: it never
// shrinks below WORLD_SIZE. Any other icon the cap would make smaller than MIN_SIZE, too small to read, is hidden.
const MAX_GROUND_METRES = 250000;
const MIN_SIZE = 14;
const WORLD_SIZE = 24;
const EARTH_CIRCUMFERENCE = 40075016.686;
const sizeAt = ({ point: [lat], tier }, zoom) => {
    const metresPerPixel = EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180) / 2 ** (zoom + 8);
    const size = Math.floor(Math.min(SIZE, MAX_GROUND_METRES / metresPerPixel));
    return tier === 1 ? Math.max(size, WORLD_SIZE) : size;
};
// sets a shown icon's size, keeping its base on the landmark's point
function resize(marker, size) {
    const node = marker.getElement();
    if (!node || node.dataset.size === String(size)) return;
    node.dataset.size = size;
    Object.assign(node.style, { width: `${size}px`, height: `${size}px`, marginLeft: `${-size / 2}px`, marginTop: `${-size * (SIZE - 4) / SIZE}px` });
}
const SOURCE_NAMES = { wikipedia: 'Wikipedia' };

export class LandmarkLayer {
    constructor(browser, landmarks, { iconUrl }) {
        this.browser = browser;
        this.map = browser.map;
        this.iconUrl = iconUrl;
        // above the base map, below the selection (overlay pane, 400) and the event bubbles (450)
        if (!this.map.getPane('landmarks')) this.map.createPane('landmarks').style.zIndex = 350;
        this.layer = L.layerGroup();
        this.entries = landmarks.map(landmark => ({ landmark, marker: this.marker(landmark), shown: false }));
        this.place = () => this.placeIcons();
    }
    marker(landmark) {
        const content = document.createElement('div');
        content.className = 'map-landmark-content';
        if (landmark.icon) {
            content.append(Object.assign(document.createElement('img'), { src: this.iconUrl(landmark.icon), alt: '', width: SIZE, height: SIZE, draggable: false }));
        } else {
            content.append(Object.assign(document.createElement('span'), { className: 'map-landmark-placeholder', textContent: landmark.label[0] }));
        }
        const marker = L.marker(landmark.point, {
            pane: 'landmarks', title: landmark.label, alt: landmark.label, keyboard: true,
            icon: L.divIcon({ className: 'map-landmark', html: content, iconSize: [SIZE, SIZE], iconAnchor: [SIZE / 2, SIZE - 4] }),
        });
        marker.on('click', () => this.open(landmark, marker));
        return marker;
    }
    // The bubble's title: the landmark's name with the scroll icon the cards use for Wikipedia, opening its
    // first link; without a link, just the name.
    title(landmark) {
        const link = landmark.links?.[0];
        const name = Object.assign(document.createElement('strong'), { textContent: landmark.label });
        if (!link) {
            const heading = Object.assign(document.createElement('p'), { className: 'map-event-list-title' });
            heading.append(name);
            return heading;
        }
        const heading = Object.assign(document.createElement('button'), { type: 'button', className: 'map-event-list-title' });
        heading.setAttribute('aria-label', `${landmark.label}: read about it on ${SOURCE_NAMES[link.source] ?? link.source}`);
        heading.title = heading.getAttribute('aria-label');
        const icon = Object.assign(document.createElement('i'), { className: 'fa-light fa-scroll' });
        icon.setAttribute('aria-hidden', 'true');
        heading.append(name, icon);
        // a failed article disables the element it was opened from, so the title passes a stand-in
        heading.addEventListener('click', () => this.openLink(link, document.createElement('span')));
        return heading;
    }
    // the events at the landmark's places, earliest first
    eventIds(landmark) {
        const index = this.browser.manager.placeIndex;
        const ids = new Set();
        for (const placeId of landmark.place_ids) for (const id of index.places.get(placeId) ?? []) ids.add(id);
        return [...ids].sort((a, b) => (index.years.get(a) ?? 0) - (index.years.get(b) ?? 0));
    }
    // A Wikipedia article opens in the site's own article panel, as a person's name in a card does; another
    // source opens in a new tab.
    openLink(link, anchor) {
        if (link.source !== 'wikipedia') {
            window.open(link.url, '_blank', 'noopener');
            return;
        }
        if (this.browser.fullWindow.full) this.browser.fullWindow.set(false);
        this.browser.panels.handleInfoClick(link.url, anchor);
    }
    // Its bubble, in the bubbles' list: titled with its name, opened above the icon so the icon stays in view.
    open(landmark, marker) {
        const height = Number(marker.getElement()?.dataset.size) || SIZE;
        this.browser.clusters.showList(landmark.point, this.eventIds(landmark), null, null,
            { title: () => this.title(landmark), offset: [0, 4 - height] });
    }
    show(on) {
        if (on) {
            this.layer.addTo(this.map);
            this.map.on('zoomend', this.place);
            this.placeIcons();
        } else {
            this.map.off('zoomend', this.place);
            this.layer.remove();
            for (const entry of this.entries) entry.shown = false;
            this.layer.clearLayers();
        }
    }
    // Shows the landmarks whose tier this zoom allows. Where two overlap on screen, the higher tier is kept,
    // then the one with more events.
    placeIcons() {
        const zoom = this.map.getZoom();
        const taken = [];
        if (this.eventsIndex !== this.browser.manager.placeIndex) {
            this.eventsIndex = this.browser.manager.placeIndex;
            for (const entry of this.entries) entry.events = this.eventIds(entry.landmark).length;
        }
        const order = [...this.entries].sort((a, b) => a.landmark.tier - b.landmark.tier || b.events - a.events);
        for (const entry of order) {
            const { landmark, marker } = entry;
            const size = sizeAt(landmark, zoom);
            let show = zoom >= (MIN_ZOOM[landmark.tier] ?? MIN_ZOOM[3]) && size >= MIN_SIZE;
            if (show) {
                const p = this.map.latLngToLayerPoint(landmark.point);
                const box = { x0: p.x - size / 2, x1: p.x + size / 2, y0: p.y - size, y1: p.y };
                show = !taken.some(t => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0);
                if (show) taken.push(box);
            }
            if (show !== entry.shown) {
                if (show) this.layer.addLayer(marker); else this.layer.removeLayer(marker);
                entry.shown = show;
            }
            if (show) resize(marker, size);
        }
    }
}
