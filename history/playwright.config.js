import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT);
if (!/^[0-9]+$/.test(process.env.PORT ?? '') || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Set PORT to an unused integer from 1024 to 65535.');
}
const baseURL = `http://127.0.0.1:${port}`;
// SHARD=2/6 runs the second of six parts of the tests, to split them across machines
const shard = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(process.env.SHARD ?? '');

export default defineConfig({
  testDir: './tests/e2e',
  // the sign-in flows run only against the Firebase emulators (npm run test:flows in firebase/), so without them
  // they are left out rather than listed as skipped, which also keeps the parts of a split run even
  testIgnore: process.env.FIREBASE_AUTH_EMULATOR_HOST ? [] : ['**/*-flow.spec.js'],
  timeout: 30000,
  retries: 1,
  // every test sets up its own page and data, so tests of one file may run on different workers or jobs
  fullyParallel: true,
  shard: shard ? { current: Number(shard[1]), total: Number(shard[2]) } : null,
  // each test's time, also on CI, where the default prints only dots
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: 'python3 tests/serve.py',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: { PORT: String(port) },
    url: baseURL,
    reuseExistingServer: false,
  },
});
