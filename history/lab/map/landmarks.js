// Lab test only (T123): landmark icons on the map, before the release serves its landmark table (T121).
// The five landmarks below are Iris's style samples (T122), with the place rows each one covers in the
// current release. A higher tier shows from a closer zoom, and of two icons that overlap on screen, the
// higher tier (then the earlier in the list) is kept. Clicking an icon lists its places' events, as a
// bubble does; its badge opens the first of its links.

const icon = name => new URL(`landmarks/${name}.webp`, import.meta.url).href;

export const SAMPLE = [
    { wikidata: 'Q37200', name: 'Great Pyramid of Giza', point: [29.9792, 31.1342], tier: 1, icon: icon('giza'),
        links: [{ source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza' }],
        // the release has no pyramid place: its events are placed at the town of Giza
        placeIds: ['plc_8cbb93dd-a223-568e-b091-245b844e1df1', 'plc_c2599057-4dc6-54c9-a9e6-dc762974579c', 'plc_40d21b8e-eccd-53cd-8761-2e932cc2ed00'] },
    { wikidata: 'Q10285', name: 'Colosseum', point: [41.8902, 12.4922], tier: 1, icon: icon('colosseum'),
        links: [{ source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Colosseum' }],
        placeIds: ['plc_da21db22-e193-5ad2-ba69-fde1282ff71b', 'plc_af9fd386-2332-592d-9fb6-5290c004eb43'] },
    { wikidata: 'Q9141', name: 'Taj Mahal', point: [27.1751, 78.0421], tier: 1, icon: icon('taj-mahal'),
        links: [{ source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Taj_Mahal' }],
        placeIds: ['plc_42b640d2-470b-5b62-b56d-a7c1fb5917a0'] },
    { wikidata: 'Q39231', name: 'Mount Fuji', point: [35.3606, 138.7274], tier: 1, icon: icon('mount-fuji'),
        links: [{ source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Mount_Fuji' }],
        placeIds: ['plc_4b544707-1ba4-59c2-9e27-5a94e3c947a2', 'plc_2d3ea64e-437a-59f2-8026-20a61bcacf9b', 'plc_22bc9bd1-f870-5d99-ab0c-43ecf7b0022f',
            'plc_0e07a1a3-2402-52cd-a6de-109c0033e4ae', 'plc_ab2dccf8-384a-5130-9db0-4ae32d72ebeb'] },
    // tier 2 in the lab only, to show a landmark appearing as you zoom in
    { wikidata: 'Q43473', name: 'Angkor Wat', point: [13.4125, 103.867], tier: 2, icon: icon('angkor-wat'),
        links: [{ source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Angkor_Wat' }],
        placeIds: ['plc_65aeb3c7-9214-5a09-abb5-41d138ec541d', 'plc_11f139cc-5e0e-5c48-a30b-4ff1038cc936', 'plc_a7196aba-3cfb-5f5f-9ec6-595405c31923'] },
];

// the zoom each tier first shows at, and the icon's size on screen
const MIN_ZOOM = { 1: 0, 2: 5, 3: 9 };
const SIZE = 44;
const SOURCE_NAMES = { wikipedia: 'Wikipedia' };

export class LandmarkLayer {
    constructor(browser, landmarks = SAMPLE) {
        this.browser = browser;
        this.map = browser.map;
        // above the base map, below the selection (overlay pane, 400) and the event bubbles (450)
        if (!this.map.getPane('landmarks')) this.map.createPane('landmarks').style.zIndex = 350;
        this.layer = L.layerGroup();
        this.entries = landmarks.map(landmark => ({ landmark, marker: this.marker(landmark), shown: false }));
        this.place = () => this.placeIcons();
    }
    marker(landmark) {
        const link = landmark.links?.[0];
        const html = `<img src="${landmark.icon}" alt="" width="${SIZE}" height="${SIZE}" draggable="false">`
            + (link ? `<a class="landmark-info" target="_blank" rel="noopener" href="${link.url}">i</a>` : '');
        const marker = L.marker(landmark.point, {
            pane: 'landmarks', title: landmark.name, alt: landmark.name, keyboard: true,
            icon: L.divIcon({ className: 'map-landmark', html, iconSize: [SIZE, SIZE], iconAnchor: [SIZE / 2, SIZE - 4] }),
        });
        marker.on('add', () => {
            const info = marker.getElement()?.querySelector('.landmark-info');
            if (!info) return;
            info.setAttribute('aria-label', `About ${landmark.name} on ${SOURCE_NAMES[link.source] ?? link.source} (opens a new tab)`);
            info.title = info.getAttribute('aria-label');
            L.DomEvent.on(info, 'click', L.DomEvent.stopPropagation);
        });
        marker.on('click', () => this.open(landmark));
        return marker;
    }
    // the events at the landmark's places, earliest first, in the bubbles' list
    open(landmark) {
        const index = this.browser.manager.placeIndex;
        const ids = new Set();
        for (const placeId of landmark.placeIds) for (const id of index.places.get(placeId) ?? []) ids.add(id);
        const sorted = [...ids].sort((a, b) => (index.years.get(a) ?? 0) - (index.years.get(b) ?? 0));
        if (sorted.length) {
            this.browser.clusters.showList(landmark.point, sorted);
        } else {
            L.popup({ className: 'map-event-popup' }).setLatLng(landmark.point)
                .setContent(`<p class="map-landmark-empty">No events at ${landmark.name} yet.</p>`).openOn(this.map);
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
    // Shows the landmarks whose tier this zoom allows, keeping the higher tier where two overlap on screen.
    placeIcons() {
        const zoom = this.map.getZoom();
        const taken = [];
        const order = [...this.entries].sort((a, b) => a.landmark.tier - b.landmark.tier);
        for (const entry of order) {
            const { landmark, marker } = entry;
            let show = zoom >= (MIN_ZOOM[landmark.tier] ?? MIN_ZOOM[3]);
            if (show) {
                const p = this.map.latLngToLayerPoint(landmark.point);
                const box = { x0: p.x - SIZE / 2, x1: p.x + SIZE / 2, y0: p.y - SIZE, y1: p.y };
                show = !taken.some(t => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0);
                if (show) taken.push(box);
            }
            if (show !== entry.shown) {
                if (show) this.layer.addLayer(marker); else this.layer.removeLayer(marker);
                entry.shown = show;
            }
        }
    }
}
