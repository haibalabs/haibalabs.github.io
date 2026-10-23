# Map browsing

Open **Explore map** at the right edge, pan/zoom, then choose **Filter by visible area**. The visible rectangle becomes a filter for the timeline, combined with the existing category and text filters. **Clear** removes only the area filter. Moving the map does not silently change an active filter; press the button again to use the new view.

The timeline is the results list. Click a map point to see its associated events; selecting one scrolls to its stable event ID through the virtual timeline. **Show on map** on a timeline event displays every saved location linked to that event, including secondary locations. Multiple points express recorded event associations, not proof of simultaneous occurrence, an inferred route, or a filled historical area. Area/polygon representation is future work. On narrow screens, close the map to return to the timeline.

Approximate and unknown-precision points have outlined brown circles; explicit exact/site points have solid blue circles. Tooltips and the compact selection caption identify uncertain points. Manual coordinate corrections take precedence; otherwise only valid saved coordinates with reused/corrected status are used. Ambiguous candidate points are excluded. No browsing action calls a geocoder. Events without coordinates remain available in the timeline when the area filter is cleared; their Show on map action explains that no saved location is available.

At most 200 matching points in the viewport and 20 event buttons per popup are drawn, with a prompt to zoom or narrow the search when capped. All matching events remain in the virtual timeline. The index retains every event/place link, including unmapped locations. Conflicting coordinate/precision records for a place are kept separately. Canonical IDs are preserved; legacy files use session-only fallback identities. Duplicate persisted event IDs fail loading rather than select the wrong record.

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
