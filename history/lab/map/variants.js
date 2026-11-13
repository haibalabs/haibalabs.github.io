// The lab's switches. Each variant has an id (used in ?lab=), a label, a one-line note on what it
// changes against the site, and apply(lab, value), which must undo itself for value = null. A plain
// switch gets true/null; a variant with choices gets the chosen id/null and shows as a picker.
// initial is its value under a bare ?lab: the picks so far. Every variant drives the site's own modules
// through their options, so a pick reaches the site by changing a default, with nothing to port.
import { lookupOutline, outlineQuery } from './outlines.js';

export const VARIANTS = [
    {
        id: 'characters',
        label: 'Character cards (prototype)',
        note: 'A highlighted name on an event card opens that person\'s card above the timeline, with only their events under it, a map of the places in them, and their article. Ten people for now, linked to events by their exact name; none of the links is reviewed.',
        apply(lab, on) {
            import('../characters/characters.js')
                .then(({ setCharacters }) => setCharacters(lab, on))
                .catch(error => console.error('The character cards could not start:', error));
        },
    },
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
        id: 'borders',
        label: 'Borders by year (sample)',
        note: 'States and empires as they were in the selected event\'s year, or the year of the cards on screen, from Cliopatria (CC BY 4.0). The sample covers only 100–124, 775–799, 1250–1274 and 1500–1524; other years show none. Point at a state for its name, click it for its article.',
        apply(lab, on) {
            if (!on) return lab.browser.showPolities(null);
            const base = new URL('borders-sample/', import.meta.url);
            const json = path => fetch(new URL(path, base)).then(response => {
                if (!response.ok) throw new Error(`Could not load ${response.url} (${response.status})`);
                return response.json();
            });
            Promise.all([json('index.json'), json('entities.json')]).then(([index, table]) => lab.browser.showPolities({
                files: index.files,
                sliceUrl: sha256 => new URL(`polity-outlines/${sha256}.json`, base).href,
                entities: table.entities,
                credit: `<a href="${index.credit_url}" target="_blank" rel="noopener">${index.source}</a>, ${index.license}`,
            })).catch(error => console.error('The borders sample could not load:', error));
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
