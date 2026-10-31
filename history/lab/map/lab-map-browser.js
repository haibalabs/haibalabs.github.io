import { MapBrowser } from '../../modules/map-browser.js';

// main's MapBrowser with the lab's hooks:
// - outlineFor(point, event) resolves to { geojson, name } or null; an outline replaces the point's ring,
//   and a one-place event selected from the timeline is refitted to it when it arrives.
// - clusters (event-clusters.js) hears every refresh, scrolls included, so it can follow the timeline.
export class LabMapBrowser extends MapBrowser {
    constructor(...args) {
        super(...args);
        this.outlineFor = null;
        this.clusters = null;
        this.drawn = 0;
        this.fitOutlineOf = null;
    }
    refresh(events) {
        super.refresh(events);
        this.clusters?.update(events);
    }
    selectEvent(id) {
        this.fitOutlineOf = id;
        super.selectEvent(id);
    }
    drawSelection() {
        super.drawSelection();
        const drawn = ++this.drawn;
        if (!this.outlineFor) return;
        const index = this.manager.placeIndex;
        const event = index.events.get(this.selectedId);
        const points = index.eventPoints.get(this.selectedId) || [];
        const dots = [];
        this.selection.eachLayer(layer => { if (layer.options.className?.includes('map-selected-dot')) dots.push(layer); });
        for (const point of points) {
            const marker = dots.find(dot => dot.getLatLng().equals(L.latLng(point.coordinates)));
            // rings to scale and unreviewed grey rings get an outline; a site or no-precision dot stays a dot
            const ring = marker && (this.rings.some(entry => entry.marker === marker) || marker.options.radius >= 10);
            if (!ring) continue;
            this.outlineFor(point, event).then(outline => {
                if (outline && drawn === this.drawn) this.showOutline(outline, { marker, alone: points.length === 1 });
            });
        }
    }
    // An outline in place of the point's ring: the ring is hidden but stays as the click target and label anchor.
    showOutline(outline, { marker, alone }) {
        const color = marker.options.color;
        const shape = L.geoJSON(outline.geojson, { style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.12 }, interactive: false }).addTo(this.selection);
        shape.bringToBack();
        this.rings = this.rings.filter(ring => ring.marker !== marker);
        marker.setStyle({ opacity: 0, fillOpacity: 0 });
        if (alone && this.fitOutlineOf === this.selectedId) {
            this.fitOutlineOf = null;
            this.map.fitBounds(shape.getBounds(), { maxZoom: this.map.getMaxZoom(), padding: [35, 60], animate: false });
        }
    }
}
