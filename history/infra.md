# HistoriLine — Infrastructure & Testing

## Website Setup

HistoriLine is a vanilla JavaScript single-page app with no build step. The repo root (`haibalabs.github.io`) is deployed via GitHub Pages. The app lives entirely under the `history/` subdirectory.

### Stack

- Vanilla ES6 modules — no bundler, no transpilation
- Leaflet 1.9.4 (CDN) — interactive map
- Firebase 11.2.0 (CDN) — Auth, Firestore sync, Analytics
- Font Awesome 6 (CDN) — icons
- OpenStreetMap Nominatim — geocoding

### Entry Point

`history/index.html` loads `script.js` as a module, which initializes managers in order: LocationVerifier → EventManager → PanelManager → UIManager → ModalManager.

Event data is loaded from a JSON file specified via `?file=` query parameter (defaults to `events.json`).

## Running Locally

Any static file server pointed at the repo root works:

```bash
# From repo root
python3 -m http.server 8080

# Or with Node
npx serve . -l 8080
```

Then open `http://localhost:8080/history/index.html`.

Note: if using `serve`, its "clean URLs" feature can break relative paths by stripping `.html` extensions. Use `python3 -m http.server` for a simpler setup.

## Testing

### Prerequisites

- Node.js 20+
- `cd history && npm install`

### Test Scripts

| Command | What it does |
|---------|-------------|
| `npm run test:syntax` | Verifies `date-handlers.js` and `map-utils.js` parse without errors |
| `npm run test:unit` | Runs unit tests with Node.js built-in test runner (`node:test`) |
| `PORT=8181 npm run test:e2e` | Runs Playwright browser tests in headless Chromium |
| `PORT=8181 npm test` | Runs all three in sequence |

### Unit Tests (`tests/unit/`)

Use the Node.js built-in `node:test` runner — zero extra test dependencies. These test pure functions that have no DOM or CDN dependencies.

- **`date-handlers.test.js`** — 110 passing tests for `parseTimeToSortableValue` and `formatHistoricalDate`, plus 10 `it.todo()` for unsupported date formats. Also tests sort-order invariants (prehistoric < BCE < CE, same-year month ordering, season ordering).
- **`map-utils.test.js`** — 9 tests for `getLocationKey` (location display name deduplication).

### E2E Tests (`tests/e2e/`)

Playwright loads the app in headless Chromium and verifies it works end-to-end.

- **`app-load.spec.js`** — Loads `events_sample_small.json` and `events_sample.json`, asserts no page errors and events render.

Playwright config (`playwright.config.js`) requires an unused `PORT` from 1024 to 65535 and starts `tests/serve.py` from this checkout. Browser requests and the loopback server use that port. An existing listener makes the run fail, so another checkout cannot supply the test page.

### Network Blocking in Tests

E2E tests block non-essential external requests so tests don't depend on third-party services:

| Blocked | Why |
|---------|-----|
| `firebaseio.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com` | Firebase runtime APIs (not needed for data loading) |
| `google-analytics.com` | Analytics |
| `fontawesome.com`, `kit.fontawesome.com` | Icons (cosmetic) |
| `nominatim.openstreetmap.org` | Geocoding |
| `tile.openstreetmap` | Map tiles |

**Allowed** (required for app init):
- `unpkg.com` — Leaflet JS/CSS
- `gstatic.com/firebasejs` — Firebase SDK modules (imported as ES modules by `event-manager.js` and `auth-manager.js`)

### Test Data

| File | Events | Purpose |
|------|--------|---------|
| `events_sample_small.json` | 5 | Fast smoke tests |
| `events_sample.json` | ~100 | Broader coverage |
| `events_samples.json` | ~250 | Larger sample (not used in CI yet) |

## CI (GitHub Actions)

Defined in `.github/workflows/ci.yml`. Triggers on push and PR to `main`/`master`.

### Jobs

Three parallel jobs, all using Node.js 20:

**`unit-tests`** (fast, ~5s)
1. `npm ci`
2. `npm run test:syntax`
3. `npm run test:unit`

**`e2e-tests`** (~30s)
1. `npm ci`
2. `npx playwright install --with-deps chromium`
3. `PORT=8181 npm run test:e2e` (the sign-in tests in `auth-flow.spec.js` skip here; they need the emulators)

**`firebase-tests`** (Java 21, Firebase emulators; see [firebase/README.md](firebase/README.md))
1. `npm ci` in `history/` and `history/firebase/`
2. `npx playwright install --with-deps chromium`
3. `npm run test:rules` and `PORT=8181 npm run test:auth-flow` in `history/firebase/`

### What CI Catches

- Syntax errors in core modules
- Regressions in date parsing/sorting (the critical path for timeline ordering)
- Regressions in location key generation
- App initialization failures (module loading, data fetching, event rendering)
- Uncaught JavaScript exceptions during page load
- Firestore rules changes that widen access (role-by-role allow/deny tests)
- Sign-in regressions: session restore on reload, role-based controls, uninvited accounts
- Sync regressions: event_id-keyed documents, the sync gate for unrecognized datasets and duplicate IDs, server revisions reaching untouched events, conflict resolution (the emulator specs share one emulator, so they run with `--workers=1`)
