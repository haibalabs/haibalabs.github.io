# Releases

Reviewed data that every visitor sees, kept beside `events.json` rather than in it. Adding records here publishes them on the next deploy, so each change to these files is a release decision for Rachid, after Atlas's technical acceptance and Iris's review of the images.

## released-images-v1.json

World-event images whose association with their event was reviewed and accepted for release. It holds 794 images for 794 events: the 61 first released plus 733 from Iris's continued image review, combined by Atlas's export (history-dp PR 40, `combine_image_exports.py`) and corrected by PR 41, byte for byte (SHA256 `2b492070…`). The reviewed exceptions still apply (Vancouver excluded; the Clement VIII image recorded as a site), the 1900 Paris poster is now a symbol, the Edward II marriage image (a 2023 monument) is a site, and five credits no longer carry leaked Wikimedia page styling. Seventeen of the events have open data-issue references, and their viewer says details are still being reviewed.
- Credits come from source metadata and some run to thousands of characters; the viewer shows the first 280, ending at a word, with the full text on hover and on the source page (`shortCredit` in `modules/world-images.js`).

- `source.events_sha256` is the hash of the `events.json` the records are bound to. `records` are the sidecar export's records unchanged. Each record's `record_index` is its event's position in that file, and `baseline_record_sha256` is the SHA256 of that record as Python's `json.dumps(record, sort_keys=True, ensure_ascii=False)` writes it; `evidence_event_id` is its canonical ID, for cross-reference only.
- The site loads this file with the events and attaches all records or none, with the same checks as the admin preview (`previews/README.md`): the loaded bytes must have `events_sha256`, positions must be valid and unique, and every target event must still be that file's record. If anything differs, for example after `events.json` is regenerated, visitors see no world images and the reason goes to the browser console. Rebind the records to the new file before deploying it.
- Records carry the display fields of the review: image and source URLs, role, caption, credit, license and rights statement, and `date_qualification` where the image is not a photo of the event at its time. The card shows the photo and a one-line caption; clicking it opens the full-window viewer with the role label, caption, date qualification, credit, license and source links.
- Roles and their viewer labels (`ROLE_LABELS` in `modules/world-images.js`): `event_photo` (no label), `event_aftermath` (Aftermath), `portrait`, `site`, `map`, `symbol` (each by name) and `retrospective_illustration` (Later illustration). The export maps the review's `contemporary_event` to `event_photo` and `aftermath` to `event_aftermath`. Any other role, including `unknown`, keeps the whole release off; every role other than the first two needs a `date_qualification`.
- One image per event, with no gallery (Rachid, 2026-10-25): a release chooses a single image for each event, and a repeated position is refused.
- The admin preview replaces these images while it is on.

To withdraw a release, remove its records (or revert the commit that added them); events and user data are unaffected. `tests/unit/world-images.test.js` checks every record against `events.json`.
