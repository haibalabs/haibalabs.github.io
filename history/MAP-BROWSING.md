# Map browsing

Open **Explore map** at the right edge. Move/zoom the map and choose **Search this area** to freeze an area filter. Set **From year / Through year**, then use the existing category buttons and text search. Negative years mean BCE; dates use the existing parser's start year, including for ranges. This is not interval-overlap or calendar-aware historical boundary search.

Click a point to see its matching events or filter to its place. Click a result to select and scroll to its stable event ID through the virtual timeline. **Show places** on an event displays all its saved points, including secondary locations. Moving the map or selecting an event does not silently replace an active area filter. **Clear area / place** preserves years, category, text and the precision preference. On a narrow screen, close the map panel to return to the timeline.

Approximate and unknown-precision points have outlined brown circles; exact/site points have solid blue circles. Popups and selected-event locations state the saved precision. Regional points represent locations, not historical polygons. **Unmapped events** keeps events without usable coordinates available. A manual coordinate correction takes precedence; otherwise only valid saved coordinates with reused/corrected status are used. Ambiguous candidate points are excluded. No map browsing action calls a geocoder.

At most 200 matching points in the viewport, 50 result buttons, and 20 event buttons per popup are drawn, with explicit counts. All matching events remain in the virtual timeline; zoom or filter to narrow large sets. The index retains every event/place link, including unmapped locations. Conflicting coordinate/precision records for a place are kept separately. Canonical event/place IDs are preserved; old files use session-only fallback identities. Duplicate persisted event IDs fail loading rather than select the wrong record.

## Local canonical preview

The default deployed `events.json` remains the legacy dataset. The canonical snapshot is not copied into this repository by this change. To use the full T2 data locally:

```sh
cd history
CANONICAL_SNAPSHOT=/absolute/path/to/history-data/canonical/t2-v1/events.json python3 tests/serve.py
```

Visit `http://localhost:8080/history/index.html?file=canonical-t2.json`.

Tests: `npm run test:unit`, `npm run test:e2e`. Set `CANONICAL_SNAPSHOT` to include full-data browser acceptance. A Playwright browser must be installed. For a standalone index benchmark: `node tests/benchmarks/place-index.mjs /absolute/path/to/events.json`.

Known limits: saved coordinate quality and source dates are not independently verified by the browser; legacy date-parser TODOs remain. Default-data publication, sync identity repair, historical polygons and expanded source coverage are separate milestones.
