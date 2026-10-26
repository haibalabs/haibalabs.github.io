# Releases

Reviewed data that every visitor sees, kept beside `events.json` rather than in it. Adding records here publishes them on the next deploy, so each change to these files is a release decision for Rachid, after Atlas's technical acceptance and Iris's review of the images.

## released-images-v1.json

World-event images whose association with their event was independently reviewed and accepted for release. It currently holds no records, so the site shows no world images.

- `source.events_sha256` is the hash of the `events.json` the records are bound to. `records` are the sidecar export's records unchanged. Each record's `record_index` is its event's position in that file, and `baseline_record_sha256` is the SHA256 of that record as Python's `json.dumps(record, sort_keys=True, ensure_ascii=False)` writes it; `evidence_event_id` is its canonical ID, for cross-reference only.
- The site loads this file with the events and attaches all records or none, with the same checks as the admin preview (`previews/README.md`): the loaded bytes must have `events_sha256`, positions must be valid and unique, and every target event must still be that file's record. If anything differs, for example after `events.json` is regenerated, visitors see no world images and the reason goes to the browser console. Rebind the records to the new file before deploying it.
- Records carry the display fields of the review packet: image and source URLs, role (`event_photo` or `event_aftermath`), caption, credit, license and rights statement. The card shows the photo and a one-line caption; clicking it opens the full-window viewer with the caption, role, credit, license and source links.
- One image per event, with no gallery (Rachid, 2026-10-25): a release chooses a single image for each event, and a repeated position is refused.
- The admin preview replaces these images while it is on.

To withdraw a release, remove its records (or revert the commit that added them); events and user data are unaffected. `tests/unit/world-images.test.js` checks every record against `events.json`.
