// polity-layer.js
// Historical states' borders for the year being read, from historiline-polity-outlines/v1 period slices (the
// contract in history-dp docs/character-registry.md): each outline names an entity, whose name and article
// come from the entity table. The year is the selected event's, or with none, the middle of the cards on
// screen. Only the map lab passes it outlines (lab/map/variants.js) until releases carry them.

// one hue per entity, so a state keeps its colour from year to year
const hue = id => {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
};
const SLICE_FORMAT = 'historiline-polity-outlines/v1';
const yearText = year => (year < 0 ? `${-year} BC` : String(year));

export class PolityLayer {
    // files: the manifest's polity_outlines files; sliceUrl(sha256) gives a slice's address; entities: the
    // entity table's records; credit: the source's attribution, as HTML for the map's attribution line
    constructor(browser, { files, sliceUrl, entities, credit }) {
        this.browser = browser;
        this.map = browser.map;
        this.files = files;
        this.sliceUrl = sliceUrl;
        this.entities = new Map(entities.map(entity => [entity.entity_id, entity]));
        this.credit = credit;
        // under the landmarks (350), the selection (overlay pane, 400) and the event bubbles (450)
        if (!this.map.getPane('polities')) this.map.createPane('polities').style.zIndex = 300;
        this.layer = L.layerGroup();
        this.slices = new Map();
        this.year = null;
        this.on = false;
    }
    show(on) {
        this.on = on;
        if (on) {
            this.layer.addTo(this.map);
            this.map.attributionControl?.addAttribution(this.credit);
            this.update();
        } else {
            this.layer.remove();
            this.layer.clearLayers();
            this.map.attributionControl?.removeAttribution(this.credit);
            this.year = null;
        }
    }
    currentYear() {
        const { selectedId, manager, clusters } = this.browser;
        const selected = selectedId ? manager.placeIndex.years.get(selectedId) : undefined;
        if (Number.isFinite(selected)) return Math.round(selected);
        const period = clusters.period();
        return period ? Math.round((period[0] + period[1]) / 2) : null;
    }
    // Redraws when the year has changed: on a new selection, or as the timeline scrolls.
    update() {
        if (!this.on) return;
        const year = this.currentYear();
        if (year === this.year) return;
        this.year = year;
        const file = year === null ? undefined : this.files.find(entry => entry.from_year <= year && year <= entry.to_year);
        if (!file) {
            this.layer.clearLayers();
            return;
        }
        this.slice(file)
            .then(slice => { if (this.on && this.year === year) this.draw(slice, year); })
            .catch(error => console.error('The borders could not load:', error));
    }
    // a period's slice, fetched once and checked to be the one the list names
    slice(file) {
        if (!this.slices.has(file.sha256)) {
            this.slices.set(file.sha256, fetch(this.sliceUrl(file.sha256)).then(response => {
                if (!response.ok) throw new Error(`Could not load ${response.url} (${response.status})`);
                return response.json();
            }).then(slice => {
                if (slice?.format !== SLICE_FORMAT || slice.from_year !== file.from_year || slice.features?.length !== file.count) {
                    throw new Error(`The borders for ${file.from_year}–${file.to_year} are not the ones listed.`);
                }
                return slice;
            }));
        }
        return this.slices.get(file.sha256);
    }
    draw(slice, year) {
        this.layer.clearLayers();
        const features = slice.features
            .filter(feature => feature.from_year <= year && year <= feature.to_year && this.entities.has(feature.entity_id))
            .map(({ entity_id, from_year, to_year, geometry }) => ({ type: 'Feature', properties: { entity_id, from_year, to_year }, geometry }));
        L.geoJSON({ type: 'FeatureCollection', features }, {
            pane: 'polities',
            className: 'map-polity',
            style: feature => {
                const h = hue(feature.properties.entity_id);
                return { color: `hsl(${h} 42% 40%)`, weight: 0.8, opacity: 0.7, fillColor: `hsl(${h} 45% 55%)`, fillOpacity: 0.15 };
            },
            onEachFeature: (feature, layer) => {
                const entity = this.entities.get(feature.properties.entity_id);
                // a text node, since Leaflet renders a string as HTML
                layer.bindTooltip(document.createTextNode(entity.name), { sticky: true, direction: 'top', className: 'map-polity-name', opacity: 1 });
                layer.on('click', event => this.open(entity, feature.properties, event.latlng));
            },
        }).addTo(this.layer);
    }
    // Its bubble: the state's name, opening its article in the article panel, and the years this border covers.
    open(entity, { from_year: from, to_year: to }, latlng) {
        const box = Object.assign(document.createElement('div'), { className: 'map-event-list' });
        const name = Object.assign(document.createElement('strong'), { textContent: entity.name });
        let title;
        if (entity.wikipedia_url) {
            title = Object.assign(document.createElement('button'), { type: 'button', className: 'map-event-list-title' });
            title.setAttribute('aria-label', `${entity.name}: read about it on Wikipedia`);
            title.title = title.getAttribute('aria-label');
            const icon = Object.assign(document.createElement('i'), { className: 'fa-light fa-scroll' });
            icon.setAttribute('aria-hidden', 'true');
            title.append(name, icon);
            // in full window the article opens over the map (map-browser.css), which stays full
            title.addEventListener('click', () => this.browser.panels.handleInfoClick(entity.wikipedia_url, document.createElement('span')));
        } else {
            title = Object.assign(document.createElement('p'), { className: 'map-event-list-title' });
            title.append(name);
        }
        const span = Object.assign(document.createElement('p'), { className: 'map-event-list-more', textContent: `These borders: ${yearText(from)} – ${yearText(to)}` });
        box.append(title, span);
        L.popup({ className: 'map-event-popup', maxWidth: 300, minWidth: 200, autoPanPaddingTopLeft: [60, 110] })
            .setLatLng(latlng).setContent(box).openOn(this.map);
    }
}
