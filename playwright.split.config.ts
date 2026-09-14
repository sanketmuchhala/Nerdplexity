import { defineConfig } from '@playwright/test';

// The deployed shape: the web app built with VITE_API_URL and served on its own origin (as on
// Vercel), calling a separately running backend (as on Render or Railway) across origins.
// 'split' uses a server on this computer; 'hosted' uses a hosted server with accounts.
const webPort = Number(process.env.SPLIT_WEB_PORT) || 5575;
const apiPort = Number(process.env.SPLIT_API_PORT) || 5576;
const hostedApiPort = Number(process.env.HOSTED_API_PORT) || 5577;
const hostedWebPort = Number(process.env.HOSTED_WEB_PORT) || 5578;
const fakePort = Number(process.env.FAKE_PROVIDER_PORT) || 5299;

// A separate output folder per build, so the normal frontend/dist is never left pointing at a test server.
const preview = (outDir: string, port: number) =>
  `pnpm --filter @app/web exec vite build --outDir ${outDir} && pnpm --filter @app/web exec vite preview --outDir ${outDir} --host 127.0.0.1 --port ${port} --strictPort`;

export default defineConfig({
  testDir: './tests/split',
  workers: 1,
  reporter: 'list',
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'split', testMatch: 'split.spec.ts', use: { baseURL: `http://127.0.0.1:${webPort}` } },
    { name: 'hosted', testMatch: 'accounts.spec.ts', use: { baseURL: `http://127.0.0.1:${hostedWebPort}` } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @app/server dev',
      url: `http://127.0.0.1:${apiPort}/v1/health`,
      env: { PORT: String(apiPort), NERDPLEXITY_DATA_DIR: 'memory://', NERDPLEXITY_HOSTED: '', DATABASE_URL: '' },
      timeout: 30_000,
    },
    {
      command: preview('dist-split', webPort),
      url: `http://127.0.0.1:${webPort}`,
      env: { VITE_API_URL: `http://127.0.0.1:${apiPort}`, WEB_PORT: String(webPort) },
      timeout: 120_000,
    },
    {
      // As deployed on Railway: accounts required, only the web app's site allowed. The first account can sign up.
      command: 'pnpm --filter @app/server dev',
      url: `http://127.0.0.1:${hostedApiPort}/v1/health`,
      env: {
        PORT: String(hostedApiPort), HOST: '127.0.0.1', NERDPLEXITY_HOSTED: '1', NERDPLEXITY_DATA_DIR: 'memory://', DATABASE_URL: '',
        BETTER_AUTH_SECRET: 'split-test-secret-not-for-production-use-0123456789',
        BETTER_AUTH_URL: `http://127.0.0.1:${hostedApiPort}`,
        ALLOWED_ORIGINS: `http://127.0.0.1:${hostedWebPort}`, NERDPLEXITY_SIGNUPS: '',
      },
      timeout: 30_000,
    },
    {
      command: preview('dist-hosted', hostedWebPort),
      url: `http://127.0.0.1:${hostedWebPort}`,
      env: { VITE_API_URL: `http://127.0.0.1:${hostedApiPort}`, WEB_PORT: String(hostedWebPort) },
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
