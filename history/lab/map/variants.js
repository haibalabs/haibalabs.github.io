// The lab's switches. Each variant has an id (used in ?lab=), a label, a one-line note on what it
// changes against the site, and apply(lab, value), which must undo itself for value = null. A plain
// switch gets true/null; a variant with choices gets the chosen id/null and shows as a picker.
// initial is its value under a bare ?lab: the picks so far. Every variant drives the site's own modules
// through their options, so a pick reaches the site by changing a default, with nothing to port.
import { lookupOutline, outlineQuery } from './outlines.js';

export const VARIANTS = [
    {
        id: 'events',
        label: 'Events on the map',
        note: 'While "Filter by visible area" is on, the map shows the filtered events as numbered bubbles that split into places as you zoom in.',
        choices: [
            { id: 'period', label: 'The time on screen', note: 'Only events from the years of the cards in view, at least 20 years, following the timeline as you scroll.' },
        ],
        defaultLabel: 'Every event in the timeline, as on the site',
        apply(lab, scope) {
            lab.browser.clusters.configure({ scope: scope ?? 'results' });
        },
    },
    {
        id: 'cluster-click',
        label: 'Clicking a bubble',
        note: 'Scrolling or + always zooms in and splits the bubbles.',
        choices: [
            { id: 'zoom', label: 'Zooms in until it splits', note: 'Its events are listed only when they share one place or the map is at its closest.' },
        ],
        defaultLabel: 'Lists its events, with a Zoom in button, as on the site',
        apply(lab, mode) {
            lab.browser.clusters.configure({ click: mode ?? 'list' });
        },
    },
    {
        id: 'landmark-opacity',
        label: 'Landmark icons',
        note: 'See-through, so the map\'s place names show through an icon on top of them. The icon you point at, or move to with the keyboard, is solid.',
        choices: [
            { id: '85', label: '85% opaque', note: 'Almost solid.' },
            { id: '70', label: '70% opaque', note: 'Names under an icon can be read.' },
        ],
        defaultLabel: 'Solid, as on the site',
        apply(lab, value) {
            const map = lab.browser.map.getContainer();
            if (value) map.style.setProperty('--landmark-opacity', String(Number(value) / 100));
            else map.style.removeProperty('--landmark-opacity');
        },
    },
    {
        id: 'outlines',
        label: 'Outlines (live test)',
        note: 'Looks the selected place up in OpenStreetMap’s place search and draws today’s outline in place of its ring. A test of the look only: Hermes is building the outlines the site will use.',
        initial: true,
        apply(lab, on) {
            lab.browser.outlineFor = on ? (point, event) => {
                const location = event.locations?.find(l => l.place_id === point.placeId);
                return lookupOutline(location ? outlineQuery(location) : point.name, point.coordinates);
            } : null;
            lab.browser.drawSelection();
        },
    },
];
