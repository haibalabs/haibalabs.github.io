# Map browsing

Open **Explore map** at the right edge, pan/zoom, then choose **Filter by visible area**. The visible rectangle becomes a filter for the timeline, combined with the existing category and text filters. **Clear** removes only the area filter. Moving the map does not silently change an active filter; press the button again to use the new view.

The map starts without event dots. Use the original crosshairs icon beside a timeline event's location to show only that event's saved locations as small translucent dots. Pan and zoom keep that selection; they never reveal other events. Clicking one of the selected event's dots returns to its timeline card without a popup or map recentering.

**Filter by visible area** narrows the timeline without plotting the matching events. A selected event keeps its points if it still matches the filters; otherwise selection clears. Clearing the area restores the non-geographic results without adding points. Events with no usable coordinates remain browsable and do not offer a map action.

Multiple locations express recorded event associations, not proof of simultaneous occurrence, an inferred route, or a filled historical area. Drawing historical areas is future work. Saved coordinates retain their uncertainty metadata in the index; the minimal map does not claim these points are exact or independently verified. Manual coordinate corrections take precedence; otherwise only valid saved coordinates with reused/corrected status are used. Ambiguous candidate points are excluded. No browsing action calls a geocoder.

Marker work is limited to the selected event's locations; map movement does not scan the full place index. The index still retains every event/place link for area filtering, including unmapped locations. Conflicting coordinate/precision records for a place remain separate. Canonical IDs are preserved; legacy files use session-only fallback identities. Duplicate persisted event IDs fail loading rather than selecting the wrong record.

An explicit **Explore events** mode, clustered counts and queries limited to the viewport are deferred. They must not change the selected-event-only default. The app still loads the full snapshot and filters locally; this change is not a claim of one-million-event loading performance.

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
