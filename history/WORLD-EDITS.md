# Editing world history with review (U2)

Status: design draft for team review and Rachid's approval, 2026-10-27. Nothing here is built yet. The current, much smaller, contribution path is described in `WORLD-CONTRIBUTIONS.md`.

Invited editors and reviewers can fix any world event: its name, date, description, Wikipedia link, category, location and image. They can also propose a new event. Every change is stored as an **edit** in a review bucket. An edit is first **checked automatically**, then **reviewed by an admin**, and only an approved edit changes the event that visitors see. One event can collect several edits from different people; edits to different fields merge on their own, and edits that clash are settled by the reviewer.

## Decisions (Rachid, 2026-10-27)

1. Reviewers and editors propose edits to any field, including the image. Proposals are a list of edits per event, which may need automatic or manual merging.
2. Process: automatic checks first, then a manual check; only approved edits reach the real event.
3. Admins review and accept edits through a dedicated interface. **An admin can overrule an automatic rejection.**
4. Approved edits are visible to every visitor on their next page load. The pipeline later folds them into the main dataset.
5. Only admins approve, for now. Approval may open to reviewers later, never for their own edits.
6. The automatic checks are run by the agents, on a schedule, with the existing pipeline tools.
7. Images can be proposed as Wikimedia Commons links or as uploads.
8. **Wikipedia and other online sources can be wrong too.** Disagreeing with Wikipedia never rejects an edit by itself (see Sources can be wrong).
9. **Every approval stores who approved it**, and that identity follows the change to visitors' data and into the dataset (see Accountability).

## Roles

| Role | Can |
|---|---|
| visitor (signed out) | See published events, including approved edits. Never sees pending edits. |
| viewer | Same as a visitor. |
| editor, reviewer | Propose edits and new events; see, revise and withdraw their own edits. |
| admin | Everything above; see all edits; approve, reject, send back, overrule an automatic rejection and revert. |
| checker (agents' service account) | Read new edits and write check results and the resulting status. Never approves. |

An admin cannot approve their own edit. While Rachid is the only admin, his own edits need a second admin, or the self-approval exception in open question 1.

## The edit

One Firestore document per proposal in `edits/{editId}`, where `editId` is `edt_` followed by a UUID.

```
edits/{editId}
  kind          "update" | "create"
  event_id      evt_… of the event being changed; for "create", a new ID assigned at submission
  event_name    the event's name when the edit was started, for display only
  dataset       { id: "world-history", sha256 } of the data file the author was looking at
  changes       map, field -> { before, after }, holding only the fields that change (see Fields)
  reason        string, 10–1000 characters, required: what was wrong and how the author knows
  sources       up to 5 URLs supporting the change; required when changing name, date or location
  author        { uid, email }; the email must equal the signed-in account's
  created_at    server time
  revised_at    server time of the author's last revision
  revision      1, 2, …: incremented each time the author revises it
  content_sha256  SHA-256 of the revision's normalized changes, reason, sources and source_conflict,
                including any uploaded file's own SHA-256; recomputed on every revision
  status        see Statuses
  checks        { browser: [...], automatic: { revision, content_sha256, checker_version, ran_at, results: [...] } }
  review        { by: { uid, email, role }, revision, content_sha256, decision, fields, note, override, at },
                set by the admin; the rules require by.uid and by.email to be the signed-in admin's,
                the server time, and revision/content_sha256 equal to the edit's current ones
  source_conflict  true when the author says a cited source (often Wikipedia) is itself wrong;
                the reason must then explain why, and sources should include the better source
  fields        map, field -> per-field disposition (see Field dispositions):
                { status, receipt?: { by, revision, content_sha256, value, override, agreement_with?, at } }
  published     { overlay_version, at }, set when the edit's last approved field reaches visitors
  merged        { manifest_id, canonical_sha256, at }, set when every approved field has been folded
```

Each `changes` entry keeps the value the author saw (`before`) next to the proposed one (`after`). `before` is what lets several edits on one event be merged safely, and lets an edit outlive dataset rebuilds: an edit applies only to an event whose field still holds `before`.

### Revisions are immutable once judged

Checks and approval are tied to one exact revision of an edit and its file:
- **A revision is a fixed snapshot.** Revising (author only, while allowed) increments `revision`, recomputes `content_sha256`, sets `status` back to `submitted` and clears `checks.automatic`. The rules enforce all four, so a passing check can never carry over to changed content.
- **The checker records what it judged.** `checks.automatic.revision` and `content_sha256` name the snapshot. The checker writes its result only if the edit still has that revision and hash when it saves (a Firestore transaction). Otherwise it leaves the edit for its next run.
- **Approval names the snapshot too.** The review page sends the `revision` and `content_sha256` it displayed. The approval transaction and the rules refuse the approval if the edit has changed since. Unless the approval is an override, they also refuse it if `checks.automatic` isn't for that same revision.
- **Uploaded files are immutable.** An upload goes to `edit_uploads/{uid}/{editId}/r{revision}-{sha256}.webp`. Storage rules allow creating it but never overwriting it, so revising the image means uploading a new file under the new revision. The edit stores the file's `sha256`, `bytes`, `width` and `height`, and `content_sha256` covers them.

### Fields

| Field | `after` holds | Notes |
|---|---|---|
| `name` | string, 1–300 characters | |
| `enhanced_time` | the date as typed | Must parse with the timeline's date handling, the same rule as the event form. |
| `enhanced_description` | string, up to 4000 characters | Plain text. |
| `wikipedia_url` | an `https://*.wikipedia.org/wiki/…` URL, or `null` to remove it | |
| `categories` | one or more of the timeline's categories | |
| `location` | `{ name, city, region, country, historical_name, point?: [lat, lon] }`, or `null` | `point` is optional, placed by clicking the map in the form. It replaces the event's first location. |
| `image` | a normalized image record (below), or `null` to remove the event's image | One image per event. An approved image replaces the current one, released or not. |

A `create` edit carries every required field (name, date, description) in `changes`, with `before: null`.

### The image record

The `image` field stores the complete record the viewer will show, not just a link. What the admin approves is then exactly what visitors get:

```
image
  source            "commons" | "upload" | "release" (the last only in `before`, for a released image)
  image_url         full-size URL; for an upload, the public path it is copied to on approval
  thumbnail_url     URL used in the timeline card
  source_url        the Commons file page, or for an upload the site's own image page
  caption           what the image shows (v2 caption policy: no negations, no dates)
  display_date      the image's date as shown, or null
  image_role        one of the released-image roles (event_photo, event_aftermath, portrait, site,
                    map, symbol, retrospective_illustration)
  credit            author or photographer as it must be credited
  license_name      e.g. "CC BY-SA 4.0", "Public domain"
  license_url       the license's URL, or null for public domain
  rights_statement  for Commons, the file's license metadata as read; for an upload, the uploader's
                    confirmation (open question 2)
  file_page         Commons file page title (Commons only)
  asset             { path, sha256, bytes, width, height } (uploads only; path is the private upload)
  release_pair_id   the released record's pair_id ("release" only)
```

For a Commons link, the form reads the file's metadata from the Commons API, fills in URLs, credit and license, and asks the author for a caption, role and optional date. The checker reads Commons again and flags any difference. For an upload, the author supplies caption, role, date, credit and the rights confirmation, and the URLs are set on approval.

**`before` is the effective image when the author started:** the released image record, normalized to this shape with `source: "release"` and its `release_pair_id`; an image from an earlier approved edit; or `null` for none. Images are compared by identity, not field by field: the released pair ID, the Commons file page, or the upload's `sha256`. A caption change on the same picture is therefore an image edit whose `before` and `after` share an identity.

**Removing an image** (`after: null`) means visitors see no image and no credit, caption or license for that event. The overlay patch hides the released image as well. Removal is kept across folding and revert:
- the history-dp export records it as an image suppression for that `release_pair_id`, so the next image release leaves the pair out instead of bringing it back;
- the overlay keeps the null patch until the released record is gone from the loaded data, at which point it counts as folded and is skipped;
- reverting a removal is an edit with `before: null` and `after` set to the removed record, which the removal edit kept in full as its `before`, so the exact image, caption and credit come back.

## Statuses

```
            author submits (browser checks pass)
                         │
                     submitted ──────────── author withdraws ──► withdrawn
                         │ checker runs
        ┌────────────────┼──────────────────┐
        ▼                ▼                  ▼
   auto_rejected      flagged             ready
   (a hard check      (a check was        (all checks
    failed)            unsure)             passed)
        │                │                  │
        │   author revises → submitted      │
        └──────────┬─────┴──────────────────┘
                   ▼  admin reviews
   ┌───────────────┼──────────────┬────────────────┐
   ▼               ▼              ▼                ▼
approved      rejected      sent_back          conflict
(all or some  (with a       (author revises    (another approved edit
 fields)       reason)       → submitted)       changed the same field)
   │
   ▼  admin's approval writes the overlay
published ──► merged (the pipeline folded it into the dataset)
```

- **auto_rejected**: a hard rule failed, such as a date that doesn't parse, a dead Wikipedia link, or an image without a free license. The author sees the reason and can revise. **The edit still appears in the admin's queue under "Automatically rejected", where an admin can overrule it**: approve it anyway, with a required note recorded as `review.override: true`.
- **flagged**: a check couldn't decide, for example the source check found the article unclear, or no budget was available for a paid check. The edit goes to the admin with the warning shown.
- **sent_back**: the admin asks the author for a change. It works like auto_rejected, but with the admin's note.
- **conflict**: set automatically when an approval changes a field that a pending edit also changes, and the pending edit's `before` no longer matches. See Merging.
- **withdrawn**, **rejected**, **published** and **merged** are final. A published edit can still be reverted, which creates a new edit restoring the earlier value (see Revert).

### Field dispositions

The edit-level status above summarizes a status kept **per field** in `fields`, because an admin can approve some fields of an edit and not others:
- each changed field starts `pending` and ends `approved`, `rejected`, `conflict` or `withdrawn`;
- approving a field writes an **approval receipt** for that field only: approver, the edit's `revision` and `content_sha256`, the exact approved `value`, the override flag and the server time. Receipts are immutable;
- an edit is `published` once every field has a final disposition and at least one was approved, and `rejected` if none was. Fields not ticked in a partial approval get their own disposition (`rejected`, or left `pending` if the admin chooses "decide later"), never an implied approval;
- the overlay and the export consume **approval receipts, not edits**, so only the exact approved fields and values ever reach visitors or the dataset.

## Automatic checks

### In the browser, at submission (instant, free)

- At least one field changed, and the reason is present.
- Field rules from the Fields table: lengths, date parses, URL shape, category known.
- No HTML or script in any text.
- Wikipedia link: the article exists and is not a disambiguation page. The form shows the article title so the author can confirm it.
- Commons image: the file page exists and has a license. The form shows the image, its author and its license.
- Upload: JPEG, PNG or WebP, resized in the browser to at most 1600 px and 2 MB, as personal photos are today. The author must give a credit name and confirm the rights statement (open question 2).
- Location point: valid coordinates. The form shows the pin on the map.

An edit that fails these checks can't be submitted; the form says what to fix.

### By the agents, on a schedule

A checker in history-dp (`edit_checker.py`, owned by Atlas) reads `submitted` edits with a Firebase service-account key. It runs the checks for each changed field and writes results and the new status. It runs whenever an agent is active, at least every 30 minutes during working sessions; Ariadne tracks it like any other job.
- **Budget:** it makes no paid model calls without a budget Rachid has approved, and keeps the same per-run retrieval and cost accounting as the image and caption runs. A check that would need a paid call, or that can't run (a source is unreachable, a timeout), records `unsure` and the edit comes out `flagged`, never passed.
- **Untrusted input:** submitted text and URLs are untrusted. They are passed to a model only as quoted data, never as instructions, and URLs are fetched only from allowed hosts (Wikipedia, Wikidata, Commons, GeoNames, and the domains of cited sources, read-only).
- **No overwriting newer work:** the checker writes in a transaction that requires the edit to still be `submitted` at the same `revision` and `content_sha256`. A late result for an edit that has since been revised, withdrawn or decided is discarded.

This design assigns that work. It doesn't authorize spending, retrieval, a schedule, service-account access or a deployment; each is approved separately when phase 3 is built.

| Field | Hard checks (failure gives auto_rejected) | Soft checks (doubt gives flagged) | Owner |
|---|---|---|---|
| all | author is still a member; at most 50 edits a day per author; no duplicate of an identical pending edit | | Atlas |
| `name` | | similar to the linked Wikipedia article's title or its event | Atlas |
| `enhanced_time` | parses | agrees with the article's date; a shift of more than 10 years is flagged | Atlas |
| `enhanced_description` | | supported by the Wikipedia article (model source check, paid) | Atlas |
| `wikipedia_url` | resolves, not missing or disambiguation; the redirect target is recorded | the article is about this event | Atlas |
| `location` | | the geocoded place is within the location margin (10 km at city scale); the pin lies in the named country | Hermes |
| `image`, Commons | file exists; license is free (CC0, CC BY, CC BY-SA, public domain); credit present | not used for another event; fits the event (caption and role, v2 caption policy) | Iris |
| `image`, upload | rights confirmed; file type and size | fits the event; not a duplicate (hash). **Uploads are always flagged for a person to look at.** | Iris |
| `create` | required fields present | not a duplicate of an existing event (name and date similarity) | Atlas |

Each result is `{ check, outcome: pass | fail | unsure, detail, evidence_url? }`, so the review page can show exactly why. The checker writes its own identity on every run: account, `checker_version` and time.

### Sources can be wrong

Wikipedia, Wikidata, GeoNames and Commons are evidence, not truth. Editors will sometimes be right where Wikipedia is wrong.
- **No comparison with a source is a hard check.** Hard checks only cover things that are mechanically broken: a date that doesn't parse, a link to a missing page, an image without a free license, a malformed field. Disagreement with an article, a geocoder or a date in metadata is always a soft check. At worst it makes the edit `flagged`, never `auto_rejected`.
- **Agreement is not proof either.** A pass means "consistent with the cited source", and the review page says so. A popular error copied across sites can pass every check.
- **The author can say a source is wrong.** The form has a "A source is wrong here" option (`source_conflict`). The reason must then explain it, and the author should cite the better source: a primary document, a scholarly work or an official record. Such edits always go to an admin as `flagged`, with the disagreement shown, and the checker runs its comparisons against the author's cited sources as well as Wikipedia.
- **Several sources beat one.** Where a check can consult more than one independent source (Wikipedia plus Wikidata, or a cited source), its detail lists each with what it says. The admin sees the disagreement instead of a single verdict.
- **The admin decides.** Whatever the checks say, the admin can approve, overruling an automatic rejection if needed. The approval note should name the source relied on.
- **Wrong sources are worth recording.** When an approved edit contradicts Wikipedia, the history-dp export marks it, so the team can later suggest a correction to Wikipedia and doesn't re-import the error at the next rebuild.

## Merging several edits on one event

Edits are judged one field at a time. The **current value** of a field is the dataset's value with every published edit applied.

1. An edit's field **applies** if its `before` equals the current value.
2. Two pending edits changing **different fields** of the same event never clash; each can be approved on its own.
3. Two pending edits changing the **same field to the same value** are shown together as agreement. Approving that field in one edit also closes **that field only** in the other, as `approved` with a receipt pointing to the actual approval (`agreement_with`), which credits its author. The other edit's remaining fields stay `pending` and are reviewed on their own. Agreement never approves another field and never replaces the approver's receipt. Example: edit 1 `{ name: A→B }` and edit 2 `{ name: A→B, location: X→Y }`. Approving edit 1's name closes edit 2's name by agreement; edit 2's location is still pending.
4. Two pending edits changing the **same field to different values** are shown side by side. The admin approves one, combines them by editing the value (recorded as the admin's change), or rejects.
5. When an approval changes a field, every other pending edit of that field whose `before` no longer matches becomes `conflict` for that field. The admin then sees three values (original, approved, proposed) and can apply the proposal on top, reject it, or send it back.
6. Successive approvals of one field **compose**. Starting from the dataset's value A, an approval A→B followed by a later approval B→C publishes one patch A→C, keeping both approvals in its history (see Publishing to visitors). Conflict checks compare with the effective value (B, then C); visitors' pages compare with the dataset's value (A).
7. Text is never merged automatically: two descriptions are always settled by a person.

The merge logic lives in a small module (`modules/world-edits.js`) shared by the review page and the overlay loader. Unit tests cover each case above.

## Admin review page

`history/review.html`, reached from the settings panel and shown to admins only; the rules enforce access whatever the page shows.

- **Queue tabs**: Ready, Flagged, Automatically rejected, Conflicts, Sent back, History. Each tab shows a count; Ready and Flagged are the default view.
- **Grouped by event**: a card with the event's current values, then each pending edit for it.
- **For each edit**:
  - author, age, reason and sources;
  - a field-by-field before/after: a word-level diff for text, a small map with both pins for location, both images side by side with credit and license;
  - check results with pass, warn or fail and their detail.
- **Actions**:
  - **Approve**, either all fields or ticked fields only;
  - **Reject** (reason required);
  - **Send back** (note required);
  - on automatically rejected edits, **Approve anyway** (note required, recorded as an override);
  - **Approve all checked** for a selection of Ready edits whose checks all passed.
- **History**: approved, rejected and overruled edits, newest first, each with **Revert**.

Approving runs in one Firestore transaction. The transaction sets the edit to `approved`, then `published`, updates the overlay (below) and marks clashing pending edits `conflict`.

## Editor screens

- **Suggest an edit** (pencil) on every world event, for signed-in editors, reviewers and admins.
  - It opens the event form filled with the current values, plus the image (Commons link or upload) and location pin sections.
  - Before submitting, a summary shows what changes ("Date: 1931 → March 1931").
  - Reason is required; sources are required for name, date and location changes.
- **Suggest a new event**: the same form, empty. It replaces the admin-only Add event debug tool.
- **My edits** in the settings panel: each edit with its status, the checker's or admin's reason, and **Revise** or **Withdraw** while that's possible.
- The author sees a small "Edit pending" mark on events they have pending edits for. Nobody else does.

## Publishing to visitors

Approved values go into a single public document, `world_overlay/current`:

```
world_overlay/current
  version      incremented on every change
  dataset      { id, sha256 } of the dataset currently served
  patches      map, event_id -> { field -> {
                 base         the dataset's value the patch applies to (A)
                 prior_bases  earlier dataset values still accepted, for pages loading an older dataset
                 value        the effective approved value (C)
                 chain        ordered approval receipts: [{ edit_id, revision, before, after, approved_by, approved_at }]
               } }
  created      map, event_id -> { record, record_sha256, edit_id, revision, approved_by, approved_at }
               approved_by is an opaque reviewer reference (see Accountability)
```

Everyone can read it; only admins write it, inside the approval transaction.

**Composing approvals.** The first approval of a field creates its patch with `base` set to the dataset's value and `value` set to the approved value. A later approval of the same field (B→C, judged against the effective value B) appends its receipt to `chain` and sets `value` to C, keeping `base` A. A fresh visitor loading A therefore gets C. A revert is an approval like any other: after A→B→C, reverting the C edit appends C→B and sets `value` back to B. When `value` equals `base` again, the patch is a no-op and is removed, with the chain kept in the edits' histories.

**At load**, after the released images and locations are attached, the site goes through the patches:
1. if the loaded value equals `base` or one of `prior_bases`, it applies `value`;
2. if the loaded value already equals `value`, it skips the patch, because the change has been folded in;
3. otherwise it reports the patch in the console as stale and leaves the loaded value, for the pipeline to reconcile.

For each `created` entry, the site:
1. adds the record if no loaded event has that `event_id`;
2. skips it if a loaded event has that `event_id` and its normalized record hashes to `record_sha256` (folded);
3. otherwise keeps the loaded event and reports the difference: once the dataset holds the event, it wins, and later changes to it go through ordinary patches.

New events are never added twice, whatever the order of deployment and cleanup. The timeline is re-sorted after all of this.

**Size.** A Firestore document holds at most 1 MiB, and descriptions vary in length, so there is no fixed patch count. The approval transaction measures the encoded overlay. If the result would exceed 900 KiB, it refuses the approval with "the overlay is full: fold approved edits into the dataset first", and nothing is lost. The review page shows the overlay's current size against that limit. If needed, a later version can shard the overlay into several documents; the design doesn't depend on one.

An approved image is shown through the same viewer as released images, from its image record (caption, date, credit and license). The image patch is applied after the released images are attached: it replaces the released image, or hides it when `after` is `null`.

Uploaded images are stored under `edit_uploads/{uid}/{editId}/r{revision}-{sha256}.webp`, readable by the author and admins only. Approving an upload is staged so visitors never get a pointer to a missing or different file:
1. The admin's browser copies the file to `world_images/{event_id}/{editId}-r{revision}-{sha256}.webp`, which everyone can read. Storage rules allow creating it but not overwriting it.
2. It reads the public copy back and checks that its SHA-256 and size equal the edit's `asset`.
3. Only then does it run the approval transaction, which writes the overlay with `image_url` and `thumbnail_url` pointing at the verified public copy.

If the copy or the check fails, nothing is approved and the admin sees why. A public copy left behind by a failed transaction is never referenced. It is listed in the review page's History for an admin to delete.

## Folding into the dataset

A history-dp job owned by Atlas folds approved edits into the dataset in four steps. Each step is tied to exact revisions, so a later approval is never lost:
1. **Freeze an export manifest.** It reads the overlay at one `version` and writes an immutable manifest (`manifest_id`, `overlay_version`, SHA-256). The manifest lists each patch with its `base`, `value` and the exact chain receipts (edit ID and revision) folded, and each created event with its `record_sha256`. Approval receipts, not edit statuses, are the input.
2. **Rebuild.** The canonical rebuild applies the manifest's values and records the manifest ID.
3. **Record deployment.** Once the rebuilt dataset is live, the usual live check records the served dataset's SHA-256 (the same receipt as for image releases today).
4. **Clean up conditionally**, in one transaction against the overlay:
   - **Patch unchanged since the manifest** (its last chain receipt is the manifest's): remove it.
   - **Patch approved again since** (for example the manifest folded A→B and a later approval made it A→C): keep it and rebase it. `base` becomes the folded value B, the old base A moves to `prior_bases`, and `chain` keeps only the receipts after the manifest's.
   - **Created event in the served dataset**, with an equal `record_sha256`: remove its entry. If the record differs, keep the entry and report it.
   - Finally, set `dataset` to the served SHA-256, and mark the folded fields `merged` on their edits.

**Older pages.** A visitor whose browser still has the previous dataset loads value A. A rebased patch still applies to them, because A is in `prior_bases`. `prior_bases` entries are dropped one deployment later.

Agents' own data-quality fixes can later go through the same bucket as edits authored by the checker account.

## Accountability

Every change to what visitors see can be traced to a person, at every stage:
- **The edit** records its author (`author.uid`, `author.email`, set at creation and checked by the rules), each revision's time, and the checker run that judged it.
- **The approval** records the approver: `review.by` holds the admin's `uid`, `email` and `role` at that moment, with `review.at` (server time), the decision, the fields approved, the note, and `override: true` when an automatic rejection was overruled. The rules accept a review only when `review.by` is the signed-in admin and the time is the server's, so it can't be written on someone else's behalf. Approval fields are never edited afterwards. A change of mind is a revert, which records its own approver.
- **Private and public records are kept apart.** Hiding a name in the UI doesn't make a public document private. So identities (emails, uids) are kept only in private places:
  - the `edits` documents, readable by authors and admins;
  - the `users` collection;
  - a private intake file outside any public repository, `history-data-private/edit-identities.jsonl` or wherever Rachid chooses (open question 3), which maps each opaque reference to the person.

  Everything public, meaning the overlay, the canonical dataset, releases and anything committed to a public repository, carries only **opaque references**: a stable `ref_` + hash per person, plus edit IDs, unless Rachid explicitly chooses to disclose names.
- **The overlay** stores, with each patch, the chain of approval receipts with `approved_by` as an opaque reference, edit IDs and times.
- **The dataset export** carries the opaque author and approver references, approval times, override flags, edit IDs and revisions into the manifest and the rebuild. A folded change stays attributable after it leaves the overlay: the private intake file resolves each reference to a person.
- **The review page's History** lists each decision with its approver and can be filtered by approver.

## Revert

**Revert** on a published edit creates a new edit swapping `before` and `after`, authored by the admin. It goes through the same approval and is recorded in History. Nothing is ever silently deleted.

## Access rules (firestore.rules, storage.rules)

- `edits`:
  - **Create:** an editor, reviewer or admin. The author must be the signed-in account, `status: submitted`, no `review`, `published` or `merged` fields, only known field names in `changes`, within the size limits.
  - **Update by the author:** only while `submitted`, `auto_rejected`, `flagged` or `sent_back`. The author may change `changes`, `reason` and `sources` (status back to `submitted`, `revision` + 1) or set `withdrawn`.
  - **Update by an admin:** the review fields and the transitions in Statuses only, and never their own edit.
  - **The checker:** writes through the Admin SDK, which bypasses the rules; its key never leaves Rachid's machine.
  - **Read:** the author and admins only.
  - **Delete:** nobody.
- `world_overlay/current`: everyone reads; only admins write.
- Storage `edit_uploads/{uid}/…`: the author creates and reads, with no overwriting; admins read.
- Storage `world_images/…`: everyone reads; only admins create, with no overwriting.

Rules tests cover each line in `firebase/tests/rules.test.js` and `storage.test.js`.

## Phases (each a reviewed PR)

| # | Delivers | Owner, reviewer |
|---|---|---|
| 1 | `edits` model and rules; Suggest an edit for name, date, description, Wikipedia link and category; browser checks; My edits | Maia, Atlas |
| 2 | Review page; approve, reject, send back, overrule; merging and conflicts; overlay and visitor loading; revert | Maia, Atlas |
| 3 | Agent checker and its schedule; service-account setup | Atlas, Maia |
| 4 | Location proposals with map pin, checked by Hermes; image proposals from Commons and uploads, checked by Iris | Maia with Hermes and Iris |
| 5 | Suggest a new event; retire the admin Add event and Push debug tools | Maia, Atlas |
| 6 | Folding into the dataset and overlay cleanup | Atlas, Maia |

Until phase 3 is live, every edit is reviewed by hand: the checker's absence leaves edits `submitted`, and the review page shows them under Flagged. Rules changes are deployed by Rachid after each merge (`firebase/README.md`).

## Tests

- **Unit:**
  - merge cases 1–7, including a partial approval and agreement on a multi-field edit (only the agreed field closes);
  - composition: A→B then B→C loads as C from A, and reverting C after B gives B;
  - overlay application: applies, already folded, stale, and a prior base after a rebase;
  - created events: added once, skipped when folded, reported when different;
  - folding races: an export of A→B followed by an approval B→C keeps C after cleanup; a deployment before cleanup doesn't duplicate a created event;
  - image identity and removal: hiding a released image, a folded removal skipped, revert restoring the full record;
  - `content_sha256` normalization, the overlay size limit, and the field checks.
- **Rules:** every create, update and read case above, including an admin approving their own edit (denied) and a visitor reading `edits` (denied).
- **Emulator browser:**
  - an editor suggests an edit, sees it in My edits, and a visitor doesn't see it;
  - an admin approves, and a visitor sees the change after a reload;
  - two edits on different fields both apply;
  - two edits on the same field produce a conflict;
  - an automatically rejected edit can be approved anyway;
  - an approval of a revision the author has since changed is refused;
  - an upload is approved only after its public copy is verified, and a failed copy approves nothing;
  - revert restores the old value.
- **history-dp:** checker unit tests per check, plus a replay over fixture edits.

## Open questions for Rachid

1. **Self-approval while there's one admin.** Rachid is the only admin. Should an admin's own edit be approvable by themselves once its automatic checks pass, until a second admin exists? Recommended: yes, recorded as self-approved.
2. **Upload rights.** What do uploaders grant? Recommended: a confirmation that they took the photo or hold the rights, releasing it under CC BY-SA 4.0 with the credit name they give.
3. **Contributor credit and public identities.** Should visitors see who changed an event, and where does the private identity file live? Recommended: the page shows no names for now, only a small "community edited" mark in the event's details. Public artifacts carry opaque references only, and the identity mapping stays in Firestore and in a private file outside any public repository.
4. **Daily limit.** Recommended: 50 edits per author per day, raised on request.
5. **Service account.** Rachid creates a Firebase service-account key in the console and stores it outside every repository (for example `~/.config/historiline/checker-key.json`), for the agents' checker only.
