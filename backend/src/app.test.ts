import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp, type AppOptions } from './app.js';

let server: Server | undefined;
afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

async function start(options: AppOptions = {}) {
  const { app } = createApp({ extraOrigins: new Set(['https://nerdplexity.vercel.app']), webDist: '/nonexistent', ...options });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server!.once('listening', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('API app', () => {
  it('reports health, hosting, and whether the asking site is allowed', async () => {
    const base = await start();
    const plain = await (await fetch(`${base}/v1/health`)).json();
    expect(plain).toMatchObject({ status: 'ok', hosted: false, originAllowed: true, features: { ollamaManagement: true } });
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
    expect(await (await fetch(`${base}/v1/health`)).json()).toMatchObject({ hosted: true, features: { ollamaManagement: false } });
    const pull = await fetch(`${base}/v1/models/ollama/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(pull.status).toBe(404);
  });

  it('answers unknown API paths with JSON, not the web app', async () => {
    const base = await start();
    const response = await fetch(`${base}/v1/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'API route not found.' });
  });
});
