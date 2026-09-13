import { defineConfig } from '@playwright/test';

// The deployed shape: the web app built with VITE_API_URL and served on its own origin (as on
// Vercel), calling a separately running backend (as on Render or Railway) across origins.
const webPort = Number(process.env.SPLIT_WEB_PORT) || 5575;
const apiPort = Number(process.env.SPLIT_API_PORT) || 5576;
const fakePort = Number(process.env.FAKE_PROVIDER_PORT) || 5299;

export default defineConfig({
  testDir: './tests/split',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @app/server dev',
      url: `http://127.0.0.1:${apiPort}/v1/health`,
      env: { PORT: String(apiPort) },
      timeout: 30_000,
    },
    {
      // A separate output folder, so the normal frontend/dist is never left pointing at this test's server.
      command: `pnpm --filter @app/web exec vite build --outDir dist-split && pnpm --filter @app/web exec vite preview --outDir dist-split --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      env: { VITE_API_URL: `http://127.0.0.1:${apiPort}`, WEB_PORT: String(webPort) },
      timeout: 120_000,
    },
    {
      command: 'node tests/fixtures/fake-provider.mjs',
      url: `http://127.0.0.1:${fakePort}/_log`,
      env: { FAKE_PROVIDER_PORT: String(fakePort) },
      timeout: 10_000,
    },
  ],
});
