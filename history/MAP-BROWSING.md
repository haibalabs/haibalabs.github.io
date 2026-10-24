# Map browsing

Open **Explore map** at the right edge, pan/zoom, then choose **Filter by visible area**. The visible rectangle becomes a filter for the timeline, combined with the existing category and text filters. **Clear** removes only the area filter. Moving the map does not silently change an active filter; press the button again to use the new view.

The timeline is the results list. Click a small translucent map dot to select and scroll directly to its event, without a popup or moving the map. When several events share the same saved point, repeated clicks advance through the current timeline order.

The original crosshairs icon beside an event's location shows all of that event's saved locations. In this focused view, unrelated browsing dots disappear. Pan or zoom to resume browsing the area's events. Selected locations are small translucent blue dots; the selected timeline title uses the existing accent color, with no enclosing border. Events with no usable coordinates remain in the timeline when the area filter is cleared and do not offer a map action.

Multiple locations express recorded event associations, not proof of simultaneous occurrence, an inferred route, or a filled historical area. Drawing historical areas is future work. Saved coordinates retain their uncertainty metadata in the index; the minimal map does not claim these points are exact or independently verified. Manual coordinate corrections take precedence; otherwise only valid saved coordinates with reused/corrected status are used. Ambiguous candidate points are excluded. No browsing action calls a geocoder.

At most 200 matching place points are drawn while browsing. All matching events remain in the virtual timeline; selected events show all their saved points. The index retains every event/place link, including unmapped locations. Conflicting coordinate/precision records for a place are kept separately. Canonical IDs are preserved; legacy files use session-only fallback identities. Duplicate persisted event IDs fail loading rather than selecting the wrong record.

The earlier map-specific year fields, precision checkbox, unmapped-only button and duplicate results list were removed to keep the map simple. The data layer's time-range query remains covered by tests; the existing year navigator jumps through the timeline and does not filter a year range.

## Local canonical preview

The default `events.json` remains the legacy dataset. The canonical snapshot is not copied into this repository. For the full T2 data locally:

```sh
cd history
CANONICAL_SNAPSHOT=/absolute/path/to/history-data/canonical/t2-v1/events.json python3 tests/serve.py
```

Visit `http://localhost:8080/history/index.html?file=canonical-t2.json`.

Tests: `npm run test:unit`, `npm run test:e2e`. Set `CANONICAL_SNAPSHOT` to include full-data browser acceptance. A Playwright browser must be installed. For a standalone index benchmark: `node tests/benchmarks/place-index.mjs /absolute/path/to/events.json`.

Known limits: saved coordinate quality and source dates are not independently verified by the browser; legacy date-parser TODOs remain. Default-data publication, sync identity repair, historical polygons and expanded source coverage are separate milestones.
