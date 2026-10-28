# Reporting and contributing to world history

Status, checked on 2026-10-27 against `main` (`82450e5`) with the browser tests below: **there is no way in the app to report bad data**, and **adding an event to the world dataset is an admin-only debug flow whose result visitors never see**. The reviewed-edit flow that would provide both (U2 in history-dp's task list) is not built yet. This page records what exists, exactly, so it can be changed deliberately.

## Reporting bad data

Nothing in the app lets anyone, signed in or not, report a wrong date, name, description, location or image:
- an event shows no report, flag or feedback control for any role;
- the `reviewer` role exists (`modules/roles.js`, `firebase/firestore.rules`) but grants nothing beyond `editor`: there is no review queue and no reviewer-only control.

Bad data is found and fixed outside the app today:
- **Pipeline quality log.** The agents record problems in `history-data/quality/issues.json` (index in `issues.md`), each linked to an event and its evidence, and fix them in the data pipeline. A released image whose event has an open issue shows "Some details of this event are still being reviewed." in the viewer (`event_issue_ids` in `releases/released-images-v1.json`).
- **Location corrections file.** `unverified-locations.json`, maintained by pull request, maps known bad location names to corrected ones; the map shows corrected places and the location tooltip says so.
- **Releases.** Image, caption and location changes reach visitors through reviewed release files in `releases/` (see `releases/README.md`), each a pull request that Rachid merges.

## Adding an event to the world dataset

### Who

Admins only. The Firestore rules let editors, reviewers and admins write to `events_main`, but the app shows the controls to admins only (`modules/ui-manager.js`, "sync and debug controls are admin-only for now"). Editors and reviewers can add events only to their own personal timelines (`PERSONAL-TIMELINES.md`).

### Steps

1. Open the site on the world dataset (the default, `canonical-t2.json`). Other files, including `?file=events.json`, cannot sync, and the settings panel says why.
2. **Settings** (sliders icon) → sign in with an admin account.
3. In the **Sync** group (shown to admins only), tick **Enable adding events**. A **+** button appears in the top bar.
4. **+** opens the event form. Name, time and description are required; category, Wikipedia URL and location (name, city, region, country, historical name) are optional. A date the timeline cannot place is rejected with a message.
5. **Add** puts the event in the timeline immediately with a new permanent ID (`evt_` + UUID), marked as not yet pushed. **It exists only in this browser tab: a reload or closing the tab loses it.**
6. Back in **Settings**, tick **Enable sync events**. **Push (N)** shows how many events are waiting.
7. **Push** writes each waiting event to Firestore `events_main/{event_id}` with the author's UID (`userId`) and the server time (`lastModified`). If someone changed the same event on the server since this copy was loaded, it is not overwritten: the event is listed under the sync controls to resolve with **Keep mine** or **Take theirs**.

### Who sees a pushed event

- **Visitors (signed out): never.** The site loads the world dataset from `canonical-t2.json` and does not read `events_main`.
- **Editors, reviewers and viewers, signed in: never.** They have no Pull control.
- **Admins: only after Pull.** Settings → **Enable sync events** → **Pull** merges server events into the open page. Pulled events are not kept: after a reload, an admin has to Pull again.
- **The data pipeline: not yet.** Nothing exports `events_main` into `history-data` or a canonical rebuild, so pushed events do not reach a release. On 2026-10-26, `events_main` held no documents.

### Editing or deleting world events

There is no edit or delete action on world events for any role; only personal-timeline events can be edited in the app. The rules let admins delete `events_main` documents, but the app has no control for it.

## Tests

| What | Test |
|---|---|
| Admins get the sync and debug controls; editors and viewers do not | `tests/e2e/auth-flow.spec.js` |
| Add, Push, stored under `events_main/{event_id}` without local fields | `tests/e2e/sync-flow.spec.js` ("a pushed event is stored…") |
| Pull takes newer server revisions; conflicts held until Keep mine / Take theirs; no overwrite of newer server changes; invalid server IDs ignored | `tests/e2e/sync-flow.spec.js` |
| A pushed event reaches another admin only through Pull, and never a visitor or an editor | `tests/e2e/sync-flow.spec.js` ("a pushed event stays private…") |
| Who may write `events_main` | `firebase/tests/rules.test.js` |

Run them with the Firebase emulators (Java 21 or later), from `firebase/`: `npm run test:auth-flow`. CI runs them on every pull request to `main`.

## What U2 would add

history-dp's task list, U2 "Edit world history with review":
1. an **Edit** action that records a proposal (changed fields, author, time) instead of changing the event;
2. a **review queue** where a reviewer other than the author approves or rejects it;
3. approved edits **published to every visitor** through an overlay loaded with the dataset;
4. an **export** of approved edits into the pipeline's corrections and quality log, so they survive the next canonical rebuild.

A visitor or editor "Report a problem" action would fit the same queue as a proposal without field changes.
