import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp, type AppOptions } from '../app.js';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import { RunRegistry } from '../runtime/runs.js';
import { exportData, importData, storeStatus } from '../store/transfer.js';
import { listConversations } from '../store/conversations.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
let database: DatabaseHandle;
const servers: Server[] = [];

// CI also runs these against a real Postgres server (TEST_DATABASE_URL); otherwise in-memory PGlite.
const TEST_URL = process.env.TEST_DATABASE_URL;
beforeAll(async () => { database = await openDatabase(TEST_URL ? { url: TEST_URL, seedLocalUser: true } : { dataDir: 'memory://', seedLocalUser: true }); });
afterAll(() => database.close());
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve)))); });

async function start(options: Partial<AppOptions> = {}) {
  const { app } = createApp({ db: database.db, extraOrigins: new Set(), webDist: '/nonexistent', testUsers: true, auth: { secret: SECRET, rateLimit: false }, ...options });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A client for one user: a test user header locally, or a bearer token when hosted. */
function client(base: string, who: { test?: string; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who.test) headers['x-nerdplexity-test-user'] = who.test;
  if (who.token) headers.authorization = `Bearer ${who.token}`;
  const call = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  return {
    get: (route: string) => call('GET', route),
    post: (route: string, body?: unknown) => call('POST', route, body),
    put: (route: string, body: unknown) => call('PUT', route, body),
    patch: (route: string, body: unknown) => call('PATCH', route, body),
    del: (route: string) => call('DELETE', route),
  };
}

const unique = () => Math.random().toString(36).slice(2, 10);

const thread = (id: string, extra: object = {}) => ({
  id, title: 'New chat', provider: 'openai', model: 'fast-model', connectionId: 'fake',
  settings: { temperature: 0.7, max_tokens: 2048, web_enabled: false },
  createdAt: 1_000, updatedAt: 1_000, messages: [], ...extra,
});
const msg = (id: string, role: 'user' | 'assistant', content: string, createdAt = 2_000) => ({ id, role, content, createdAt });

describe('stored data (local)', () => {
  it('keeps PDF originals private, loads them on demand, and preserves them in branches and exports', async () => {
    const base = await start();
    const owner = unique();
    const api = client(base, { test: owner });
    const other = client(base, { test: unique() });
    const pdfBase64 = Buffer.from('%PDF-1.4\noriginal sample\n%%EOF').toString('base64');
    await api.post('/v1/conversations', thread('pdf-thread', { messages: [msg('question', 'user', 'Read this PDF')] }));
    const file = { id: 'pdf-file', name: 'report.pdf', mimeType: 'application/pdf', size: 32, content: '[Page 1]\nReport', kind: 'text', createdAt: 3_000, pdfBase64 };
    expect((await api.post('/v1/conversations/pdf-thread/attachments', file)).status).toBe(204);
    const sourcePath = '/v1/conversations/pdf-thread/attachments/pdf-file/pdf';
    expect((await api.get(sourcePath)).body).toEqual({ pdfBase64 });
    expect((await other.get(sourcePath)).status).toBe(404);
    expect((await other.put(sourcePath, { pdfBase64 })).status).toBe(404);
    const metadata = (await api.get('/v1/conversations')).body[0].attachments[0];
    expect(metadata.hasPdf).toBe(true);
    expect(metadata.pdfBase64).toBeUndefined();
    expect((await api.get('/v1/conversations/pdf-thread/export')).body.attachments[0].pdfBase64).toBe(pdfBase64);
    const exported = (await api.get('/v1/store/export')).body;
    expect(exported.conversations[0].attachments[0].pdfBase64).toBe(pdfBase64);
    expect((await other.post('/v1/import', exported)).status).toBe(200);
    expect((await other.get(sourcePath)).body).toEqual({ pdfBase64 });
    expect((await api.post('/v1/conversations/pdf-thread/fork', { id: 'pdf-branch', beforeMessageId: 'question', title: 'Branch', createdAt: 4_000 })).status).toBe(201);
    expect((await api.get('/v1/conversations/pdf-branch/attachments/pdf-file/pdf')).body).toEqual({ pdfBase64 });
    expect((await api.put(sourcePath, { pdfBase64: 'not a PDF' })).status).toBe(400);
    await api.del('/v1/conversations/pdf-thread/attachments/pdf-file');
    expect((await api.get(sourcePath)).status).toBe(404);
    await api.del('/v1/conversations/pdf-branch');
    expect((await api.get('/v1/conversations/pdf-branch/attachments/pdf-file/pdf')).status).toBe(404);
  });

  it('keeps threads, messages, feedback, attachments, and branches', async () => {
    const api = client(await start(), { test: unique() });
    expect((await api.post('/v1/conversations', thread('t1'))).status).toBe(201);
    expect((await api.post('/v1/conversations', thread('t1'))).status).toBe(409);
    await api.post('/v1/conversations/t1/messages', { message: msg('m1', 'user', 'hello'), title: 'hello', updatedAt: 2_000 });
    await api.post('/v1/conversations/t1/messages', { message: { ...msg('m2', 'assistant', 'hi there', 2_100), provenance: { connectionId: 'fake', modelId: 'fast-model' }, metadata: { tools: [{ name: 'calculator', input: {}, output: 2, step: 1 }] } } });
    // A retried append is harmless.
    await api.post('/v1/conversations/t1/messages', { message: msg('m2', 'assistant', 'hi there', 2_100) });
    expect((await api.patch('/v1/conversations/t1/messages/m2', { feedback: 'helpful' })).status).toBe(204);
    await api.post('/v1/conversations/t1/attachments', { id: 'a1', name: 'notes.txt', mimeType: 'text/plain', size: 5, content: 'notes', kind: 'text', createdAt: 3_000 });
    await api.patch('/v1/conversations/t1', { workbench: { tools: { calculator: true } }, allowCharges: true, updatedAt: 4_000 });

    const [saved] = (await api.get('/v1/conversations')).body;
    expect(saved).toMatchObject({ id: 't1', title: 'hello', allowCharges: true, workbench: { tools: { calculator: true } }, updatedAt: 4_000 });
    expect(saved.messages).toEqual([
      msg('m1', 'user', 'hello'),
      { ...msg('m2', 'assistant', 'hi there', 2_100), provenance: { connectionId: 'fake', modelId: 'fast-model' }, metadata: { tools: [{ name: 'calculator', input: {}, output: 2, step: 1 }] }, feedback: 'helpful' },
    ]);
    expect(saved.attachments).toHaveLength(1);

    const branch = await api.post('/v1/conversations/t1/fork', { id: 't2', beforeMessageId: 'm2', title: 'hello (branch)', createdAt: 5_000 });
    expect(branch.status).toBe(201);
    expect(branch.body).toMatchObject({ id: 't2', branchOf: { conversationId: 't1', messageId: 'm2' }, model: 'fast-model', connectionId: 'fake' });
    expect(branch.body.allowCharges).toBeUndefined();
    expect(branch.body.messages.map((m: { id: string }) => m.id)).toEqual(['m1']);
    expect(branch.body.attachments).toHaveLength(1);

    expect((await api.del('/v1/conversations/t1/attachments/a1')).status).toBe(204);
    expect((await api.del('/v1/conversations/t1')).status).toBe(204);
    expect((await api.get('/v1/conversations')).body.map((c: { id: string }) => c.id)).toEqual(['t2']);
  });

  it('keeps older conversation fields it does not index', async () => {
    const api = client(await start(), { test: unique() });
    await api.post('/v1/conversations', thread('old', { runtime: 'ollama', meta: { tokenCounts: { total_tokens: 3 } } }));
    expect((await api.get('/v1/conversations/old')).body).toMatchObject({ runtime: 'ollama', meta: { tokenCounts: { total_tokens: 3 } } });
  });

  it('rejects malformed records with the failing field', async () => {
    const api = client(await start(), { test: unique() });
    const bad = await api.post('/v1/conversations', { ...thread('x'), messages: [{ id: 'm', role: 'robot', content: '', createdAt: 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/messages\.0\.role/);
    expect((await api.put('/v1/documents/one', { id: 'two', title: 'T', content: 'c', updatedAt: 1 })).status).toBe(400);
  });

  it('merges settings and never stores API keys', async () => {
    const api = client(await start(), { test: unique() });
    expect((await api.get('/v1/settings')).body).toBeNull();
    await api.post('/v1/conversations', thread('charged-thread', { allowCharges: true }));
    await api.patch('/v1/settings', { id: 1, theme: 'dark', apiKeys: { openai: 'sk-secret-value' } });
    const merged = await api.patch('/v1/settings', { costPolicy: 'free-only' });
    expect(merged.body).toEqual({ id: 1, theme: 'dark', costPolicy: 'free-only' });
    const [savedThread] = (await api.get('/v1/conversations')).body;
    expect(savedThread.allowCharges).toBeUndefined();
    await api.put('/v1/connections/openai', { id: 'openai', kind: 'openai', name: 'OpenAI', keyStorage: 'device', enabled: true, createdAt: 1, updatedAt: 1, apiKey: 'sk-secret-value' });
    await api.patch('/v1/connections/openai', { quota: { requestsRemaining: 3, at: 5 }, key: 'sk-secret-value' });
    const [connection] = (await api.get('/v1/connections')).body;
    expect(connection).toMatchObject({ id: 'openai', quota: { requestsRemaining: 3 } });
    expect(JSON.stringify(connection)).not.toContain('sk-secret-value');
  });

  it('records a run outcome exactly once', async () => {
    const api = client(await start(), { test: unique() });
    const record = { id: 'r1', conversationId: 't', status: 'running', startedAt: 10, output: '', tools: [], mode: 'chat' };
    await api.put('/v1/run-records/r1', record);
    await api.patch('/v1/run-records/r1', { output: 'partial', lastSeq: 4, status: 'completed' });
    const [running] = (await api.get('/v1/run-records?status=running')).body;
    // Progress updates cannot change the status; only finish does.
    expect(running).toMatchObject({ status: 'running', output: 'partial', lastSeq: 4 });
    expect((await api.post('/v1/run-records/r1/finish', { ...record, status: 'completed', output: 'done' })).body).toEqual({ claimed: true });
    expect((await api.post('/v1/run-records/r1/finish', { ...record, status: 'interrupted' })).body).toEqual({ claimed: false });
    expect((await api.get('/v1/run-records')).body[0]).toMatchObject({ status: 'completed', output: 'done' });
  });

  it('keeps documents, presets, and comparisons', async () => {
    const api = client(await start(), { test: unique() });
    await api.put('/v1/documents/d1', { id: 'd1', title: 'Brief', content: 'Ship P10.', updatedAt: 1 });
    await api.put('/v1/documents/d1', { id: 'd1', title: 'Brief', content: 'Ship P10 today.', updatedAt: 2 });
    expect((await api.get('/v1/documents')).body).toEqual([{ id: 'd1', title: 'Brief', content: 'Ship P10 today.', updatedAt: 2 }]);
    await api.put('/v1/presets/p1', { id: 'p1', name: 'Terse', settings: { temperature: 0 } });
    expect((await api.get('/v1/presets')).body).toEqual([{ id: 'p1', name: 'Terse', settings: { temperature: 0 } }]);
    await api.put('/v1/comparisons/c1', { id: 'c1', createdAt: 1, prompt: 'Which?', sides: [] });
    expect((await api.get('/v1/comparisons')).body).toHaveLength(1);
    for (const route of ['/v1/documents/d1', '/v1/presets/p1', '/v1/comparisons/c1']) expect((await api.del(route)).status).toBe(204);
    expect((await api.del('/v1/documents/d1')).status).toBe(404);
  });
});

describe('isolation between users', () => {
  it('one user can never read or change another user\'s records, even with the same IDs', async () => {
    const base = await start();
    const a = client(base, { test: `a${unique()}` });
    const b = client(base, { test: `b${unique()}` });
    await a.post('/v1/conversations', thread('shared-id'));
    await a.post('/v1/conversations/shared-id/messages', { message: msg('m1', 'user', 'private to A') });
    await a.put('/v1/documents/doc', { id: 'doc', title: 'A only', content: 'secret plans', updatedAt: 1 });
    await a.put('/v1/run-records/run', { id: 'run', conversationId: 'shared-id', status: 'running', startedAt: 1 });
    await a.patch('/v1/settings', { theme: 'light' });

    expect((await b.get('/v1/conversations')).body).toEqual([]);
    expect((await b.get('/v1/conversations/shared-id')).status).toBe(404);
    expect((await b.get('/v1/documents')).body).toEqual([]);
    expect((await b.get('/v1/run-records')).body).toEqual([]);
    expect((await b.get('/v1/settings')).body).toBeNull();
    // Writes aimed at A's records find nothing.
    expect((await b.patch('/v1/conversations/shared-id', { title: 'hijacked' })).status).toBe(404);
    expect((await b.post('/v1/conversations/shared-id/messages', { message: msg('m9', 'user', 'injected') })).status).toBe(404);
    expect((await b.post('/v1/conversations/shared-id/fork', { id: 'copy', beforeMessageId: 'm1', title: 'copy', createdAt: 1 })).status).toBe(404);
    expect((await b.del('/v1/conversations/shared-id')).status).toBe(404);
    expect((await b.del('/v1/documents/doc')).status).toBe(404);
    expect((await b.patch('/v1/run-records/run', { output: 'x' })).status).toBe(404);
    expect((await b.post('/v1/run-records/run/finish', { id: 'run', conversationId: 'x', status: 'completed', startedAt: 1 })).body).toEqual({ claimed: true });
    // B's records with the same IDs are B's own; A's are unchanged.
    await b.post('/v1/conversations', thread('shared-id', { title: 'B thread' }));
    await b.put('/v1/documents/doc', { id: 'doc', title: 'B only', content: 'other', updatedAt: 2 });
    const [aThread] = (await a.get('/v1/conversations')).body;
    expect(aThread).toMatchObject({ title: 'New chat', messages: [msg('m1', 'user', 'private to A')] });
    expect((await a.get('/v1/documents')).body[0]).toMatchObject({ title: 'A only', content: 'secret plans' });
    expect((await a.get('/v1/run-records')).body[0]).toMatchObject({ status: 'running' });
    expect((await b.get('/v1/conversations')).body[0]).toMatchObject({ title: 'B thread', messages: [] });
  });

  it('runs can be followed and canceled only by the user who started them', async () => {
    const registry = new RunRegistry({ enqueue: fn => fn(), queuePosition: () => 0 });
    const base = await start({ registry });
    const owner = `o${unique()}`;
    const { runId } = registry.start('key-1', false, () => new Promise(() => undefined), `test-${owner}`);
    const stranger = client(base, { test: `s${unique()}` });
    expect((await stranger.get(`/v1/runs/${runId}/events`)).status).toBe(404);
    expect((await stranger.post(`/v1/runs/${runId}/cancel`)).status).toBe(404);
    expect(registry.state(runId)).toBe('running');
    // The same idempotency key from another user starts a different run.
    expect(registry.start('key-1', false, () => new Promise(() => undefined), 'someone-else').runId).not.toBe(runId);
    expect((await client(base, { test: owner }).post(`/v1/runs/${runId}/cancel`)).body).toEqual({ state: 'canceled' });
  });
});

describe('accounts (hosted)', () => {
  const signUp = async (base: string, email: string, password = 'correct horse battery') => {
    const response = await fetch(`${base}/v1/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, name: email.split('@')[0] }) });
    return { status: response.status, body: await response.json(), header: response.headers.get('set-auth-token') };
  };
  const signIn = async (base: string, email: string, password: string) => {
    const response = await fetch(`${base}/v1/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return { status: response.status, body: await response.json() };
  };

  it('requires a signed-in account for data, runs, and discovery', async () => {
    const base = await start({ hosted: true, auth: { secret: SECRET, rateLimit: false, signups: 'open' } });
    const anonymous = client(base);
    for (const [method, route] of [['GET', '/v1/conversations'], ['GET', '/v1/store/status'], ['POST', '/v1/import'], ['POST', '/v1/runs'], ['POST', '/v1/models/discover'], ['GET', '/v1/runs/x/events']] as const) {
      const response = method === 'GET' ? await anonymous.get(route) : await anonymous.post(route, {});
      expect(response.status, route).toBe(401);
      expect(response.body).toEqual({ error: 'Sign in to continue.', code: 'auth-required' });
    }
    // The test-user header means nothing on a hosted server.
    expect((await client(base, { test: 'anyone' }).get('/v1/conversations')).status).toBe(401);
    expect((await client(base, { token: 'forged.token' }).get('/v1/conversations')).status).toBe(401);
  });

  it('signs up, uses a bearer token, signs in again, and signs out', async () => {
    const base = await start({ hosted: true, auth: { secret: SECRET, rateLimit: false, signups: 'open' } });
    const email = `${unique()}@example.com`;
    const created = await signUp(base, email);
    expect(created.status).toBe(200);
    expect(created.body.token).toEqual(expect.any(String));
    expect(created.header).toEqual(expect.any(String));
    const me = client(base, { token: created.body.token });
    expect((await me.get('/v1/account')).body).toMatchObject({ email, local: false });
    await me.post('/v1/conversations', thread('mine'));
    // The signed token from the response header works too.
    expect((await client(base, { token: created.header! }).get('/v1/conversations')).body).toHaveLength(1);

    expect((await signIn(base, email, 'wrong password!')).status).toBe(401);
    const again = await signIn(base, email, 'correct horse battery');
    expect(again.status).toBe(200);
    const second = client(base, { token: again.body.token });
    expect((await second.get('/v1/conversations')).body.map((c: { id: string }) => c.id)).toEqual(['mine']);

    const out = await fetch(`${base}/v1/auth/sign-out`, { method: 'POST', headers: { authorization: `Bearer ${again.body.token}`, 'content-type': 'application/json' }, body: '{}' });
    expect(out.status).toBe(200);
    expect((await second.get('/v1/conversations')).status).toBe(401);
    // Other sessions stay signed in.
    expect((await me.get('/v1/conversations')).status).toBe(200);
  });

  it('allows only the first account by default, and reports it in health', async () => {
    const fresh = await openDatabase({ dataDir: 'memory://' });
    try {
      const base = await start({ db: fresh.db, hosted: true, auth: { secret: SECRET, rateLimit: false, signups: 'first' } });
      expect((await (await fetch(`${base}/v1/health`)).json()).signupsOpen).toBe(true);
      expect((await signUp(base, `owner-${unique()}@example.com`)).status).toBe(200);
      expect((await (await fetch(`${base}/v1/health`)).json()).signupsOpen).toBe(false);
      const refused = await signUp(base, `second-${unique()}@example.com`);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/New accounts are closed/);
    } finally {
      await fresh.close();
    }
  });

  it('accepts the web app served by the hosted server itself, and refuses other sites', async () => {
    const base = await start({ hosted: true, auth: { secret: SECRET, rateLimit: false, signups: 'open' } });
    const { port } = new URL(base);
    // The browser reached the server at its public name; the page's origin is that same name.
    const post = (origin: string) => new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ email: `${unique()}@example.com`, password: 'correct horse battery', name: 'Self' });
      const req = http.request({ host: '127.0.0.1', port, path: '/v1/auth/sign-up/email', method: 'POST',
        headers: { host: 'nerdplexity.up.railway.app', origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end(body);
    });
    expect(await post('https://nerdplexity.up.railway.app')).toBe(200);
    expect(await post('https://evil.example')).toBe(403);
  });

  it('refuses sign-ups when closed', async () => {
    const base = await start({ hosted: true, auth: { secret: SECRET, rateLimit: false, signups: 'closed' } });
    expect((await signUp(base, `${unique()}@example.com`)).status).toBe(403);
  });
});

describe('import and copy', () => {
  it('imports browser data once, skipping records that already exist', async () => {
    const api = client(await start(), { test: unique() });
    expect((await api.get('/v1/store/status')).body).toMatchObject({ imported: false, counts: { conversations: 0 } });
    const payload = {
      conversations: [thread('c1', { messages: [msg('m1', 'user', 'hi')] }), { id: 'broken' }],
      documents: [{ id: 'd1', title: 'Doc', content: 'text', updatedAt: 1 }],
      runs: [{ id: 'r1', conversationId: 'c1', status: 'completed', startedAt: 1, output: 'hi' }],
      connections: [{ id: 'ollama', kind: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434', keyStorage: 'none', enabled: true, createdAt: 1, updatedAt: 1 }],
      presets: [{ id: 'p1', name: 'Preset' }],
      comparisons: [{ id: 'cmp', createdAt: 1, sides: [] }],
      settings: { id: 1, theme: 'dark', apiKeys: { openai: 'sk-never-stored' } },
      done: true,
    };
    const first = await api.post('/v1/import', payload);
    expect(first.body).toEqual({
      imported: { conversations: 1, documents: 1, runs: 1, connections: 1, presets: 1, comparisons: 1 },
      skipped: { conversations: 1, documents: 0, runs: 0, connections: 0, presets: 0, comparisons: 0 },
    });
    const second = await api.post('/v1/import', { ...payload, settings: { id: 1, theme: 'light' } });
    expect(second.body.imported).toEqual({ conversations: 0, documents: 0, runs: 0, connections: 0, presets: 0, comparisons: 0 });
    expect((await api.get('/v1/settings')).body).toEqual({ id: 1, theme: 'dark' });
    expect((await api.get('/v1/store/status')).body).toEqual({ imported: true, counts: { conversations: 1, documents: 1, runs: 1, connections: 1, presets: 1, comparisons: 1 } });
    expect((await api.get('/v1/conversations')).body[0].messages).toEqual([msg('m1', 'user', 'hi')]);
  });

  it('copies one user\'s data into another database under a different account', async () => {
    const target = await openDatabase({ dataDir: 'memory://' });
    try {
      const source = client(await start(), { test: `src${unique()}` });
      await source.post('/v1/conversations', thread('c1', { messages: [msg('m1', 'user', 'hello'), msg('m2', 'assistant', 'hi')] }));
      await source.put('/v1/documents/d1', { id: 'd1', title: 'Doc', content: 'text', updatedAt: 1 });
      await source.patch('/v1/settings', { theme: 'dark' });
      const exported = (await source.get('/v1/store/export')).body;

      const { user } = await import('../db/schema.js');
      await target.db.insert(user).values({ id: 'acct', name: 'Owner', email: 'owner@example.com' });
      await importData(target.db, 'acct', { ...exported, done: true });
      const copied = await listConversations(target.db, 'acct');
      expect(copied).toHaveLength(1);
      expect(copied[0].messages.map(m => m.content)).toEqual(['hello', 'hi']);
      expect(await storeStatus(target.db, 'acct')).toMatchObject({ imported: true, counts: { conversations: 1, documents: 1 } });
      expect(await exportData(target.db, 'acct')).toMatchObject({ settings: { theme: 'dark' } });
    } finally {
      await target.close();
    }
  });
});

describe('persistence', () => {
  it('keeps data in the PGlite folder across restarts', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nerdplexity-db-'));
    try {
      const first = await openDatabase({ dataDir: dir, seedLocalUser: true });
      await importData(first.db, 'local', { documents: [{ id: 'd1', title: 'Kept', content: 'still here', updatedAt: 1 }], done: true });
      await first.close();
      const second = await openDatabase({ dataDir: dir, seedLocalUser: true });
      expect(await storeStatus(second.db, 'local')).toMatchObject({ imported: true, counts: { documents: 1 } });
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
