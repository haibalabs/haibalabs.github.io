// The lab's switches. Each variant has an id (used in ?lab=), a label, a one-line note on what it
// changes against main, and apply(lab, value), which must undo itself for value = null. A plain
// switch gets true/null; a variant with choices gets the chosen id/null and shows as a picker.
// initial is its value when the link has no ?lab=: the picks so far. Picks that reached main (the base
// map, full window, zoom 14, rings to scale and the event label) left the lab when they merged.
import { lookupOutline, outlineQuery } from './outlines.js';
import { EventClusters } from './event-clusters.js';

function showEvents(lab) {
    const { browser } = lab;
    browser.clusters?.remove();
    browser.clusters = lab.events ? new EventClusters(browser, { scope: lab.events, click: lab.clusterClick ?? 'list' }) : null;
    browser.clusters?.update(browser.lastEvents);
}

export const VARIANTS = [
    {
        id: 'events',
        label: 'Events on the map',
        note: 'The site shows only the selected event. These show many at once, as numbered bubbles that split into places as you zoom in.',
        choices: [
            { id: 'results', label: 'Every event in the timeline', note: 'All events the search and category filters match. A single event is a dot; click it to select it.' },
            { id: 'period', label: 'The time on screen', note: 'Only events from the years of the cards in view, at least 20 years, following the timeline as you scroll.' },
        ],
        defaultLabel: 'Off: only the selected event, as on the site',
        initial: 'results',
        apply(lab, scope) {
            lab.events = scope;
            showEvents(lab);
        },
    },
    {
        id: 'cluster-click',
        label: 'Clicking a bubble',
        note: 'Scrolling or + always zooms in and splits the bubbles.',
        choices: [
            { id: 'zoom', label: 'Zooms in until it splits', note: 'Its events are listed only when they share one place or the map is at its closest.' },
        ],
        defaultLabel: 'Lists its events, with a Zoom in button',
        apply(lab, mode) {
            lab.clusterClick = mode ?? 'list';
            if (lab.events) showEvents(lab);
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
