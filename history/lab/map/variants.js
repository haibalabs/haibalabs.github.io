// The lab's switches. Each variant has an id (used in ?lab=), a label, a one-line note on what it
// changes against main, and apply(lab, on), which must undo itself when called with on = false.
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

export const VARIANTS = [
    {
        id: 'street-zoom',
        label: 'Zoom to street level',
        note: 'Raises the zoom limit from 7 to 18, so a site-precision point can be looked at closely.',
        apply(lab, on) { lab.map.setMaxZoom(on ? 18 : 7); },
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
    {
        id: 'colour-tiles',
        label: 'Map in colour',
        note: 'Shows OpenStreetMap in its own colours instead of the site’s grayscale.',
        apply(lab, on) { document.body.classList.toggle('lab-colour-tiles', on); },
    },
];
