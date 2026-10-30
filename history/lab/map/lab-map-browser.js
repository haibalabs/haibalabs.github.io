import { MapBrowser } from '../../modules/map-browser.js';
import { eventDateLabel } from '../../modules/date-handlers.js';

// The dot main draws for every point of the selected event (map-browser.js drawSelection).
export const siteDot = () => ({ options: { radius: 8, stroke: false, fillColor: '#60a5fa', fillOpacity: 0.85 } });

const EARTH_CIRCUMFERENCE = 40075016.686;
const metresPerPixel = (lat, zoom) => EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180) / 2 ** (zoom + 8);

// The event label: name, date and, when the dot has one, what its precision means.
function eventLabel(event, note) {
    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = event.name;
    const date = document.createElement('span');
    date.textContent = eventDateLabel(event);
    label.append(name, date);
    if (note) {
        const small = document.createElement('small');
        small.textContent = note;
        label.append(small);
    }
    return label;
}

// MapBrowser with its selection made replaceable by the lab's variants:
// - dotFor(point) returns { options, tooltip, metres? }; a dot with metres is resized on zoom to cover
//   that ground distance, never below its options.radius, and gets a small centre dot.
// - viewFor(points) returns { bounds, maxZoom } for selectEvent to fit, in place of main's maxZoom 6.
// - labels: the first dot of the selected event shows its name and date; other dots show it on hover.
// - beforeShowCard() runs before a dot scrolls the timeline.
// Everything else is main's MapBrowser.
export class LabMapBrowser extends MapBrowser {
    constructor(...args) {
        super(...args);
        this.dotFor = siteDot;
        this.viewFor = null;
        this.labels = false;
        this.scaled = [];
        this.map.on('zoomend', () => this.rescale());
    }
    // main's selectEvent, with the view from viewFor when a variant sets it
    selectEvent(id) {
        const index = this.manager.placeIndex;
        if (!index.events.has(id)) return;
        this.selectedId = id;
        this.panels.openMapPanel();
        this.panels.bringMapToFront();
        this.drawSelection();
        const points = index.eventPoints.get(id) || [];
        this.map.invalidateSize();
        if (points.length) {
            const view = this.viewFor?.(points) ?? { bounds: L.latLngBounds(points.map(point => point.coordinates)), maxZoom: 6 };
            this.map.fitBounds(view.bounds, { maxZoom: view.maxZoom, padding: [35, 60], animate: false });
        }
        this.ui.renderEvents();
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
        for (const [i, point] of (index.eventPoints.get(id) || []).entries()) {
            const spec = this.dotFor(point);
            const { options, tooltip } = spec;
            const marker = L.circleMarker(point.coordinates, { ...options, className: 'map-selected-dot' }).addTo(this.selection);
            if (spec.metres) {
                this.scaled.push({ marker, dot: spec });
                L.circleMarker(point.coordinates, { radius: 3, stroke: false, fillColor: options.color ?? options.fillColor, fillOpacity: 1, interactive: false }).addTo(this.selection);
            }
            if (this.labels) {
                marker.bindTooltip(eventLabel(event, tooltip), { direction: 'top', permanent: i === 0, className: 'lab-event-label', offset: [0, -6], opacity: 1 });
            } else if (tooltip) {
                marker.bindTooltip(document.createTextNode(tooltip), { direction: 'top' });
            }
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
