import { defineConfig } from '@playwright/test';

// Ports are configurable so another checkout's dev servers can keep running.
const webPort = Number(process.env.WEB_PORT) || 5173;
const apiPort = Number(process.env.PORT) || 5174;
const fakePort = Number(process.env.FAKE_PROVIDER_PORT) || 5299;
// Reusing a running server is opt-in: a server on the same port may belong to a different checkout.
const reuseExistingServer = process.env.PW_REUSE === '1';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    // Use an installed browser when requested; CI can install Chromium.
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:server',
      url: `http://127.0.0.1:${apiPort}/health`,
      env: { PORT: String(apiPort) },
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:web',
      url: `http://127.0.0.1:${webPort}`,
      env: { PORT: String(apiPort), WEB_PORT: String(webPort) },
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      // Deterministic OpenAI-compatible provider for run engine tests; no keys or models needed.
      command: 'node tests/fixtures/fake-provider.mjs',
      url: `http://127.0.0.1:${fakePort}/_log`,
      env: { FAKE_PROVIDER_PORT: String(fakePort) },
      reuseExistingServer,
      timeout: 10_000,
    },
  ],
});
