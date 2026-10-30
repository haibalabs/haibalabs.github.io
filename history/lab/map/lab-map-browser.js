import { MapBrowser } from '../../modules/map-browser.js';

// The dot main draws for every point of the selected event (map-browser.js drawSelection).
export const siteDot = () => ({ options: { radius: 8, stroke: false, fillColor: '#60a5fa', fillOpacity: 0.85 } });

const EARTH_CIRCUMFERENCE = 40075016.686;
const metresPerPixel = (lat, zoom) => EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180) / 2 ** (zoom + 8);

// MapBrowser with drawSelection's marker made replaceable: a variant sets dotFor(point) to return
// { options, tooltip, metres? } and calls drawSelection(), and may set beforeShowCard() to run before
// a dot scrolls the timeline. A dot with metres is resized on zoom to cover that ground distance,
// never below its options.radius. Everything else is main's MapBrowser.
export class LabMapBrowser extends MapBrowser {
    constructor(...args) {
        super(...args);
        this.dotFor = siteDot;
        this.scaled = [];
        this.map.on('zoomend', () => this.rescale());
    }
    rescale() {
        const zoom = this.map.getZoom();
        for (const { marker, dot } of this.scaled) {
            const radius = Math.max(dot.options.radius, dot.metres / metresPerPixel(marker.getLatLng().lat, zoom));
            // a ring wider than the dot fades its fill, so it tints rather than covers the map
            marker.setRadius(radius).setStyle({ fillOpacity: dot.options.fillOpacity * Math.min(1, Math.max(0.4, dot.options.radius * 2 / radius)) });
        }
    }
    drawSelection() {
        this.selection.clearLayers();
        this.scaled = [];
        const index = this.manager.placeIndex;
        const event = index.events.get(this.selectedId);
        if (!event) return;
        const id = this.selectedId;
        for (const point of index.eventPoints.get(id) || []) {
            const spec = this.dotFor(point);
            const { options, tooltip } = spec;
            const marker = L.circleMarker(point.coordinates, { ...options, className: 'map-selected-dot' }).addTo(this.selection);
            if (spec.metres) this.scaled.push({ marker, dot: spec });
            if (tooltip) marker.bindTooltip(document.createTextNode(tooltip), { direction: 'top' });
            const select = () => { this.beforeShowCard?.(); this.ui.scrollToEventId(id); };
            marker.on('click', select);
            const dot = marker.getElement();
            dot?.setAttribute('aria-label', `Select ${event.name} in timeline`);
            dot?.setAttribute('role', 'button');
            dot?.setAttribute('tabindex', '0');
            dot?.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
            });
        }
        this.rescale();
    }
}
