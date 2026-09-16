import { describe, expect, it } from 'vitest';
import type { BenchResult } from '@app/types';
import { resolveTarget, type ResolvedTarget } from '../runtime/destinations.js';
import type { ProgressPayload } from '../runtime/runs.js';
import { benchExecutor, benchGapMs, type BenchJob } from './runner.js';
import type { BenchItem } from './suite.js';

const sse = (records: unknown[]) => records.map(r => `data: ${JSON.stringify(r)}\n\n`).join('') + 'data: [DONE]\n\n';
const reply = (text: string) => new Response(sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]), { headers: { 'content-type': 'text/event-stream' } });
const toolReply = (name: string, args: object) => new Response(sse([
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name, arguments: JSON.stringify(args) } }] } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
]), { headers: { 'content-type': 'text/event-stream' } });
const failure = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json', ...headers } });

const math = (id: string, answer: number): BenchItem => ({
  id, category: 'math', source: { dataset: 'test', split: 'test', row: 0, license: 'MIT', url: 'https://example.com' },
  prompt: `question ${id}`, grade: { kind: 'number', answer },
});

const openrouter = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-test-key' });
const groq = resolveTarget({ kind: 'groq', apiKey: 'gsk-test-key' });

/** Answers by model and prompt, recording the order of requests. */
function provider(answer: (model: string, prompt: string, body: any) => Response) {
  const asked: string[] = [];
  const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    if (!init.body && String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'groq-a', pricing: { prompt: '0', completion: '0' } }] }), { headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(String(init.body));
    const prompt = body.messages[0].content;
    asked.push(`${body.model} ${prompt}`);
    return answer(body.model, prompt, body);
  }) as typeof fetch;
  return { fn, asked };
}

async function runJob(job: BenchJob, fetchImpl: typeof fetch, gapMs = () => 0) {
  const saved: BenchResult[] = [];
  const events: ProgressPayload[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const executor = benchExecutor(job, {
    save: async result => { saved.push(result); }, fetchImpl, enqueue: fn => fn(), gapMs, now: () => clock,
    sleep: async ms => { if (ms > 0) { sleeps.push(ms); clock += ms; } },
  });
  await executor({ signal: new AbortController().signal, emit: event => events.push(event) });
  const bench = events.filter((e): e is Extract<ProgressPayload, { type: 'bench' }> => e.type === 'bench');
  return { saved, events, bench, sleeps, statuses: events.flatMap(e => e.type === 'status' ? [e.message] : []) };
}

const job = (targets: [string, ResolvedTarget][], models: [string, string][], items: BenchItem[]): BenchJob => ({
  connections: new Map(targets), models: models.map(([connectionId, model]) => ({ connectionId, model })), items,
});

describe('bench runner', () => {
  it('grades and saves every answer, asking every model an item before the next item', async () => {
    const { fn, asked } = provider((model, prompt) => reply(model === 'good' ? `Answer: ${prompt === 'question a' ? 1 : 2}` : 'Answer: 0'));
    const { saved, bench } = await runJob(job([['or', openrouter]], [['or', 'good'], ['or', 'bad']], [math('a', 1), math('b', 2)]), fn);
    expect(asked).toEqual(['good question a', 'bad question a', 'good question b', 'bad question b']);
    expect(saved.map(r => [r.model, r.itemId, r.status])).toEqual([['good', 'a', 'passed'], ['bad', 'a', 'failed'], ['good', 'b', 'passed'], ['bad', 'b', 'failed']]);
    expect(saved[1].detail).toBe('expected 1, got 0');
    expect(bench.map(e => [e.done, e.total])).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  it('spaces requests to one connection under its free rate limit', async () => {
    expect(benchGapMs(resolveTarget({ kind: 'cerebras', apiKey: 'csk-key-000' }))).toBe(13_200);
    expect(benchGapMs(resolveTarget({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' }))).toBe(0);
    const { fn } = provider(() => reply('Answer: 1'));
    const { sleeps } = await runJob(job([['or', openrouter]], [['or', 'm']], [math('a', 1), math('b', 1), math('c', 1)]), fn, () => 3000);
    expect(sleeps).toEqual([3000, 3000]);
  });

  it('waits out a short rate limit once, and skips a model whose limit is longer, without counting either as wrong', async () => {
    let calls = 0;
    const { fn } = provider(model => {
      calls++;
      if (model === 'brief' && calls === 1) return failure(429, 'slow down', { 'retry-after': '5' });
      if (model === 'spent') return failure(429, 'daily limit reached', { 'retry-after': '3600' });
      return reply('Answer: 1');
    });
    const { saved, bench, statuses, sleeps } = await runJob(job([['or', openrouter]], [['or', 'brief'], ['or', 'spent']], [math('a', 1), math('b', 1)]), fn);
    expect(saved.map(r => [r.model, r.status])).toEqual([['brief', 'passed'], ['brief', 'passed']]);
    expect(sleeps).toContain(5000);
    expect(statuses[0]).toMatch(/brief is rate limited; waiting 5 s/);
    expect(statuses[1]).toMatch(/^Skipping spent:/);
    expect(bench.find(e => e.skipped)).toMatchObject({ skipped: 2 });
    expect(bench.at(-1)).toMatchObject({ done: 4, total: 4 });
  });

  it('skips every model on an account after an account-wide limit or a rejected key, and keeps testing other connections', async () => {
    const { fn, asked } = provider(model => model === 'or-a' ? failure(429, 'Rate limit exceeded: free-models-per-day') : model.startsWith('or-') ? reply('Answer: 1') : failure(401, 'bad key'));
    const connections: [string, ResolvedTarget][] = [['or', openrouter], ['groq', groq]];
    const models: [string, string][] = [['or', 'or-a'], ['or', 'or-b'], ['groq', 'groq-a']];
    const { saved, bench } = await runJob(job(connections, models, [math('a', 1), math('b', 1)]), fn);
    expect(saved).toEqual([]);
    expect(asked.filter(a => a.startsWith('or-b'))).toEqual([]);
    expect(asked.filter(a => a.startsWith('groq-a'))).toHaveLength(1);
    expect(bench.at(-1)?.done).toBe(6);
  });

  it('records failed requests as errors, and skips a model after three in a row', async () => {
    const { fn, asked } = provider(() => failure(503, 'overloaded'));
    const items = ['a', 'b', 'c', 'd'].map(id => math(id, 1));
    const { saved, bench, statuses } = await runJob(job([['or', openrouter]], [['or', 'flaky']], items), fn);
    expect(asked).toHaveLength(3);
    expect(saved.map(r => r.status)).toEqual(['error', 'error', 'error']);
    expect(statuses.at(-1)).toMatch(/Skipping flaky: 3 requests in a row failed/);
    expect(bench.at(-1)).toMatchObject({ done: 4, skipped: 1 });
  });

  it('grades tool calls and sends the item tools with the request', async () => {
    const item: BenchItem = {
      id: 't1', category: 'tools', source: { dataset: 'test', split: 'test', row: 0, license: 'Apache-2.0', url: 'https://example.com' },
      prompt: 'area of 6 by 10', tools: [{ name: 'calculate_area', description: 'Area', parameters: { type: 'object', properties: { base: { type: 'integer' }, height: { type: 'integer' } } } }],
      grade: { kind: 'tool-call', name: 'calculate_area', args: { base: [6], height: [10] } },
    };
    const bodies: any[] = [];
    const { fn } = provider((_model, _prompt, body) => { bodies.push(body); return toolReply('calculate_area', { base: 6, height: 10 }); });
    const { saved } = await runJob(job([['or', openrouter]], [['or', 'caller']], [item]), fn);
    expect(bodies[0].tools[0].function.name).toBe('calculate_area');
    expect(bodies[0].max_tokens).toBe(512);
    expect(saved[0].status).toBe('passed');
  });
});
