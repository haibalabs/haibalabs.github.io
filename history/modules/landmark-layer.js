// landmark-layer.js
// Landmark icons on the map, from a historiline-landmarks/v1 table (the published release's, read by
// published-data.js; the map lab passes its own rounds). A higher tier shows from a closer zoom, and of two
// icons that overlap on screen, the higher tier is kept, then the one with more events. Clicking an icon
// lists its places' events, as a bubble does; a landmark with no events (no place_ids, or none with events)
// opens its first link instead. Its badge opens the first link.
//
// iconUrl(sha256) gives an icon's address. A landmark with no icon is left out, unless placeholders is on
// (the lab only), which draws a plain lettered marker so a set can be judged before its icons are made.

// the zoom each tier first shows at, and the icon's size on screen
const MIN_ZOOM = { 1: 0, 2: 5, 3: 9 };
const SIZE = 44;
// An icon never covers more than MAX_GROUND_METRES of ground: zoomed out it shrinks, and it reaches SIZE only
// from about zoom 5. Where the cap would make it smaller than MIN_SIZE, too small to read, it is hidden: at
// zoom 2 and below everywhere, and at zoom 3 near the equator. Below BADGE_SIZE its badge is too small to
// tap, so the badge is hidden.
const MAX_GROUND_METRES = 250000;
const MIN_SIZE = 14;
const BADGE_SIZE = 28;
const EARTH_CIRCUMFERENCE = 40075016.686;
const sizeAt = ([lat], zoom) => {
    const metresPerPixel = EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180) / 2 ** (zoom + 8);
    return Math.floor(Math.min(SIZE, MAX_GROUND_METRES / metresPerPixel));
};
// sets a shown icon's size, keeping its base on the landmark's point
function resize(marker, size) {
    const node = marker.getElement();
    if (!node || node.dataset.size === String(size)) return;
    node.dataset.size = size;
    Object.assign(node.style, { width: `${size}px`, height: `${size}px`, marginLeft: `${-size / 2}px`, marginTop: `${-size * (SIZE - 4) / SIZE}px` });
    node.classList.toggle('map-landmark-small', size < BADGE_SIZE);
}
const SOURCE_NAMES = { wikipedia: 'Wikipedia' };

export class LandmarkLayer {
    constructor(browser, landmarks, { iconUrl, placeholders = false }) {
        this.browser = browser;
        this.map = browser.map;
        this.iconUrl = iconUrl;
        // above the base map, below the selection (overlay pane, 400) and the event bubbles (450)
        if (!this.map.getPane('landmarks')) this.map.createPane('landmarks').style.zIndex = 350;
        this.layer = L.layerGroup();
        this.entries = landmarks.filter(landmark => landmark.icon || placeholders)
            .map(landmark => ({ landmark, marker: this.marker(landmark), shown: false }));
        this.place = () => this.placeIcons();
    }
    marker(landmark) {
        const link = landmark.links?.[0];
        const content = document.createElement('div');
        content.className = 'map-landmark-content';
        if (landmark.icon) {
            content.append(Object.assign(document.createElement('img'), { src: this.iconUrl(landmark.icon), alt: '', width: SIZE, height: SIZE, draggable: false }));
        } else {
            content.append(Object.assign(document.createElement('span'), { className: 'map-landmark-placeholder', textContent: landmark.label[0] }));
        }
        if (link) {
            const info = Object.assign(document.createElement('a'), { className: 'landmark-info', href: link.url, textContent: 'i' });
            info.setAttribute('aria-label', `About ${landmark.label} on ${SOURCE_NAMES[link.source] ?? link.source}`);
            info.title = info.getAttribute('aria-label');
            L.DomEvent.on(info, 'click', event => {
                L.DomEvent.stopPropagation(event);
                // a modified click still opens the link itself
                if (link.source !== 'wikipedia' || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
                event.preventDefault();
                this.openLink(link, info);
            });
            content.append(info);
        }
        const marker = L.marker(landmark.point, {
            pane: 'landmarks', title: landmark.label, alt: landmark.label, keyboard: true,
            icon: L.divIcon({ className: 'map-landmark', html: content, iconSize: [SIZE, SIZE], iconAnchor: [SIZE / 2, SIZE - 4] }),
        });
        marker.on('click', () => this.open(landmark));
        return marker;
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
    // its events in the bubbles' list; with none, its first link
    open(landmark) {
        const ids = this.eventIds(landmark);
        if (ids.length) {
            this.browser.clusters.showList(landmark.point, ids);
        } else if (landmark.links?.length) {
            // a failed article disables the element it was opened from, so the marker passes a stand-in
            this.openLink(landmark.links[0], document.createElement('span'));
        } else {
            const text = Object.assign(document.createElement('p'), { className: 'map-landmark-empty', textContent: `No events at ${landmark.label} yet.` });
            L.popup({ className: 'map-event-popup' }).setLatLng(landmark.point).setContent(text).openOn(this.map);
        }
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
            const size = sizeAt(landmark.point, zoom);
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
