// The lab's switches. Each variant has an id (used in ?lab=), a label, a one-line note on what it
// changes against main, and apply(lab, value), which must undo itself for value = null. A plain
// switch gets true/null; a variant with choices gets the chosen id/null and shows as a picker.
import { siteDot } from './lab-map-browser.js';

const BLUE = '#3b82f6';
const PRECISION = {
    site:        { tooltip: 'Exact site', options: { radius: 6, weight: 2, color: '#fff', fillColor: '#1d4ed8', fillOpacity: 1 } },
    exact:       { tooltip: 'Exact site', options: { radius: 6, weight: 2, color: '#fff', fillColor: '#1d4ed8', fillOpacity: 1 } },
    settlement:  { tooltip: 'Town or city', options: { radius: 7, stroke: false, fillColor: BLUE, fillOpacity: 0.9 } },
    region:      { tooltip: 'Somewhere in this region', options: { radius: 26, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.1 } },
    country:     { tooltip: 'Somewhere in this country', options: { radius: 34, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.08 } },
    polity:      { tooltip: 'Somewhere in this state', options: { radius: 34, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.08 } },
    approximate: { tooltip: 'Approximate: around here', options: { radius: 16, weight: 1.5, dashArray: '3 3', color: BLUE, fillColor: BLUE, fillOpacity: 0.16 } },
};
const precisionDot = point => PRECISION[point.precision] ?? PRECISION.approximate;

const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STADIA_TILES = 'https://tiles.stadiamaps.com/tiles/';
const STADIA_OWN = '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> ' + OSM;
const STADIA = '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://stamen.com/">Stamen Design</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> ' + OSM;
// Raster base maps drawn from OpenStreetMap data. tone names a CSS filter in lab.css; maxNative is the
// deepest zoom the server draws, beyond which Leaflet enlarges its tiles.
const BASES = [
    { id: 'osm', label: 'OpenStreetMap in colour', note: 'The site’s own tiles and server, without the gray filter.',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM, maxNative: 19 },
    { id: 'osm-warm', label: 'OpenStreetMap, warm paper', note: 'The site’s own tiles and server, tinted sepia instead of gray.',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM, maxNative: 19, tone: 'warm' },
    { id: 'smooth', label: 'Stadia Alidade Smooth', note: 'Calm, muted colours with English-leaning labels; has a dark version. Stadia: free on localhost, a registered Stadia account for the public site.',
        url: `${STADIA_TILES}alidade_smooth/{z}/{x}/{y}{r}.png`, dark: `${STADIA_TILES}alidade_smooth_dark/{z}/{x}/{y}{r}.png`, attribution: STADIA_OWN, maxNative: 20 },
    { id: 'terrain', label: 'Stamen Terrain', note: 'Shaded hills, forests and rivers with light labels. Same Stadia terms.',
        url: `${STADIA_TILES}stamen_terrain/{z}/{x}/{y}{r}.png`, attribution: STADIA, maxNative: 18 },
    { id: 'terrain-bare', label: 'Stamen Terrain, no labels or borders', note: 'Only land, relief and water, so nothing on the map is from today. Same Stadia terms.',
        url: `${STADIA_TILES}stamen_terrain_background/{z}/{x}/{y}{r}.png`, attribution: STADIA, maxNative: 18 },
    { id: 'watercolor', label: 'Stamen Watercolor', note: 'Hand-painted look, no labels; faint modern borders. Same Stadia terms.',
        url: `${STADIA_TILES}stamen_watercolor/{z}/{x}/{y}.jpg`, attribution: STADIA, maxNative: 16 },
    { id: 'hot', label: 'OpenStreetMap Humanitarian', note: 'A brighter OSM style from OpenStreetMap France’s servers; free, no key, works on the public site.',
        url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', attribution: `${OSM}, tiles by <a href="https://www.hotosm.org/">HOT</a> hosted by <a href="https://openstreetmap.fr/">OSM France</a>`, maxNative: 19 },
    { id: 'topo', label: 'OpenTopoMap', note: 'Relief and contour lines; free (CC BY-SA), busier and slower to load.',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: `${OSM}, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC BY-SA)`, maxNative: 17 },
];

const isDark = () => {
    const theme = document.documentElement.dataset.theme;
    return theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
};

function setBase(lab, id) {
    const { map } = lab;
    lab.siteTiles ??= (() => { const tiles = []; map.eachLayer(l => { if (l instanceof L.TileLayer) tiles.push(l); }); return tiles; })();
    if (lab.baseTiles) map.removeLayer(lab.baseTiles);
    lab.baseTiles = null;
    const base = BASES.find(b => b.id === id);
    document.body.dataset.labBase = base ? base.tone ?? 'plain' : '';
    if (!base) {
        if (!lab.siteTiles.some(l => map.hasLayer(l))) lab.siteTiles[0]?.addTo(map);
        return;
    }
    for (const tiles of lab.siteTiles) map.removeLayer(tiles);
    lab.baseTiles = L.tileLayer(isDark() && base.dark ? base.dark : base.url, {
        attribution: base.attribution, subdomains: base.subdomains ?? 'abc',
        maxNativeZoom: base.maxNative, maxZoom: 19,
    }).addTo(map);
}

const FullWindow = L.Control.extend({
    options: { position: 'topleft' },
    onAdd(map) {
        const bar = L.DomUtil.create('div', 'leaflet-bar lab-full-control');
        this.link = L.DomUtil.create('a', '', bar);
        this.link.href = '#';
        this.link.setAttribute('role', 'button');
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(this.link, 'click', e => { L.DomEvent.preventDefault(e); this.set(!this.full); });
        this.onKey = e => { if (e.key === 'Escape' && this.full) this.set(false); };
        document.addEventListener('keydown', this.onKey);
        this.map = map;
        this.render();
        return bar;
    },
    onRemove() {
        this.set(false);
        document.removeEventListener('keydown', this.onKey);
    },
    set(full) {
        this.full = full;
        document.body.classList.toggle('lab-map-full', full);
        this.render();
        requestAnimationFrame(() => this.map.invalidateSize({ pan: false }));
    },
    render() {
        const label = this.full ? 'Exit full window' : 'Fill the window';
        this.link.title = label;
        this.link.setAttribute('aria-label', label);
        this.link.innerHTML = `<i class="fa-light ${this.full ? 'fa-compress' : 'fa-expand'}" aria-hidden="true"></i>`;
    },
});

export const VARIANTS = [
    {
        id: 'base',
        label: 'Base map',
        note: 'The site uses OpenStreetMap’s own tiles in grayscale. These are other looks of the same OpenStreetMap data.',
        choices: BASES,
        defaultLabel: 'Site today: grayscale OpenStreetMap',
        apply: setBase,
    },
    {
        id: 'full-window',
        label: 'Full-window button',
        note: 'Adds a button under + / − that lets the map fill the whole window. Esc or the button returns; clicking a dot returns to its card.',
        apply(lab, on) {
            if (on) {
                lab.fullWindow = new FullWindow().addTo(lab.map);
                lab.browser.beforeShowCard = () => lab.fullWindow?.full && lab.fullWindow.set(false);
            } else {
                lab.fullWindow?.remove();
                lab.fullWindow = null;
                lab.browser.beforeShowCard = null;
            }
        },
    },
    {
        id: 'street-zoom',
        label: 'Zoom to street level',
        note: 'Raises the zoom limit from 7 to 18, and dims + / − when they can’t go further (the site already disables them, but they look active).',
        apply(lab, on) {
            lab.map.setMaxZoom(on ? 18 : 7);
            document.body.classList.toggle('lab-zoom-limits', Boolean(on));
        },
    },
    {
        id: 'precision',
        label: 'Show precision',
        note: 'An approximate point becomes a soft dashed ring; towns stay a dot, reviewed sites a ringed dot. Hover for the meaning.',
        apply(lab, on) {
            lab.browser.dotFor = on ? precisionDot : siteDot;
            lab.browser.drawSelection();
        },
    },
];
