// The lab's switches. Each variant has an id (used in ?lab=), a label, a one-line note on what it
// changes against main, and apply(lab, value), which must undo itself for value = null. A plain
// switch gets true/null; a variant with choices gets the chosen id/null and shows as a picker.
// initial is its value when the link has no ?lab=: the picks so far.
import { siteDot } from './lab-map-browser.js';
import { loadMapLibre, ownStyle } from './own-style.js';
import { ColorEditor, readColors } from './color-editor.js';
import { lookupOutline, outlineQuery } from './outlines.js';

const BLUE = '#3b82f6';
const PRECISION = {
    site:        { tooltip: 'Exact site', options: { radius: 6, weight: 2, color: '#fff', fillColor: '#1d4ed8', fillOpacity: 1 } },
    exact:       { tooltip: 'Exact site', options: { radius: 6, weight: 2, color: '#fff', fillColor: '#1d4ed8', fillOpacity: 1 } },
    settlement:  { tooltip: 'Town or city', options: { radius: 7, stroke: false, fillColor: BLUE, fillOpacity: 0.9 } },
    region:      { tooltip: 'Somewhere in this region', options: { radius: 26, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.1 } },
    country:     { tooltip: 'Somewhere in this country', options: { radius: 34, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.08 } },
    polity:      { tooltip: 'Somewhere in this state', options: { radius: 34, weight: 1, dashArray: '2 4', color: BLUE, fillColor: BLUE, fillOpacity: 0.08 } },
    approximate: { tooltip: 'Approximate location', options: { radius: 16, weight: 1.5, dashArray: '3 3', color: BLUE, fillColor: BLUE, fillOpacity: 0.16 } },
};
const precisionDot = point => PRECISION[point.precision] ?? PRECISION.approximate;
// Ground sizes for "to scale" rings: display choices, not measured extents, since T7 records none.
// Approximate is the resolver's 10 km placement tolerance. A ring is never drawn smaller than its fixed size.
const GROUND_METRES = { settlement: 3000, approximate: 10000, region: 100000, country: 300000, polity: 300000 };
const scaledDot = point => {
    const dot = precisionDot(point);
    const metres = GROUND_METRES[point.precision] ?? (PRECISION[point.precision] ? null : GROUND_METRES.approximate);
    return metres ? { ...dot, metres } : dot;
};
// Selecting an event fits its rings so a ring spans about a third of the map; a site, which has no
// ring, is shown as if it had a 2.5 km one, so the streets or valley around it stay in view.
const SITE_VIEW_METRES = 2500;
const precisionView = map => points => {
    const bounds = L.latLngBounds([]);
    for (const point of points) {
        const metres = GROUND_METRES[point.precision] ?? (PRECISION[point.precision] ? SITE_VIEW_METRES : GROUND_METRES.approximate);
        bounds.extend(L.latLng(point.coordinates).toBounds(metres * 3.3));
    }
    return { bounds, maxZoom: map.getMaxZoom() };
};

const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STADIA_TILES = 'https://tiles.stadiamaps.com/tiles/';
const STADIA_OWN = '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> ' + OSM;
const STADIA = '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://stamen.com/">Stamen Design</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> ' + OSM;
// Base maps drawn from OpenStreetMap data. tone names a CSS filter in lab.css; maxNative is the
// deepest zoom the server draws, beyond which Leaflet enlarges its tiles. A base with style is our
// own vector style (own-style.js) rather than a provider's images.
const BASES = [
    { id: 'osm', label: 'OpenStreetMap in colour', note: 'The site’s own tiles and server, without the gray filter.',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM, maxNative: 19 },
    { id: 'osm-warm', label: 'OpenStreetMap, warm paper', note: 'The site’s own tiles and server, tinted sepia instead of gray.',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM, maxNative: 19, tone: 'warm' },
    { id: 'own-terrain', label: 'Our own style: terrain', note: 'OpenStreetMap data drawn in our colours, with shaded hills, today’s borders, main roads and names. Free, no key; has a dark version.',
        style: 'terrain' },
    { id: 'own-bare', label: 'Our own style: no modern features', note: 'Only land, forests, water and shaded hills, plus sea and river names: no borders, roads or towns from today. Free, no key; has a dark version.',
        style: 'bare' },
    { id: 'osm-terrain', label: 'Our own style: terrain, OSM’s own tiles', note: 'The terrain style drawn from OpenStreetMap’s own vector tiles: far smaller downloads, but forests appear from zoom 8, river lines from 10, and seas have no names.',
        style: 'terrain', tiles: 'osm' },
    { id: 'osm-bare', label: 'Our own style: no modern features, OSM’s own tiles', note: 'The no-modern-features style drawn from OpenStreetMap’s own vector tiles, with the same trade-offs.',
        style: 'bare', tiles: 'osm' },
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

async function setBase(lab, id) {
    const { map } = lab;
    lab.siteTiles ??= (() => { const tiles = []; map.eachLayer(l => { if (l instanceof L.TileLayer) tiles.push(l); }); return tiles; })();
    lab.baseId = id;
    if (lab.baseTiles) map.removeLayer(lab.baseTiles);
    lab.baseTiles = null;
    map.setMaxBounds(null);
    const base = BASES.find(b => b.id === id);
    lab.base = base;
    lab.baseStyle = base?.style ?? null;
    lab.colorEditor?.render();
    // A provider without a dark style is dimmed in the dark theme rather than inverted like the site's tiles.
    document.body.dataset.labBase = !base ? '' : base.tone ?? (isDark() && !base.dark && !base.style ? 'dim' : 'plain');
    const showSiteTiles = () => { if (!lab.siteTiles.some(l => map.hasLayer(l))) lab.siteTiles[0]?.addTo(map); };
    if (!base) return showSiteTiles();
    for (const tiles of lab.siteTiles) map.removeLayer(tiles);
    if (base.style) {
        try {
            await loadMapLibre();
        } catch (err) {
            console.error('Map lab: MapLibre did not load, showing the site tiles', err);
            document.body.dataset.labBase = '';
            return showSiteTiles();
        }
        if (lab.baseId !== id) return;
        // MapLibre stops at the Mercator latitude limit; Leaflet must too, or the two drift apart at the poles.
        map.setMaxBounds([[90, -Infinity], [-90, Infinity]]);
        lab.baseTiles = L.maplibreGL({ style: ownStyle(base.style, isDark(), readColors(isDark()), base.tiles) }).addTo(map);
        return;
    }
    lab.baseTiles = L.tileLayer(isDark() && base.dark ? base.dark : base.url, {
        attribution: base.attribution, subdomains: base.subdomains ?? 'abc',
        maxNativeZoom: base.maxNative, maxZoom: 19,
    }).addTo(map);
}

// Redraws our own style from the colours in the link; MapLibre diffs the style, so only paint changes apply.
function restyle(lab) {
    lab.baseTiles?.getMaplibreMap?.()?.setStyle(ownStyle(lab.baseStyle, isDark(), readColors(isDark()), lab.base.tiles));
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
        // first, so the base map below is built for the forced theme
        id: 'theme',
        label: 'Light or dark',
        note: 'The page follows your system’s setting. Lab only: force one for the whole page and the map.',
        choices: [
            { id: 'light', label: 'Light', note: 'The whole page and the map in light colours.' },
            { id: 'dark', label: 'Dark', note: 'The whole page and the map in dark colours.' },
        ],
        defaultLabel: 'Follow the system',
        apply(lab, theme) {
            if (theme) document.documentElement.dataset.theme = theme;
            else delete document.documentElement.dataset.theme;
            if (lab.baseId !== undefined) setBase(lab, lab.baseId);
            lab.colorEditor?.render();
        },
    },
    {
        id: 'base',
        label: 'Base map',
        note: 'The site uses OpenStreetMap’s own tiles in grayscale. These are other looks of the same OpenStreetMap data.',
        choices: BASES,
        defaultLabel: 'Site today: grayscale OpenStreetMap',
        initial: 'osm-terrain',
        apply: setBase,
    },
    {
        id: 'colors',
        label: 'Colour editor',
        note: 'A panel above this one with a picker for each colour of our own styles and a hill-strength slider. Changes show as you drag and are kept in the link.',
        apply(lab, on) {
            lab.colorEditor?.remove();
            lab.colorEditor = on ? new ColorEditor(lab, lab.dock, { isDark, restyle: () => restyle(lab) }) : null;
        },
    },
    {
        id: 'full-window',
        label: 'Full-window button',
        note: 'Adds a button under + / − that lets the map fill the whole window. Esc or the button returns; clicking a dot returns to its card.',
        initial: true,
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
        id: 'zoom',
        label: 'Zoom limit',
        note: 'How far in + can go. Any choice also dims + / − when they can’t go further (the site already disables them, but they look active).',
        choices: [
            { id: '13', label: '13: a city’s districts', note: 'Neighbourhoods and main streets. Dims + / − at the limits.' },
            { id: '14', label: '14: streets', note: 'Most streets named. Dims + / − at the limits.' },
            { id: '18', label: '18: buildings', note: 'Street level, beyond what most of our points can claim. Dims + / − at the limits.' },
        ],
        defaultLabel: 'Site today: 7, a region',
        initial: '14',
        apply(lab, limit) {
            lab.map.setMaxZoom(limit ? Number(limit) : 7);
            document.body.classList.toggle('lab-zoom-limits', Boolean(limit));
        },
    },
    {
        id: 'precision',
        label: 'Show precision',
        note: 'Every point is the same blue dot on the site, whether a reviewed site or a city centre standing for “around here”.',
        choices: [
            { id: 'fixed', label: 'Rings of a fixed size', note: 'An approximate point becomes a soft dashed ring; towns stay a dot, reviewed sites a ringed dot. Hover for the meaning.' },
            { id: 'scale', label: 'Rings to scale', note: 'As fixed, but towns, approximate points and regions grow with the zoom to cover the ground they may stand for: towns 3 km, approximate 10 km, regions 100 km, countries 300 km.' },
        ],
        defaultLabel: 'Off: the same dot for every point',
        initial: 'scale',
        apply(lab, mode) {
            lab.browser.dotFor = mode === 'scale' ? scaledDot : mode ? precisionDot : siteDot;
            // with precision shown, selecting an event zooms to its ring instead of main's region view
            lab.browser.viewFor = mode ? precisionView(lab.map) : null;
            lab.browser.drawSelection();
        },
    },
    {
        id: 'outlines',
        label: 'Outlines (live test)',
        note: 'With rings to scale: looks the place up in OpenStreetMap’s place search when an event is selected, and draws today’s outline in place of the ring when it finds one. A test of the look only; the public site can’t query this service on every click.',
        initial: true,
        apply(lab, on) {
            lab.browser.outlineFor = on ? (point, event) => {
                const location = event.locations?.find(l => l.place_id === point.placeId);
                return lookupOutline(location ? outlineQuery(location) : point.name, point.coordinates);
            } : null;
            lab.browser.drawSelection();
        },
    },
    {
        id: 'labels',
        label: 'Event label on the map',
        note: 'The selected event’s name and date float above its dot, with what the dot’s precision means.',
        initial: true,
        apply(lab, on) {
            lab.browser.labels = Boolean(on);
            lab.browser.drawSelection();
        },
    },
];
