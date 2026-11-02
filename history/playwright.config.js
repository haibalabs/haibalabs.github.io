import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT);
if (!/^[0-9]+$/.test(process.env.PORT ?? '') || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Set PORT to an unused integer from 1024 to 65535.');
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
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
