import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp, type AppOptions } from './app.js';
import { openDatabase, type DatabaseHandle } from './db/client.js';

let server: Server | undefined;
let database: DatabaseHandle;
// CI also runs these against a real Postgres server (TEST_DATABASE_URL); otherwise in-memory PGlite.
const TEST_URL = process.env.TEST_DATABASE_URL;
beforeAll(async () => { database = await openDatabase(TEST_URL ? { url: TEST_URL, seedLocalUser: true } : { dataDir: 'memory://', seedLocalUser: true }); });
afterAll(() => database.close());
afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

async function start(options: Partial<AppOptions> = {}) {
  const { app } = createApp({ db: database.db, extraOrigins: new Set(['https://nerdplexity.vercel.app']), webDist: '/nonexistent', auth: { secret: SECRET, rateLimit: false }, ...options });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server!.once('listening', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('API app', () => {
  it('reports health, hosting, and whether the asking site is allowed', async () => {
    const base = await start();
    const plain = await (await fetch(`${base}/v1/health`)).json();
    expect(plain).toMatchObject({ status: 'ok', hosted: false, originAllowed: true, authRequired: false, signupsOpen: false, features: { ollamaManagement: true } });
    const allowed = await fetch(`${base}/v1/health`, { headers: { Origin: 'https://nerdplexity.vercel.app' } });
    expect(await allowed.json()).toMatchObject({ originAllowed: true });
    // An unlisted site can read health (with CORS headers) so the page can explain the problem.
    const other = await fetch(`${base}/v1/health`, { headers: { Origin: 'https://other.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBe('*');
    expect(await other.json()).toMatchObject({ originAllowed: false });
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('keeps the API closed to unlisted sites and open to listed ones', async () => {
    const base = await start();
    const body = JSON.stringify({ target: { kind: 'openrouter' } });
    const blocked = await fetch(`${base}/v1/models/discover`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://other.example' }, body });
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
    const listed = await fetch(`${base}/v1/models/discover`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://nerdplexity.vercel.app' }, body });
    expect(listed.headers.get('access-control-allow-origin')).toBe('https://nerdplexity.vercel.app');
    expect(await listed.json()).toMatchObject({ ok: false, error: { message: 'Add an API key for this provider.' } });
  });

  it('turns off Ollama management when hosted and says so in health', async () => {
    const base = await start({ hosted: true });
    expect(await (await fetch(`${base}/v1/health`)).json()).toMatchObject({ hosted: true, authRequired: true, features: { ollamaManagement: false } });
    const pull = await fetch(`${base}/v1/models/ollama/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(pull.status).toBe(404);
  });

  it('refuses to start hosted without a strong session secret', () => {
    expect(() => createApp({ db: database.db, hosted: true, auth: { secret: 'short' } })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('answers unknown API paths with JSON, not the web app', async () => {
    const base = await start();
    const response = await fetch(`${base}/v1/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'API route not found.' });
  });
});
