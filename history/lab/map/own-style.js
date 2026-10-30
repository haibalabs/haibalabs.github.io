// Our own map style: OpenStreetMap vector tiles from OpenFreeMap, drawn in the browser by MapLibre GL
// under Leaflet (maplibre-gl-leaflet), with hills shaded from Mapzen's elevation tiles. All three are
// free and keyless. MapLibre is loaded only when one of these base maps is picked.
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl';
const BINDING = 'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js';

const script = src => new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(tag);
});

let loading = null;
export function loadMapLibre() {
    loading ??= (async () => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = `${MAPLIBRE}.css`;
        document.head.append(css);
        await script(`${MAPLIBRE}.js`);
        await script(BINDING);
    })().catch(err => { loading = null; throw err; });
    return loading;
}

// hills scales the hill shading (1 as designed); halo is drawn at 85% opacity.
export const PALETTES = {
    light: {
        land: '#efe9dc', wood: '#d5dfc0', grass: '#e4e8cd', sand: '#efe3c4', ice: '#fbfcfd', wetland: '#dde6d3',
        water: '#a9c9dd', river: '#8db5cf', waterText: '#3d6482',
        shadow: '#5a4f43', highlight: '#ffffff', accent: '#6e6253', hills: 1, relief: { opacity: 0.55, brightness: 1 },
        road: '#ffffff', roadCasing: '#d6cab4', building: '#e0d6c4', border: '#9b8aa6',
        text: '#3a342c', halo: '#fffcf5',
    },
    dark: {
        land: '#1e2227', wood: '#232d27', grass: '#22282a', sand: '#2b2a25', ice: '#3a4048', wetland: '#202a2a',
        water: '#122436', river: '#1d3b55', waterText: '#86a9c6',
        shadow: '#000000', highlight: '#6b7684', accent: '#000000', hills: 1, relief: { opacity: 0.35, brightness: 0.45 },
        road: '#3b4048', roadCasing: '#2a2e34', building: '#2a2e35', border: '#5f5a70',
        text: '#d8d3ca', halo: '#121418',
    },
};
const translucent = hex => `${hex}d9`;

const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
const ATTRIBUTION = {
    osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    openfreemap: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    terrain: 'relief <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Mapzen</a>, <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a>',
};

// Layers that don't depend on the vector tiles: paper, Natural Earth's world relief and hill shading.
const paper = c => ({ id: 'land', type: 'background', paint: { 'background-color': c.land } });
// Natural Earth's coloured relief carries the world view until the vector land cover takes over.
const worldRelief = c => ({ id: 'natural-earth', type: 'raster', source: 'natural-earth', maxzoom: 5,
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, c.relief.opacity, 3, c.relief.opacity * 0.5, 5, 0],
        'raster-brightness-max': c.relief.brightness, 'raster-saturation': -0.25 } });
const hills = c => ({ id: 'hills', type: 'hillshade', source: 'elevation', maxzoom: 12,
    paint: { 'hillshade-shadow-color': c.shadow, 'hillshade-highlight-color': c.highlight, 'hillshade-accent-color': c.accent,
        'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], ...[[2, 0.45], [8, 0.3], [12, 0.2]].flatMap(([z, e]) => [z, Math.min(1, e * c.hills)])] } });
const riverWidth = ['interpolate', ['exponential', 1.4], ['zoom'], 5, 0.6, 9, 1.4, 13, 4];

// Land, water and relief: everything both styles share, so "bare" shows nothing from today.
function ground(c) {
    const cover = (id, cls, color) => ({
        id, type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], cls, true, false], paint: { 'fill-color': color, 'fill-opacity': 0.8 },
    });
    return [
        paper(c),
        worldRelief(c),
        cover('wood', ['wood', 'forest'], c.wood),
        cover('grass', ['grass', 'farmland'], c.grass),
        cover('sand', 'sand', c.sand),
        cover('wetland', 'wetland', c.wetland),
        cover('ice', 'ice', c.ice),
        hills(c),
        { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
            filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': c.water } },
        { id: 'rivers', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway',
            filter: ['all', ['match', ['get', 'class'], ['river', 'canal'], true, false], ['!=', ['get', 'brunnel'], 'tunnel']],
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': c.river, 'line-width': riverWidth } },
        { id: 'streams', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', minzoom: 11,
            filter: ['match', ['get', 'class'], ['stream'], true, false],
            paint: { 'line-color': c.river, 'line-width': 0.8 } },
    ];
}

const waterLabels = c => {
    const label = { 'text-color': c.waterText, 'text-halo-color': translucent(c.halo), 'text-halo-width': 1.2 };
    return [
        { id: 'river-names', type: 'symbol', source: 'openmaptiles', 'source-layer': 'waterway', minzoom: 8,
            filter: ['==', ['get', 'class'], 'river'],
            layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.1 },
            paint: label },
        { id: 'sea-names', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name',
            filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
            layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-max-width': 6, 'text-letter-spacing': 0.15,
                'text-size': ['match', ['get', 'class'], 'ocean', 15, 'sea', 13, 12] },
            paint: label },
    ];
};

// Today's map on top of the ground: borders, main roads, buildings close in, and place names.
function today(c) {
    const road = (id, classes, minzoom, widths) => [
        { id: `${id}-casing`, type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom,
            filter: ['match', ['get', 'class'], classes, true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': c.roadCasing, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...widths.flatMap(([z, w]) => [z, w + 1])] } },
        { id, type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom,
            filter: ['match', ['get', 'class'], classes, true, false], layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': c.road, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...widths.flat()] } },
    ];
    const place = (id, classes, layout, { where, ...extra } = {}) => ({
        id, type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', ...extra,
        filter: ['all', ['match', ['get', 'class'], classes, true, false], ...(where ? [where] : [])],
        layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-max-width': 8, ...layout },
        paint: { 'text-color': c.text, 'text-halo-color': translucent(c.halo), 'text-halo-width': 1.3 },
    });
    const country = { 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12,
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 5, 14] };
    return [
        { id: 'buildings', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12,
            paint: { 'fill-color': c.building, 'fill-opacity': 0.7 } },
        ...road('minor-roads', ['minor', 'tertiary'], 10, [[10, 0.3], [13, 2]]),
        ...road('main-roads', ['motorway', 'trunk', 'primary', 'secondary'], 5, [[5, 0.2], [9, 1], [13, 3.5]]),
        { id: 'borders', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
            filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
            layout: { 'line-join': 'round' },
            paint: { 'line-color': c.border, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.4] } },
        ...waterLabels(c),
        place('villages', ['village'], { 'text-size': 11 }, { minzoom: 10 }),
        place('towns', ['town'], { 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 12, 14] }, { minzoom: 7 }),
        place('cities', ['city'], { 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 15, 12, 19] }, { minzoom: 3 }),
        // Small countries (rank 3 and up) wait a zoom, so the world view isn't a list of names.
        place('countries-large', ['country'], country, { maxzoom: 7, where: ['<=', ['get', 'rank'], 2] }),
        place('countries-small', ['country'], country, { minzoom: 3, maxzoom: 7, where: ['>', ['get', 'rank'], 2] }),
    ];
}

// The same styles drawn from OpenStreetMap's own vector tiles (vector.openstreetmap.org, Shortbread
// schema): much smaller tiles, but forests start at zoom 7, river lines at 9, and seas have no names.
function shortbreadGround(c) {
    const cover = (id, kinds, color) => ({
        id, type: 'fill', source: 'shortbread', 'source-layer': 'land',
        filter: ['match', ['get', 'kind'], kinds, true, false], paint: { 'fill-color': color, 'fill-opacity': 0.8 },
    });
    return [
        paper(c),
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

const shortbreadWaterLabels = c => {
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
};

function shortbreadToday(c) {
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
        ...road('minor-roads', ['tertiary', 'unclassified', 'residential'], 10, [[10, 0.3], [13, 2]]),
        ...road('main-roads', ['motorway', 'trunk', 'primary', 'secondary'], 5, [[5, 0.2], [9, 1], [13, 3.5]]),
        { id: 'borders', type: 'line', source: 'shortbread', 'source-layer': 'boundaries',
            filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], true]],
            layout: { 'line-join': 'round' },
            paint: { 'line-color': c.border, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.4] } },
        ...shortbreadWaterLabels(c),
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

// kind: 'terrain' (relief with today's borders, roads and names) or 'bare' (land, water and relief only).
// colors overrides palette entries by name, as the lab's colour editor sets them. tiles: 'openfreemap'
// or 'osm' (OpenStreetMap's own vector tiles); fonts come from OpenFreeMap either way.
export function ownStyle(kind, dark, colors = {}, tiles = 'openfreemap') {
    const c = { ...PALETTES[dark ? 'dark' : 'light'], ...colors };
    const vector = tiles === 'osm'
        ? { shortbread: { type: 'vector', tiles: ['https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt'], maxzoom: 14, attribution: ATTRIBUTION.osm } }
        : { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: ATTRIBUTION.openfreemap } };
    const layers = tiles === 'osm'
        ? [...shortbreadGround(c), ...(kind === 'bare' ? shortbreadWaterLabels(c) : shortbreadToday(c))]
        : [...ground(c), ...(kind === 'bare' ? waterLabels(c) : today(c))];
    return {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
            ...vector,
            // Both relief sources are 256 px images declared as 512, so MapLibre fetches a zoom coarser
            // (a quarter of the tiles); the shading is soft anyway. Elevation stops at 9 and is enlarged beyond,
            // and hills fade out at street zoom, where they cost the most and show the least.
            'natural-earth': { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'], tileSize: 512, maxzoom: 6 },
            elevation: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium', tileSize: 512, maxzoom: 9, attribution: ATTRIBUTION.terrain },
        },
        layers,
    };
}
