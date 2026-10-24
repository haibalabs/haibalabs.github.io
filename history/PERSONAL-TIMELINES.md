# Personal timelines (U1)

Status: data model and Firestore rules implemented and tested; screens approved by Rachid on 2026-10-24 (decisions below) and being built.

An editor keeps private timelines of their own events (a family history, a project) and can view one alone or interleaved with world history. Timelines are private to their owner. The model already allows listed members, but there is no sharing UI yet.

## Data model

```
timelines/{timelineId}
  owner       string     Auth UID of the owner
  title       string     1–120 characters
  visibility  "private"  the only value allowed for now
  members     string[]   Auth UIDs who may read it and edit its events (max 20, not the owner); empty until sharing exists
  createdAt   timestamp  server time at creation, never changed
  updatedAt   timestamp  server time of the last change

timelines/{timelineId}/events/{eventId}
  event_id        string  equals the document ID; evt_ + UUID, assigned once at creation
  name            string  1–300 characters
  enhanced_time   string  the date as typed, parsed by the same date handling as world events
  timelineCreatedAt timestamp  the parent timeline's createdAt; ties the event to that timeline
  ...             the other world-event fields (description, locations, categories, figures) when given
  userId          string  author's Auth UID
  lastModified    timestamp  server time of the write
```

## Access (enforced in `firebase/firestore.rules`, tested in `firebase/tests/rules.test.js`)

- Editors, reviewers and admins can create timelines they own; viewers cannot, until timelines open up to more accounts.
- The owner and listed members can read a timeline and read, add, change and delete its events. Nobody else can see it, admins included (the Firebase console still can).
- Only the owner can rename it, change its members or delete it, and the owner cannot hand it to another account or make it public.
- Firestore does not delete subcollections with their parent, so the app deletes a timeline's events before the timeline. Events left behind (a cleanup that failed, or a member's write racing the deletion) stay unreachable, even if someone later creates a timeline with the same ID: every event read and write requires the event's `timelineCreatedAt` to equal the current timeline's `createdAt`, and a new timeline has a new `createdAt`.
- Event IDs must be `evt_` followed by a UUID. Listing a timeline's events must filter on `timelineCreatedAt` equal to the timeline's `createdAt`; an unfiltered list is denied.

## Screens

1. **"My timelines" in the settings panel**, shown to signed-in editors, reviewers and admins: a list of their timelines with event counts, a field to create a new one, and per timeline **Open**, **Rename** and **Delete** (delete asks for confirmation and states how many events go with it).
2. **Opening a timeline** sets `?timeline=<id>` in the address, so it can be bookmarked; the link works only for the owner and members. A pill in the top bar shows the timeline's title with a menu:
   - **With world history**: personal events interleaved with world events in date order, marked with a left accent line and a small "Personal" label;
   - **This timeline only**;
   - **Close timeline**.
3. **Adding events**: while a timeline is open, an **Add event** button (for the owner and members, not only admins) opens the existing event form and adds to that timeline. Events can be edited and deleted from the event itself. A date that cannot be parsed is rejected with a message instead of being saved as year 0.
4. **Saving**: personal events are saved as soon as they are added, edited or deleted, with no Push button; another device sees them after a reload. With no sharing yet, the owner is normally the only writer; if two devices edit the same event, the later save wins.
5. **Filters**: search, categories and the map apply to personal events as they do to world events; personal events without a location stay in the timeline and stay off the map.

Out of scope for U1: a sharing UI, public timelines, merging family timelines, and importing from photos or journals.

## Decisions (Rachid, 2026-10-24)

1. Only editors, reviewers and admins create timelines for now, until timelines open up to more accounts.
2. Opening a timeline shows it **with world history** by default.
3. Personal events save immediately, with no Push button; the later save wins.
4. No limit on timelines or events per account for now.
5. Timelines are reached from the settings panel for now.
