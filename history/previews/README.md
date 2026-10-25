# Previews

Debug-only data, shown only when an admin turns on a preview in Settings → Debug. These files are publicly retrievable from GitHub Pages like any site file; the toggle controls what the site displays, not who can download them. Nothing here is part of the default site data: showing it to everyone is a release decision for Rachid, after Atlas's technical acceptance.

## reviewed-images-v1.json

Nine world-event images whose association with their event was independently reviewed (Iris's `pilots/t5-display-handoff-v1` packet in history-data, accepted by Atlas on 2026-10-25). Turned on by **Preview reviewed world images**.

- `source.packet_sha256` is the packet's hash; `source.events_sha256` is the hash of the `events.json` the records are bound to. Each record's `record_index` is its event's position in that file.
- The preview attaches all nine images or none. It requires the bytes the page loaded its events from to have `events_sha256`, valid and unique positions, and every target event to still be that file's record: the recorded `event_name` and `enhanced_time`, not replaced or edited since loading, and its file fields unchanged (locations compared by name and place). Otherwise it shows a message and attaches nothing.
- Each record keeps the packet's display fields: image and source URLs, role (`event_photo` or `event_aftermath`), caption, credit and license. `event_issue_ids` lists the event's open data holds; the image viewer notes that details are still being reviewed.
- The timeline card shows the photo and a one-line caption. Clicking it opens the full-window viewer with the full caption, role, credit, license and source links.

Regenerate it from a new packet rather than editing it by hand, and keep the hashes current; `tests/unit/world-images.test.js` checks every record against `events.json`.
