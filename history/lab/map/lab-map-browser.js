import { MapBrowser } from '../../modules/map-browser.js';

// The dot main draws for every point of the selected event (map-browser.js drawSelection).
export const siteDot = () => ({ options: { radius: 8, stroke: false, fillColor: '#60a5fa', fillOpacity: 0.85 } });

// MapBrowser with drawSelection's marker made replaceable: a variant sets dotFor(point) to return
// { options, tooltip } and calls drawSelection(), and may set beforeShowCard() to run before a dot
// scrolls the timeline. Everything else is main's MapBrowser.
export class LabMapBrowser extends MapBrowser {
    constructor(...args) {
        super(...args);
        this.dotFor = siteDot;
    }
    drawSelection() {
        this.selection.clearLayers();
        const index = this.manager.placeIndex;
        const event = index.events.get(this.selectedId);
        if (!event) return;
        const id = this.selectedId;
        for (const point of index.eventPoints.get(id) || []) {
            const { options, tooltip } = this.dotFor(point);
            const marker = L.circleMarker(point.coordinates, { ...options, className: 'map-selected-dot' }).addTo(this.selection);
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
    }
}
