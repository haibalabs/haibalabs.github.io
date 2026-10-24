# Firebase

HistoriLine uses Firebase Authentication (email/password) and Cloud Firestore. This directory holds the Firestore security rules, the emulator configuration and their tests.

| | |
|---|---|
| Project ID | `historytimeline-81f70` |
| Console | https://console.firebase.google.com/project/historytimeline-81f70 |
| Owner | rachid.el.guerrab@gmail.com (Project settings → Users and permissions) |
| Rules | [firestore.rules](firestore.rules), deployed from this directory only |

## Access model

Accounts are invite-only. Each invited account has a document `users/{uid}`, where `{uid}` is the account's User UID, holding a single field `role`:

| Role | Can |
|---|---|
| `viewer` | Sign in and read shared event collections |
| `editor` | Also create and update events (each write records the author's UID and the server time) |
| `reviewer` | Same as editor for now |
| `admin` | Also delete events and manage other accounts' roles (not their own) |

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

## Local testing

Requirements: Node 20+ and Java 21 for the emulators (macOS: `brew install openjdk@21`, then prefix commands with `JAVA_HOME=/opt/homebrew/opt/openjdk@21`).

```
npm ci
npm run test:rules        # rules against the Firestore emulator
npm run test:auth-flow    # sign-in in the browser against the Auth and Firestore emulators
```

`test:auth-flow` also needs the app's dependencies and browser: `npm ci` and `npx playwright install chromium` in `../`.

To try the app by hand against the emulators, start them with `npx firebase emulators:start --only auth,firestore --project demo-historiline`, serve the repository root, and open `http://localhost:<port>/history/?emulator`. The `emulator` parameter works only on localhost. The emulators start empty; create accounts with the Auth emulator's REST API (see `../tests/e2e/auth-flow.spec.js`) or set `"ui": { "enabled": true }` in `firebase.json` for the Emulator UI.

## First deployment of these rules

Before the first `npm run deploy:rules`, create a `users/{uid}` document for each existing account (step 3 above), with `admin` for the owner. The `authorized_users` collection is denied by these rules and can be deleted after the deploy, along with the test collections `events_immigrant_song` and `events_testing`.
