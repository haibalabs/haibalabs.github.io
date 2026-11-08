# Map browsing

Open **Explore map** at the right edge, pan/zoom, then choose **Filter by visible area**. The visible rectangle becomes a filter for the timeline, combined with the existing category and text filters. **Clear** removes only the area filter. Moving the map does not silently change an active filter; press the button again to use the new view.

The map starts without event dots. Use the original crosshairs icon beside a timeline event's location to show only that event's saved locations as small translucent dots. Pan and zoom keep that selection; they never reveal other events. Clicking one of the selected event's dots returns to its timeline card without a popup or map recentering.

A reviewed point (released by the location pipeline, or corrected by hand) is drawn by its precision. A site, or a point with no recorded precision, is a solid dot. Other points are rings drawn to scale, covering the ground the point may stand for: 3 km for a town, 10 km for an approximate place (the resolver's placement tolerance), 100 km for a region and 300 km for a country or polity. These sizes are display choices, not measured extents. Selecting an event zooms to fit its rings, or to street level for a site.

Most points are still older geocoder lookups (status `reused`) that nobody has reviewed; one may stand for a town or a whole region. They are grey rings that keep one size on screen, and an event with one opens no closer than zoom 6. The event's name and date float over its first point. The map zooms in as far as 14 (streets), and + / − look disabled at the limits.

The button under + / − lets the map fill the window. Esc or the button returns to the drawer, and so does clicking a selected event's dot, which also shows its card.

**Filter by visible area** narrows the timeline and shows the matching events on the map (see "Events on the map" below). A selected event keeps its points if it still matches the filters; otherwise selection clears. Clearing the area restores the non-geographic results and takes the events off the map. Events with no usable coordinates remain browsable and do not offer a map action.

Multiple locations express recorded event associations, not proof of simultaneous occurrence, an inferred route, or a filled historical area. Drawing historical areas is future work. Saved coordinates retain their uncertainty metadata in the index; the minimal map does not claim these points are exact or independently verified. Manual coordinate corrections take precedence; otherwise only valid saved coordinates with reused/corrected status are used. Ambiguous candidate points are excluded. No browsing action calls a geocoder.

Without an area filter, marker work is limited to the selected event's locations; map movement does not scan the full place index. The index still retains every event/place link for area filtering, including unmapped locations. Conflicting coordinate/precision records for a place remain separate. Canonical IDs are preserved; legacy files use session-only fallback identities. Duplicate persisted event IDs fail loading rather than selecting the wrong record.

## Events on the map

While **Filter by visible area** is on, the map shows the filtered events, grouped by Supercluster 8.0.1 (ISC, loaded from unpkg the first time the filter is used, with an integrity check) in [modules/event-clusters.js](modules/event-clusters.js). If it can't load, the filter still narrows the timeline without bubbles, a note under the count says the events can't be shown on the map, and the page doesn't try again until it reloads.
- **Bubbles:** spots close together on screen merge into a numbered bubble, which splits as you zoom in. Counts of 1,000 or more read "1000+".
- **Same-spot bubbles:** events that share one point have a white ring, because zooming can't split them. Several place records can share a point, such as "Asunción" and "Asunción, Paraguay", so grouping is by spot, not by place.
- **Single events:** a spot with one event is a small dot; clicking it selects the event without moving the map.
- **Lists:** clicking a bubble lists its events, earliest first, 25 at a time, with **Zoom in** while it can still split. Picking one selects it and scrolls the timeline to its card. The map zooms in to it if needed, but never out, centred on the event's place nearest the bubble.
- **Stepper:** a picked event gets a small bar below it. ‹ and › go to the previous and next event of the list, and the list button reopens the list there.
- **Selection:** the selected event is left out of the bubbles, so its own ring and label show. Selecting an event any other way ends the stepping.

Without an area filter the map shows only the selected event, as before. The app still loads the full snapshot and filters locally; this change is not a claim of one-million-event loading performance.

The earlier map-specific year fields, precision checkbox, unmapped-only button and duplicate results list were removed to keep the map simple. The data layer's time-range query remains covered by tests; the existing year navigator jumps through the timeline and does not filter a year range.

The selected event's label gives its name, date and place. The place is the released place label ([modules/world-labels.js](modules/world-labels.js)), else the location's written name.

## Map lab

`index.html?lab` is the site with a **Lab** button on the map: switches for map ideas not yet on the site ([lab/map/variants.js](lab/map/variants.js)). The lab module loads only with `?lab`, so the site never fetches it. Each switch sets an option of the site's own modules, so a pick reaches the site by changing a default, with no copy to port.
- A bare `?lab` starts with the picks so far, `?lab=off` with everything off (the site as it is), and the switches keep the link up to date, such as `?lab=events:period,outlines`.
- **Events on the map:** every event in the timeline (the site), or only those from the years of the cards on screen, with the years in a note.
- **Clicking a bubble:** lists its events (the site), or zooms in until it splits.
- **Outlines (live test):** looks the selected place up in OpenStreetMap's place search (Nominatim, one request a second, kept for the page's life) and draws today's outline in place of its ring. This is a test of the look; released outlines will replace it.

## Base map

The map is drawn in the browser from OpenStreetMap's own vector tiles (`vector.openstreetmap.org`, Shortbread schema) by MapLibre GL under Leaflet, in colours that follow Stamen Terrain, with a dark palette for the dark theme ([modules/map-style.js](modules/map-style.js)). Hills are shaded from Mapzen's elevation tiles, Natural Earth's relief colours the world view, and the label fonts come from OpenFreeMap. None of these needs a key. Labels use the English name, else the local one. Arabic, Persian and Hebrew are joined and laid out right to left. A local name in a script MapLibre can't shape (Indic scripts, Sinhala, Tibetan, Myanmar, Khmer) is left unlabelled rather than drawn wrong.

The vector map downloads more than the images did: about 7.1 MB against 3.1 MB on the same walk around Paris, plus MapLibre itself (283 KB compressed). In return, text is sharp at every zoom and the dark theme gets its own colours instead of inverted images. If MapLibre can't load, the browser has no WebGL, or OpenStreetMap's vector tile server fails before its first tile, the map shows OpenStreetMap's images as before.

## Local canonical preview

The default `events.json` remains the legacy dataset. The canonical snapshot is not copied into this repository. For the full T2 data locally:

```sh
cd history
PORT=8181 CANONICAL_SNAPSHOT=/absolute/path/to/history-data/canonical/t2-v1/events.json python3 tests/serve.py
```

Visit `http://127.0.0.1:8181/history/index.html?file=canonical-t2.json`.

Tests: `npm run test:unit`, `PORT=8181 npm run test:e2e`. Set `CANONICAL_SNAPSHOT` to include full-data browser acceptance. A Playwright browser must be installed. For a standalone index benchmark: `node tests/benchmarks/place-index.mjs /absolute/path/to/events.json`.

Known limits: saved coordinate quality and source dates are not independently verified by the browser; legacy date-parser TODOs remain. Default-data publication, sync identity repair, historical polygons and expanded source coverage are separate milestones.
