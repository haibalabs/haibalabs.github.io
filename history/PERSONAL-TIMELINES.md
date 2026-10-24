# Personal timelines (U1)

Status: data model and Firestore rules implemented and tested; screens proposed below, waiting for Rachid's approval before they are built.

An invited user keeps private timelines of their own events (a family history, a project) and can view one alone or interleaved with world history. Timelines are private to their owner. The model already allows listed members, but there is no sharing UI yet.

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
  ...             the other world-event fields (description, locations, categories, figures) when given
  userId          string  author's Auth UID
  lastModified    timestamp  server time of the write
```

## Access (enforced in `firebase/firestore.rules`, tested in `firebase/tests/rules.test.js`)

- Any invited account (any role) can create timelines it owns.
- The owner and listed members can read a timeline and read, add, change and delete its events. Nobody else can see it, admins included (the Firebase console still can).
- Only the owner can rename it, change its members or delete it, and the owner cannot hand it to another account or make it public.
- Firestore does not delete subcollections with their parent, so the app deletes a timeline's events before the timeline. Once a timeline document is gone, its leftover events are unreachable.

## Proposed screens (for approval)

1. **"My timelines" in the settings panel**, shown to any signed-in invited user: a list of their timelines with event counts, a field to create a new one, and per timeline **Open**, **Rename** and **Delete** (delete asks for confirmation and states how many events go with it).
2. **Opening a timeline** sets `?timeline=<id>` in the address, so it can be bookmarked; the link works only for the owner and members. A pill in the top bar shows the timeline's title with a menu:
   - **With world history**: personal events interleaved with world events in date order, marked with a left accent line and a small "Personal" label;
   - **This timeline only**;
   - **Close timeline**.
3. **Adding events**: while a timeline is open, an **Add event** button (for the owner and members, not only admins) opens the existing event form and adds to that timeline. Events can be edited and deleted from the event itself. A date that cannot be parsed is rejected with a message instead of being saved as year 0.
4. **Saving**: personal events are saved as soon as they are added, edited or deleted, with no Push button; another device sees them after a reload. With no sharing yet, the owner is normally the only writer; if two devices edit the same event, the later save wins.
5. **Filters**: search, categories and the map apply to personal events as they do to world events; personal events without a location stay in the timeline and stay off the map.

Out of scope for U1: a sharing UI, public timelines, merging family timelines, and importing from photos or journals.

## Decisions for Rachid

1. May every invited account create timelines, including viewers? (The rules allow it.)
2. When a timeline is opened, should the default view be **with world history** or **this timeline only**?
3. Is saving immediately, with no Push button and the later save winning, right for personal timelines?
4. Any limit on timelines or events per account for now? (Proposal: none.)
