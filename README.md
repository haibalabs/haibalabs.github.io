# haibalabs.github.io
This is haiba labs external experimentation repo.

## Frontend browser tests

From this checkout, install dependencies with `npm ci --prefix history`, then run
`cd history` and `PORT=8181 npm run test:e2e`. Choose an unused port from 1024 to
65535 for each checkout. Playwright starts its own loopback server and fails if
the port is occupied; stop only servers you started.

For a manual preview, run `PORT=8181 python3 history/tests/serve.py` from the
repository root and open `http://127.0.0.1:8181/history/`. The server always serves
the checkout containing `serve.py`, regardless of the launch directory. Stop
that preview before using the same port for Playwright. `CANONICAL_SNAPSHOT`
continues to select the optional canonical-data fixture.
