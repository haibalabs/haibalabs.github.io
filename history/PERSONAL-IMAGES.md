# Personal timeline images (U1 follow-up)

Status: design written 2026-10-24; Rachid's decisions recorded below the same day. Implementation starts after the independent design review. Nothing here is built yet.

Editors add a photo to an event in their personal timelines (see [PERSONAL-TIMELINES.md](PERSONAL-TIMELINES.md)). Photos are as private as the timeline: only its owner and listed members can see or add them. World-event images are unchanged; they keep coming from the image pipeline as public URLs.

## Goals and limits

- One photo per event, uploaded from the event form and shown on the event's card like a world image. The event itself is the caption: no separate caption or credit.
- Private: no public or shareable link to a photo.
- Storage-agnostic: resizing, the form, the card and the stored record do not depend on Firebase. One small adapter module talks to the storage service, so it can be replaced (S3/R2, Supabase) without touching the rest.
- Cheap: photos are resized in the browser before upload; only the copies that are displayed are stored, never the original.
- Out of scope: several photos per event, captions and credits, linking to photos hosted elsewhere, albums or galleries, video, editing photos, face recognition, sharing outside the timeline, and importing from photo services.

## Cost (Firebase Storage)

Storage requires the Blaze plan. This project's bucket is a `*.firebasestorage.app` bucket, which includes at no cost each month 5 GB stored, 100 GB downloaded, 5,000 upload operations and 50,000 download operations, in `us-central1`, `us-east1` or `us-west1` only ([pricing](https://firebase.google.com/pricing), checked 2026-10-24). With a resized photo of about 300 KB plus a thumbnail of about 30 KB, that is roughly 15,000 photos stored and 2,500 photos uploaded a month. Testing costs nothing; a $5 budget alert reports anything unexpected. The bucket is `gs://historytimeline-81f70.firebasestorage.app` in `us-east1`, a no-cost region, created 2026-10-24 on a billing account in its Google Cloud free trial (to be upgraded to paid before day 90 to keep Storage). Setup steps: [firebase/README.md](firebase/README.md#cloud-storage-personal-timeline-images).

## Data model

A personal event gains an optional `image`. Its role field uses the image pipeline's display name (`image_role`), so one card renderer serves both kinds.

```
timelines/{timelineId}/events/{eventId}
  ...existing fields
  image    optional; absent when the event has no photo
    ref         string  opaque; only the image adapter interprets it
    thumb_ref   string  opaque; a smaller version for cards
    width       number  pixels of the stored full image
    height      number
    mime        string  image/webp or image/jpeg
    bytes       number  size of the stored full image
    image_role  string  "personal_photo" (role vocabulary shared with the image pipeline)
```

The card uses the event's name as the image's alternative text.

With the Firebase adapter, `ref` is the Storage path, which carries the timeline's generation so files from a deleted timeline can never surface in a new one with the same ID (the same idea as `timelineCreatedAt` for events):

```
timelines/{timelineId}/{generation}/events/{eventId}/img_{uuid}.webp
timelines/{timelineId}/{generation}/events/{eventId}/img_{uuid}_thumb.webp
generation = "{seconds}_{nanoseconds}" of the timeline's createdAt, e.g. 1729800000_123456000
```

The generation is the full Firestore Timestamp, not milliseconds: `toMillis()` drops sub-millisecond precision, so two timelines created under the same ID within one millisecond would otherwise share files. The client builds it from `createdAt.seconds` and `createdAt.nanoseconds`, exactly as stored; the rules compare it as `generation == string(t.seconds()) + '_' + string(t.nanos())`, where `t` is the timeline's current `createdAt`.

Files are immutable: replacing a photo uploads a new file and deletes the old one.

## Modules

| Module | Depends on | Does |
|---|---|---|
| `image-resize.js` | browser canvas only | Decodes the chosen file with its camera orientation applied, re-encodes it as WebP (JPEG where WebP encoding is unavailable) at most 1600 px on the long edge, makes a 400 px thumbnail, and drops all metadata, including GPS location |
| `image-store.js` | nothing | The adapter contract below, and the in-memory adapter used by tests |
| `firebase-image-store.js` | Firebase Storage SDK | The Firebase adapter; the only module that knows about Storage |
| form and card code | the contract only | Choosing, previewing, replacing and removing the photo; showing the thumbnail on the card and the full image when opened |

### Adapter contract

```
upload(target, { full, thumb })  -> { ref, thumb_ref }
    target = { timelineId, generation, eventId }; full and thumb are Blobs
load(ref)                        -> an object URL for <img src>; callers revoke it when done
remove(ref)                      -> deletes one stored file; deleting a missing file is not an error
removeEvent(target)              -> deletes every file stored for that event
removeTimeline(timelineId, generation)
                                 -> deletes every file stored for that timeline
```

The Firebase adapter reads files through the signed-in SDK (`getBlob`), not download URLs: a Firebase download URL works for anyone who has it, which would break privacy. Reading through the SDK needs the bucket's CORS to allow `https://haibalabs.github.io` and localhost; that is a one-time owner step.

## Access (Storage rules, deployed from `firebase/storage.rules`)

- Read and delete: the caller is signed in with a role, is the timeline's owner or a listed member, and the path's generation equals that timeline's current `createdAt` in the seconds-and-nanoseconds encoding above. The rules read the timeline and the caller's role from Firestore (cross-service rules).
- Create: as above, plus a size limit (2 MB full, 200 KB thumbnail), content type `image/webp` or `image/jpeg`, and a file name of the form `img_<uuid>.webp` or `img_<uuid>_thumb.webp` (or `.jpg`). There are no updates.
- Everything else is denied.
- Firestore rules for timeline events add an `image` check: when present, a map with exactly the fields above, typed, with `ref` and `thumb_ref` under that same event's path and generation and `image_role` equal to `personal_photo`. A stray ref could not be read anyway, but the check keeps the records clean.

## Flows

- Add: choose one file (jpeg, png, webp; HEIC where the browser can decode it, otherwise a message) → resize and preview in the form → on save, upload the photo, then save the event with its `image`. If the upload fails, the event is not saved; if the event save fails, the just-uploaded files are removed.
- Replace: choosing another file uploads the new photo, saves the event with it, then deletes the old files.
- Remove: the event saves without `image`, then the old files are deleted.
- Delete event: delete its files, then the event.
- Delete timeline: delete its files, then its events, then the timeline. Files that a failed cleanup leaves behind are unreachable, because the generation no longer matches. They cost storage until removed by hand; an admin cleanup tool is left for later.
- Display: cards load thumbnails lazily as they scroll into view, and opening the image loads the full one.

### Loading and the image cache

Image loads follow the same guards as other timeline reads (see the session and selection tokens in `modules/timeline-ui.js`):

- Each `load` notes the session, the selection and the timeline generation it started under. When it completes, the result is shown only if all three still match; otherwise the new object URL is revoked at once and nothing is displayed or cached.
- The cache is keyed by generation and `ref`, and belongs to the open timeline. Closing the timeline, signing out, switching accounts, losing access, and deleting or recreating the timeline clear it: displayed images are removed and every object URL is revoked.
- Tests include a load that completes after the timeline was closed and after an account switch, checking that no image is shown and no object URL is left unrevoked.

## Rights and attribution

A photo is treated as personal because of where it comes from, never because license fields are missing:

- A personal photo is the image of an event in a personal timeline (`timelines/...`), recorded by the app with `image_role: "personal_photo"`. For these, the card shows no credit or license line; no `rights_basis` such as "personal" and no ownership claim is recorded.
- World-event images keep the image pipeline's fields. A world image without rights fields stays "rights unknown"; it is never treated as personal.

## Testing

- The adapter contract test suite runs against the in-memory adapter, and against the Firebase adapter on the Storage emulator.
- Storage rules tests on the emulator (`@firebase/rules-unit-testing`): owner, member and outsider access; generation mismatch after a timeline is recreated, including two generations within the same millisecond (same `toMillis()`, different nanoseconds); size, type and name limits; no updates.
- Unit tests for image loading with deferred adapter results: a late load after close, sign-out or account switch shows nothing and revokes its object URL; closing clears the cache.
- Firestore rules tests for the `image` field.
- Browser tests on the emulators: add, replace, remove, delete an event, delete a timeline; private reads (no download URLs requested); metadata stripped from the stored file.

## Effect on other work

- Image pipeline (Iris): no change to world-image collection or acceptance. Shared surface: the `image_role` field name and adding the role `personal_photo`; personal photos use no caption, credit or license fields. Personal photos never enter the pipeline, the canonical dataset or the review queue.
- Data pipeline (Atlas): none; personal data stays in Firestore and Storage.
- Firebase: the Storage bucket (created), `storage.rules`, a `deploy:storage` script, the Storage emulator in `firebase.json` and CI, and the `image` check in `firestore.rules`.

## Decisions (Rachid, 2026-10-24)

1. One photo per event.
2. Store only the copies that are displayed (1600 px and a 400 px thumbnail), never the original.
3. No caption or credit: the event is the caption.
4. Upload only; no option to link to photos hosted elsewhere.
