import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { BenchResults, RunEnvelope } from '@app/types';
import { createApp } from '../app.js';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import { loadSuite } from '../bench/suite.js';

let database: DatabaseHandle;
let app: Server;
let provider: Server;
let base = '';
let fake = '';

/** A local model server: "good-" models answer Bench math correctly, others give a wrong number. */
function fakeProvider() {
  const answers = new Map(loadSuite().flatMap(item => item.grade.kind === 'number' ? [[item.prompt, item.grade.answer]] : []));
  return http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const prompt = [...body.messages].reverse().find((m: any) => m.role === 'user')?.content;
    const text = String(body.model).startsWith('good-') ? `Answer: ${answers.get(prompt) ?? 4}` : 'Answer: -1';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
}

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  database = await openDatabase(process.env.TEST_DATABASE_URL ? { url: process.env.TEST_DATABASE_URL, seedLocalUser: true } : { dataDir: 'memory://', seedLocalUser: true });
  app = createApp({ db: database.db, extraOrigins: new Set(), webDist: '/nonexistent', testUsers: true }).app.listen(0, '127.0.0.1');
  await new Promise(resolve => app.once('listening', resolve));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  provider = fakeProvider();
  fake = await listen(provider);
});
afterAll(async () => {
  await Promise.all([app, provider].map(s => new Promise(resolve => s.close(resolve))));
  await database.close();
});

const as = (user: string) => {
  const headers = { 'content-type': 'application/json', 'x-nerdplexity-test-user': user };
  const call = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  /** Follow a run's events to the end. */
  const follow = async (runId: string) => {
    const text = await (await fetch(`${base}/v1/runs/${runId}/events?after=0`, { headers })).text();
    return text.trim().split('\n').map(line => JSON.parse(line) as RunEnvelope);
  };
  return { get: (r: string) => call('GET', r), post: (r: string, b: unknown) => call('POST', r, b), del: (r: string, b?: unknown) => call('DELETE', r, b), follow };
};

const key = () => `bench_${Math.random().toString(36).slice(2, 12)}`;
const connections = () => [{ id: 'fake', target: { kind: 'openai-compatible', baseURL: `${fake}/v1` } }];

describe('Bench over HTTP', () => {
  it('describes the suite and rejects invalid jobs', async () => {
    const user = as('bench-validate');
    const suite = await user.get('/v1/bench/suite');
    expect(suite.body.categories.map((c: any) => [c.category, c.count])).toEqual([['code', 20], ['math', 20], ['instructions', 20], ['tools', 20], ['facts', 20]]);
    const valid = { idempotencyKey: key(), connections: connections(), models: [{ connectionId: 'fake', model: 'good-8b' }], categories: ['math'], perCategory: 1 };
    expect((await user.post('/v1/bench', { ...valid, categories: ['poetry'] })).body.error).toMatch(/Choose categories/);
    expect((await user.post('/v1/bench', { ...valid, perCategory: 21 })).body.error).toMatch(/1–20 items/);
    expect((await user.post('/v1/bench', { ...valid, models: [{ connectionId: 'other', model: 'm' }] })).body.error).toMatch(/must name one of the connections/);
    expect((await user.post('/v1/bench', { ...valid, connections: [] })).status).toBe(400);
  });

  it('grades a job, keeps results per user, and the Free Router then prefers the model that passed', async () => {
    const user = as('bench-owner');
    const start = await user.post('/v1/bench', {
      idempotencyKey: key(), connections: connections(), categories: ['math'], perCategory: 3,
      models: [{ connectionId: 'fake', model: 'good-8b' }, { connectionId: 'fake', model: 'bad-70b' }],
    });
    expect(start.status).toBe(201);
    expect(start.body.total).toBe(6);
    const events = await user.follow(start.body.runId);
    expect(events.at(-1)?.event.type).toBe('completed');
    expect(events.filter(e => e.event.type === 'bench')).toHaveLength(6);

    const results = (await user.get('/v1/bench/results')).body as BenchResults;
    const score = (model: string) => results.scores.find(s => s.model === model);
    expect(score('good-8b')).toMatchObject({ category: 'math', passed: 3, failed: 0, errors: 0 });
    expect(score('bad-70b')).toMatchObject({ category: 'math', passed: 0, failed: 3 });
    expect(results.recent).toHaveLength(6);
    expect((await as('someone-else').get('/v1/bench/results')).body).toEqual({ scores: [], recent: [] });

    // By name alone the 70B model would come first; its Bench results put the 8B model ahead for math.
    const routed = await user.post('/v1/runs', {
      idempotencyKey: key(), messages: [{ role: 'user', content: 'Solve 2 + 2 and give the answer.' }],
      route: { strategy: 'free', connections: connections(), models: [{ connectionId: 'fake', model: 'bad-70b' }, { connectionId: 'fake', model: 'good-8b' }] },
    });
    const route = (await user.follow(routed.body.runId)).find(e => e.event.type === 'route')?.event;
    expect(route).toMatchObject({ model: 'good-8b', status: 'trying', reason: expect.stringContaining('passed 3 of 3 Bench math tests') });

    expect((await user.del('/v1/bench/results', { connectionId: 'fake', model: 'bad-70b' })).body).toEqual({ removed: 3 });
    expect(((await user.get('/v1/bench/results')).body as BenchResults).scores.map(s => s.model)).toEqual(['good-8b']);
    expect((await user.del('/v1/bench/results')).body).toEqual({ removed: 3 });
  });
});
