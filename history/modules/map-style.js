// map-style.js
// The base map: OpenStreetMap's own vector tiles (Shortbread schema) drawn by MapLibre GL under Leaflet,
// with Mapzen hill shading and Natural Earth relief, all keyless. See MAP-BROWSING.md, "Base map".
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl';
const BINDING = 'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js';
// Joins Arabic letters and lays out right-to-left scripts. Loaded before the map draws: NAME asks
// is-supported-script, which says no to Arabic until the plugin is in, and a lazy load would never start.
const RTL_TEXT = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js';

const script = src => new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(tag);
});

export function supportsWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
        return false;
    }
}

let loading = null;
export function loadMapLibre() {
    loading ??= (async () => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = `${MAPLIBRE}.css`;
        document.head.append(css);
        await script(`${MAPLIBRE}.js`);
        await maplibregl.setRTLTextPlugin(RTL_TEXT, false).catch(error => console.error('Right-to-left map text did not load', error));
        await script(BINDING);
    })().catch(err => { loading = null; throw err; });
    return loading;
}

// Light follows Stamen Terrain, sampled from its tiles: pale yellow-green lowlands, olive forests and
// hill shadows, blue-grey water, grey towns and roads, near-black labels. Dark keeps those hues, dimmed.
// hills scales the hill shading (1 as designed); halo is drawn at 85% opacity.
const PALETTES = {
    light: {
        land: '#e4e6b6', wood: '#a9bd86', grass: '#ccd79f', sand: '#ece3b8', ice: '#f4f7f8', wetland: '#c3d3a8',
        water: '#99b2ca', river: '#8aa7c3', waterText: '#47698c',
        shadow: '#55643f', highlight: '#ffffff', accent: '#66744d', hills: 1.4, relief: { opacity: 0.7, brightness: 1 },
        road: '#ffffff', roadCasing: '#9d9d96', building: '#dededb', border: '#56564f',
        text: '#1f201b', halo: '#ffffff',
    },
    dark: {
        land: '#22271f', wood: '#2c3826', grass: '#283022', sand: '#34322a', ice: '#3b4146', wetland: '#25302a',
        water: '#1a2a39', river: '#2c4862', waterText: '#93b4cf',
        shadow: '#000000', highlight: '#5f6a52', accent: '#000000', hills: 1.2, relief: { opacity: 0.35, brightness: 0.45 },
        road: '#4a4d46', roadCasing: '#2b2d28', building: '#35382f', border: '#8c8b80',
        text: '#e6e4da', halo: '#151812',
    },
};
const translucent = hex => `${hex}d9`;

// English name, else the local one. MapLibre can't shape Indic scripts, Sinhala, Tibetan, Myanmar or
// Khmer (vowel signs land after the consonant, stacks come apart), so a local name in those is left
// unlabelled rather than drawn wrong; is-supported-script is how MapLibre says it can draw a string.
const NAME = ['case',
    ['has', 'name_en'], ['get', 'name_en'],
    ['is-supported-script', ['coalesce', ['get', 'name'], '']], ['coalesce', ['get', 'name'], ''],
    ''];
const ATTRIBUTION = {
    osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    terrain: 'relief <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Mapzen</a>, <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a>',
};

// Natural Earth's coloured relief carries the world view until the vector land cover takes over.
const worldRelief = c => ({ id: 'natural-earth', type: 'raster', source: 'natural-earth', maxzoom: 5,
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, c.relief.opacity, 3, c.relief.opacity * 0.5, 5, 0],
        'raster-brightness-max': c.relief.brightness, 'raster-saturation': -0.25 } });
const hills = c => ({ id: 'hills', type: 'hillshade', source: 'elevation', maxzoom: 12,
    paint: { 'hillshade-shadow-color': c.shadow, 'hillshade-highlight-color': c.highlight, 'hillshade-accent-color': c.accent,
        'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], ...[[2, 0.45], [8, 0.3], [12, 0.2]].flatMap(([z, e]) => [z, Math.min(1, e * c.hills)])] } });
const riverWidth = ['interpolate', ['exponential', 1.4], ['zoom'], 5, 0.6, 9, 1.4, 13, 4];

// Land, water and relief. Forests start at zoom 7 and river lines at 9 in these tiles.
function ground(c) {
    const cover = (id, kinds, color) => ({
        id, type: 'fill', source: 'shortbread', 'source-layer': 'land',
        filter: ['match', ['get', 'kind'], kinds, true, false], paint: { 'fill-color': color, 'fill-opacity': 0.8 },
    });
    return [
        { id: 'land', type: 'background', paint: { 'background-color': c.land } },
        worldRelief(c),
        cover('wood', ['forest'], c.wood),
        cover('grass', ['grass', 'meadow', 'grassland', 'heath', 'scrub', 'farmland', 'orchard', 'vineyard', 'park', 'village_green', 'recreation_ground'], c.grass),
        cover('sand', ['sand', 'beach', 'bare_rock', 'scree', 'shingle'], c.sand),
        cover('wetland', ['swamp', 'bog', 'string_bog', 'wet_meadow', 'marsh'], c.wetland),
        { id: 'ice', type: 'fill', source: 'shortbread', 'source-layer': 'water_polygons',
            filter: ['==', ['get', 'kind'], 'glacier'], paint: { 'fill-color': c.ice } },
        hills(c),
        { id: 'ocean', type: 'fill', source: 'shortbread', 'source-layer': 'ocean', paint: { 'fill-color': c.water } },
        { id: 'water', type: 'fill', source: 'shortbread', 'source-layer': 'water_polygons',
            filter: ['!=', ['get', 'kind'], 'glacier'], paint: { 'fill-color': c.water } },
        { id: 'rivers', type: 'line', source: 'shortbread', 'source-layer': 'water_lines',
            filter: ['all', ['match', ['get', 'kind'], ['river', 'canal'], true, false], ['!=', ['get', 'tunnel'], true]],
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': c.river, 'line-width': riverWidth } },
        { id: 'streams', type: 'line', source: 'shortbread', 'source-layer': 'water_lines',
            filter: ['==', ['get', 'kind'], 'stream'], paint: { 'line-color': c.river, 'line-width': 0.8 } },
    ];
}

function waterLabels(c) {
    const label = { 'text-color': c.waterText, 'text-halo-color': translucent(c.halo), 'text-halo-width': 1.2 };
    return [
        { id: 'river-names', type: 'symbol', source: 'shortbread', 'source-layer': 'water_lines_labels',
            filter: ['==', ['get', 'kind'], 'river'],
            layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.1 },
            paint: label },
        // Every pond is named in these tiles, so names come in by size (way_area, Mercator m²) as you zoom:
        // Lake Geneva at 5, Lake Annecy at 7, a large reservoir at 9; rivers drawn as areas from 6.
        ...[[5, 2e8], [7, 2e7], [9, 2e6], [11, 2e5]].map(([minzoom, area], i, bands) => ({
            id: `lake-names-${minzoom}`, type: 'symbol', source: 'shortbread', 'source-layer': 'water_polygons_labels', minzoom,
            filter: ['all', ['match', ['get', 'kind'], ['water', 'reservoir'], true, false], ['>=', ['get', 'way_area'], area],
                ...(i ? [['<', ['get', 'way_area'], bands[i - 1][1]]] : [])],
            layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-max-width': 6, 'text-size': 12, 'symbol-sort-key': ['-', ['get', 'way_area']] },
            paint: label,
        })),
        { id: 'river-area-names', type: 'symbol', source: 'shortbread', 'source-layer': 'water_polygons_labels', minzoom: 6,
            filter: ['all', ['==', ['get', 'kind'], 'river'], ['>=', ['get', 'way_area'], 1e6]],
            layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-max-width': 6, 'text-size': 12, 'text-letter-spacing': 0.1 },
            paint: label },
    ];
}

// Today's map on top of the ground: towns, main roads, borders and place names.
function today(c) {
    const road = (id, kinds, minzoom, widths) => [
        [`${id}-casing`, c.roadCasing, widths.map(([z, w]) => [z, w + 1])],
        [id, c.road, widths],
    ].map(([layerId, color, w]) => ({
        id: layerId, type: 'line', source: 'shortbread', 'source-layer': 'streets', minzoom,
        filter: ['all', ['match', ['get', 'kind'], kinds, true, false], ['!=', ['get', 'link'], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...w.flat()] },
    }));
    const text = { 'text-color': c.text, 'text-halo-color': translucent(c.halo), 'text-halo-width': 1.3 };
    const place = (id, kinds, size, minzoom) => ({
        id, type: 'symbol', source: 'shortbread', 'source-layer': 'place_labels', minzoom,
        filter: ['match', ['get', 'kind'], kinds, true, false],
        layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-max-width': 8, 'text-size': size,
            'symbol-sort-key': ['-', ['get', 'population']] },
        paint: text,
    });
    return [
        { id: 'built-up', type: 'fill', source: 'shortbread', 'source-layer': 'land',
            filter: ['match', ['get', 'kind'], ['residential', 'commercial', 'retail', 'industrial', 'railway', 'garages'], true, false],
            paint: { 'fill-color': c.building, 'fill-opacity': 0.85 } },
        ...road('minor-roads', ['tertiary', 'unclassified', 'residential'], 10, [[10, 0.3], [13, 2]]),
        ...road('main-roads', ['motorway', 'trunk', 'primary', 'secondary'], 5, [[5, 0.2], [9, 1], [13, 3.5]]),
        { id: 'borders', type: 'line', source: 'shortbread', 'source-layer': 'boundaries',
            filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], true]],
            layout: { 'line-join': 'round' },
            paint: { 'line-color': c.border, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.4] } },
        ...waterLabels(c),
        place('villages', ['village'], 11, 10),
        place('towns', ['town'], ['interpolate', ['linear'], ['zoom'], 7, 11, 12, 14], 7),
        place('cities', ['capital', 'state_capital', 'city'], ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 15, 12, 19], 3),
        { id: 'countries', type: 'symbol', source: 'shortbread', 'source-layer': 'boundary_labels', maxzoom: 7,
            filter: ['==', ['get', 'admin_level'], 2],
            layout: { 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 8,
                'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 5, 14], 'symbol-sort-key': ['-', ['get', 'way_area']] },
            paint: text },
    ];
}

// The MapLibre style for the light or dark theme. Fonts and Natural Earth's relief come from OpenFreeMap.
export function mapStyle(dark) {
    const c = PALETTES[dark ? 'dark' : 'light'];
    return {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
            shortbread: { type: 'vector', tiles: ['https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt'], maxzoom: 14, attribution: ATTRIBUTION.osm },
            // Both relief sources are 256 px images declared as 512, so MapLibre fetches a zoom coarser
            // (a quarter of the tiles); the shading is soft anyway. Elevation stops at 9 and is enlarged beyond,
            // and hills fade out at street zoom, where they cost the most and show the least.
            'natural-earth': { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'], tileSize: 512, maxzoom: 6 },
            elevation: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium', tileSize: 512, maxzoom: 9, attribution: ATTRIBUTION.terrain },
        },
        layers: [...ground(c), ...today(c)],
    };
}
