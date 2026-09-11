import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { RunEnvelope } from '@app/types';
import { ProviderFailure } from './adapters.js';
import { RunExecutor, RunRegistry } from './runs.js';
import { runsRouter } from '../routes/runs.js';

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/** Serial queue whose tasks start only when released, to observe queued runs. */
function manualQueue() {
  let chain = Promise.resolve();
  const gates: (() => void)[] = [];
  return {
    enqueue: <T>(fn: () => Promise<T>) => {
      const gate = new Promise<void>(resolve => gates.push(resolve));
      const result = chain.then(() => gate).then(fn);
      chain = result.then(() => undefined, () => undefined);
      return result;
    },
    release: () => gates.shift()?.(),
  };
}

function collect(registry: RunRegistry, runId: string, after = 0) {
  const events: RunEnvelope[] = [];
  const result = registry.subscribe(runId, after, e => events.push(e));
  if (result.status !== 'ok') throw new Error(result.status);
  events.push(...result.replay);
  return { events, types: () => events.sort((a, b) => a.seq - b.seq).map(e => e.event.type), unsubscribe: result.unsubscribe };
}

/** Executor that streams until canceled, recording whether its signal fired. */
function waitingExecutor() {
  const state = { called: false, aborted: false };
  const execute: RunExecutor = ({ signal, emit }) => new Promise((_, reject) => {
    state.called = true;
    emit({ type: 'delta', text: 'first' });
    signal.addEventListener('abort', () => { state.aborted = true; emit({ type: 'delta', text: 'after cancel' }); reject(signal.reason); });
  });
  return { state, execute };
}

describe('RunRegistry', () => {
  it('emits ordered events with measured timing and one terminal event', async () => {
    const registry = new RunRegistry();
    const { runId } = registry.start('key-ordered-1', false, async ({ emit }) => {
      await tick(5);
      emit({ type: 'reasoning', text: 'r' });
      emit({ type: 'delta', text: 'Hello' });
      return { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }, finishReason: 'stop' };
    });
    const sub = collect(registry, runId);
    await tick(20);
    expect(sub.types()).toEqual(['queued', 'started', 'reasoning', 'delta', 'completed']);
    expect(sub.events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
    const done = sub.events[4].event;
    expect(done).toMatchObject({ type: 'completed', finishReason: 'stop', usage: { total_tokens: 3 } });
    if (done.type !== 'completed') throw new Error();
    expect(done.timing.ttftMs).toBeGreaterThanOrEqual(4);
    expect(done.timing.durationMs).toBeGreaterThanOrEqual(done.timing.ttftMs!);
    expect(registry.state(runId)).toBe('completed');
  });

  it('returns the same run for a repeated idempotency key and executes once', async () => {
    const registry = new RunRegistry();
    let calls = 0;
    const execute: RunExecutor = async () => { calls++; return {}; };
    const first = registry.start('key-idem-12', false, execute);
    const second = registry.start('key-idem-12', false, execute);
    await tick(5);
    expect(second).toEqual({ runId: first.runId, existing: true });
    expect(calls).toBe(1);
  });

  it('cancels a running run once and ignores output that arrives after', async () => {
    const registry = new RunRegistry();
    const { state, execute } = waitingExecutor();
    const { runId } = registry.start('key-cancel-1', false, execute);
    const sub = collect(registry, runId);
    await tick(5);
    expect(registry.cancel(runId)).toBe('canceled');
    expect(registry.cancel(runId)).toBe('canceled');
    await tick(5);
    expect(state.aborted).toBe(true);
    expect(sub.types()).toEqual(['queued', 'started', 'delta', 'canceled']);
    expect(sub.events.at(-1)!.event).toMatchObject({ type: 'canceled', reason: 'user' });
  });

  it('cancels a queued local run immediately without calling the model', async () => {
    const queue = manualQueue();
    const registry = new RunRegistry({ enqueue: queue.enqueue, queuePosition: () => 1 });
    const blocker = waitingExecutor();
    const queued = waitingExecutor();
    const a = registry.start('key-queue-a', true, blocker.execute);
    const b = registry.start('key-queue-b', true, queued.execute);
    const sub = collect(registry, b.runId);
    expect(sub.events[0].event).toEqual({ type: 'queued', position: 1 });
    registry.cancel(b.runId);
    expect(sub.types()).toEqual(['queued', 'canceled']);
    queue.release(); await tick(5);
    registry.cancel(a.runId);
    queue.release(); await tick(5);
    expect(blocker.state.called).toBe(true);
    expect(queued.state.called).toBe(false);
    const canceled = sub.events.at(-1)!.event;
    if (canceled.type !== 'canceled') throw new Error();
    expect(canceled.timing.ttftMs).toBeUndefined();
  });

  it('reports provider failures and unexpected errors as failed', async () => {
    const registry = new RunRegistry();
    const quota = registry.start('key-fail-01', false, async () => { throw new ProviderFailure({ category: 'quota', message: 'Slow down', retryable: true, retryAfterMs: 5000 }); });
    const crash = registry.start('key-fail-02', false, async () => { throw new Error('boom'); });
    await tick(5);
    expect(collect(registry, quota.runId).events.at(-1)!.event).toMatchObject({ type: 'failed', error: { category: 'quota', retryAfterMs: 5000 } });
    expect(collect(registry, crash.runId).events.at(-1)!.event).toMatchObject({ type: 'failed', error: { category: 'unknown', message: 'boom' } });
  });

  it('replays after a sequence number and refuses replay once events are dropped', async () => {
    const registry = new RunRegistry({ maxBufferBytes: 400 });
    const { runId } = registry.start('key-replay-1', false, async ({ emit }) => {
      for (let i = 0; i < 10; i++) emit({ type: 'delta', text: `chunk-${i}` });
      return {};
    });
    await tick(5);
    expect(registry.subscribe(runId, 0, () => undefined).status).toBe('expired');
    const tail = collect(registry, runId, 12);
    expect(tail.events.map(e => e.seq)).toEqual([13]);
    expect(tail.types()).toEqual(['completed']);
    expect(registry.subscribe('missing', 0, () => undefined).status).toBe('unknown');
  });

  it('cancels a run nobody is watching, but not while a client is subscribed', async () => {
    const registry = new RunRegistry({ orphanMs: 30 });
    const watched = waitingExecutor();
    const { runId } = registry.start('key-orphan-1', false, watched.execute);
    const sub = collect(registry, runId);
    await tick(60);
    expect(registry.state(runId)).toBe('running');
    sub.unsubscribe();
    await tick(60);
    expect(registry.state(runId)).toBe('canceled');
    expect(sub.events.at(-1)?.event.type).not.toBe('canceled'); // unsubscribed clients get nothing further
    const replay = registry.subscribe(runId, 0, () => undefined);
    if (replay.status !== 'ok') throw new Error();
    expect(replay.replay.at(-1)!.event).toMatchObject({ type: 'canceled', reason: 'no-client' });
  });
});

describe('runs routes', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

  async function start(fetchImpl: typeof fetch) {
    const app = express();
    app.use(express.json());
    app.use('/v1/runs', runsRouter(new RunRegistry(), fetchImpl));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server!.once('listening', resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1/runs`;
  }
  const upstream = (async () => new Response(
    ['Hi', ' there'].map(t => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  )) as typeof fetch;
  const body = (extra: object = {}) => ({
    idempotencyKey: 'route-key-001', target: { kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' },
    model: 'm', messages: [{ role: 'user', content: 'hello' }], settings: { temperature: 0.2, maxTokens: 64 }, ...extra,
  });
  const post = (url: string, data: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

  it('starts a run, streams NDJSON envelopes, and deduplicates the start', async () => {
    const base = await start(upstream);
    const created = await post(base, body());
    expect(created.status).toBe(201);
    const { runId } = await created.json();
    const again = await post(base, body());
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ runId, existing: true });
    const events = await fetch(`${base}/${runId}/events?after=0`);
    expect(events.headers.get('content-type')).toContain('application/x-ndjson');
    const envelopes: RunEnvelope[] = (await events.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(envelopes.map(e => e.event.type)).toEqual(['queued', 'started', 'delta', 'delta', 'completed']);
    const resumed = await (await fetch(`${base}/${runId}/events?after=4`)).text();
    expect(resumed.trim().split('\n').map(line => JSON.parse(line).seq)).toEqual([5]);
  });

  it('runs the document agent through the engine on a local model', async () => {
    const completion = (async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Answer from notes.' } }], usage: { prompt_tokens: 4, completion_tokens: 3 } }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const base = await start(completion);
    const { runId } = await (await post(base, body({ idempotencyKey: 'agent-key-01', agent: true, documents: [{ id: 'd1', title: 'Notes', content: 'Decision: ship.' }] }))).json();
    const envelopes: RunEnvelope[] = (await (await fetch(`${base}/${runId}/events`)).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(envelopes.map(e => e.event.type)).toEqual(['queued', 'started', 'status', 'delta', 'completed']);
    expect(envelopes[3].event).toEqual({ type: 'delta', text: 'Answer from notes.' });
    expect(envelopes[4].event).toMatchObject({ usage: { total_tokens: 7 } });
  });

  it('validates input and reports unknown runs', async () => {
    const base = await start(upstream);
    expect((await post(base, body({ idempotencyKey: 'x' }))).status).toBe(400);
    expect((await post(base, body({ target: { kind: 'anthropic' } }))).status).toBe(400);
    const agentRemote = await post(base, body({ target: { kind: 'openai-compatible', baseURL: 'https://api.example.com/v1' }, agent: true, documents: [{ id: 'd', title: 't', content: 'c' }] }));
    expect((await agentRemote.json()).error).toMatch(/only on models on this machine/);
    expect((await post(base, body({ settings: { maxTokens: 1.5 } }))).status).toBe(400);
    const unknown = await fetch(`${base}/nope/events`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: 'unknown-run' });
    expect((await post(`${base}/nope/cancel`, {})).status).toBe(404);
  });
});
