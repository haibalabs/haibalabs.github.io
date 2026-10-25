# Firebase

HistoriLine uses Firebase Authentication (email/password), Cloud Firestore and Cloud Storage (photos in personal timelines). This directory holds the Firestore and Storage security rules, the emulator configuration and their tests.

| | |
|---|---|
| Project ID | `historytimeline-81f70` |
| Console | https://console.firebase.google.com/project/historytimeline-81f70 |
| Owner | rachid.el.guerrab@gmail.com (Project settings → Users and permissions) |
| Rules | [firestore.rules](firestore.rules) and [storage.rules](storage.rules), deployed from this directory only |
| Storage | `gs://historytimeline-81f70.firebasestorage.app` in `us-east1`, created 2026-10-24 for personal timeline photos; see [Cloud Storage](#cloud-storage-personal-timeline-images) |

## Access model

Accounts are invite-only. Each invited account has a document `users/{uid}`, where `{uid}` is the account's User UID, holding a single field `role`:

| Role | Can |
|---|---|
| `viewer` | Sign in and read shared event collections |
| `editor` | Also create and update events (each write records the author's UID and the server time) |
| `reviewer` | Same as editor for now |
| `admin` | Also delete events and manage other accounts' roles (not their own) |

Shared edits to the world dataset live in `events_main`, one document per event keyed by its `event_id` (the rules require the two to match). The app syncs only datasets it recognizes as the world dataset whose events all have valid, unique IDs; for any other dataset, including the legacy default `events.json`, sync is disabled with an explanation in the settings panel. Conflicting changes are listed there to resolve as "Keep mine" or "Take theirs".

A signed-in account without a `users` document can read and write nothing. Collections not listed in the rules are denied. The app hides controls by role, but the rules are what enforce access. For now the app shows its sync and debug controls (including adding events) to admins only, although the rules also allow editors to write.

Personal timelines (`timelines/{id}` and their `events` subcollection) are private to their owner and listed members, whatever the role; admins cannot read them through the app. See [../PERSONAL-TIMELINES.md](../PERSONAL-TIMELINES.md).

## Invite a user

1. Authentication → Users → **Add user**: enter their email and a temporary password, and send both to them privately.
2. Copy the new account's **User UID**.
3. Firestore → `users` → **Add document**: Document ID = the UID; field `role` (string) = `viewer`, `editor`, `reviewer` or `admin`.

Keep self-service sign-up off: Authentication → Settings → User actions → clear **Enable create (sign-up)**.

## Forgotten passwords

Users select **Forgot password?** on the sign-in form after entering their email; Firebase emails a link to its hosted reset page. An admin can send the same email from Authentication → Users → ⋮ → **Reset password**. Do not delete and re-add the account: that creates a new User UID, and its `users` document would no longer match.

## Change or revoke access

- Change a role: edit `role` on `users/{uid}`.
- Revoke access: delete `users/{uid}`. To block sign-in as well, disable or delete the account under Authentication → Users.

The console bypasses the rules, so the owner can always repair roles there, including their own.

## Change the rules

Never edit rules in the console: the next deploy from this directory overwrites console changes.

1. Edit `firestore.rules` and add or update tests in `tests/rules.test.js`.
2. Run the tests (below). CI runs them on every pull request to `main`.
3. Deploy, once the change is merged:

   ```
   npx firebase login        # once, with an account that has access to the project
   npm run deploy:rules
   ```

Publishing the site to GitHub Pages does not deploy rules.

## Cloud Storage (personal timeline images)

Holds the photos of personal timeline events: one resized photo and a thumbnail per event, readable only by the timeline's owner and members. See [../PERSONAL-IMAGES.md](../PERSONAL-IMAGES.md) for the design and [storage.rules](storage.rules) for access.

Storage requires the pay-as-you-go **Blaze** plan (since February 2026). The project's bucket is a `*.firebasestorage.app` bucket, which on Blaze includes at no cost each month 5 GB stored, 100 GB downloaded, 5,000 upload operations and 50,000 download operations, but only for buckets in `us-central1`, `us-east1` or `us-west1`. Check https://firebase.google.com/pricing for current figures.

One-time setup by the project owner:

1. Firebase console → **Spark plan → Upgrade** (bottom left) → **Blaze**, and link a Cloud Billing account. A new billing account starts as a Google Cloud free trial ($300 credit for 90 days; done 2026-10-24). Before the trial ends, upgrade the billing account to paid (Google Cloud console → **Billing → Account overview → Upgrade**): otherwise Firebase moves the project back to Spark, Storage stops, and trial resources, including stored photos, can be deleted after a 30-day grace period. Firestore and Auth keep working on Spark.
2. Google Cloud console → **Billing → Budgets & alerts → Create budget**: scope `historytimeline-81f70`, amount $5, email alerts at 50%, 90% and 100%. A budget alerts; it does not cap spending.
3. Firebase console → **Build → Storage → Get started** → **Start in production mode** (denies everything until the repository's rules are deployed) → a no-cost location: `us-central1`, `us-east1` or `us-west1`. It cannot be changed later. Done 2026-10-24: `gs://historytimeline-81f70.firebasestorage.app` in `us-east1`.
4. Allow the site to read photos (CORS, from [cors.json](cors.json)). Open Google Cloud Shell (the `>_` icon at the top of the Google Cloud console, with project `historytimeline-81f70` selected) and run:

   ```
   echo '[{"origin":["https://haibalabs.github.io"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gcloud storage buckets update gs://historytimeline-81f70.firebasestorage.app --cors-file=cors.json
   ```

   Without it, uploads work but photos do not display: the app reads them with the Storage SDK's `getBlob`, which needs CORS, instead of shareable download URLs.
5. Deploy the rules, once the change is merged: `npm run deploy:rules` (the photo check on timeline events) and `npm run deploy:storage`. The first Storage deploy asks to grant Storage an IAM role so its rules can read Firestore (who owns a timeline); answer yes.

As with Firestore, never edit Storage rules in the console: they live in this directory and are deployed from here.

## Local testing

Requirements: Node 20+ and Java 21 for the emulators (macOS: `brew install openjdk@21`, then prefix commands with `JAVA_HOME=/opt/homebrew/opt/openjdk@21`).

```
npm ci
npm run test:rules        # Firestore and Storage rules against the emulators
npm run test:auth-flow    # sign-in, sync, timelines and photos in the browser against the emulators
```

`test:auth-flow` also needs the app's dependencies and browser: `npm ci` and `npx playwright install chromium` in `../`.

To try the app by hand against the emulators, start them with `npx firebase emulators:start --only auth,firestore,storage --project demo-historiline`, serve the repository root, and open `http://localhost:<port>/history/?emulator`. The `emulator` parameter works only on localhost. The emulators start empty; create accounts with the Auth emulator's REST API (see `../tests/e2e/auth-flow.spec.js`) or set `"ui": { "enabled": true }` in `firebase.json` for the Emulator UI.

## First deployment of these rules

Before the first `npm run deploy:rules`, create a `users/{uid}` document for each existing account (step 3 above), with `admin` for the owner. The `authorized_users` collection is denied by these rules and can be deleted after the deploy, along with the test collections `events_immigrant_song` and `events_testing`.
