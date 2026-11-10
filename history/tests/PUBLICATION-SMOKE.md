# Published factory events

`Factory publication smoke` runs after successful built-in Pages deployments from this repository's `main` branch. It reads the triggering commit's four public data files, waits up to five minutes for exact deployed hashes, and verifies all indexed accepted events using the deployed `acceptedEventIds` implementation. Three sampled events must appear visibly in search with their exact IDs and accepted status. Artifact hashes are checked again after the browser test.

The report and screenshot are uploaded as workflow artifacts. A commit without `factory-event-visibility/v1` reports `skipped_legacy_visibility`; it does not establish accepted-event visibility. Mismatched or superseding deployments fail the bounded check. Browser writes and WebSockets are blocked. This check neither publishes nor updates the private release ledger.

To check an exact checkout manually:

```sh
node history/tests/check-published.mjs --expected-root /path/to/exact/checkout --commit FULL_COMMIT_SHA --base-url https://haibalabs.github.io/ --output publication-smoke
```

Dependencies are installed with `npm ci` and `npx playwright install chromium` from `history/`. Tests use `node --test history/tests/unit/publication-smoke.test.js`.
