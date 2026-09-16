import { describe, expect, it } from 'vitest';
import type { RunEnvelope, RunMessage } from '@app/types';
import { resolveTarget } from './destinations.js';
import { ProviderFailure } from './adapters.js';
import { RunRegistry, type ProgressPayload } from './runs.js';
import { accountOf, benchIndex, MAX_ATTEMPTS, parameterBillions, profileTask, rankCandidates, routedExecutor, RouterHealth, type RouteCandidate, type RoutedRun, fitOutput, promptTokens, RESERVED_OUTPUT, AccountPacer, tryInOrder } from './router.js';
import { validateRunRequest } from '../routes/runs.js';

const sse = (records: unknown[], done = true) => records.map(r => `data: ${JSON.stringify(r)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
const answer = (text: string) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }]);
const stream = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
const error = (status: number, message: string) => new Response(JSON.stringify({ error: { message, code: status } }), { status, headers: { 'content-type': 'application/json' } });

/** Answers by the model named in the request body, recording the order models were asked. */
function fakeProviders(byModel: Record<string, () => Response>) {
  const asked: string[] = [];
  const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    if (!init.body && String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: Object.keys(byModel).map(id => ({ id, pricing: { prompt: '0', completion: '0' } })) }), { headers: { 'content-type': 'application/json' } });
    }
    const model = JSON.parse(String(init.body)).model as string;
    asked.push(model);
    const respond = byModel[model];
    if (!respond) throw new Error(`unexpected model ${model}`);
    return respond();
  }) as typeof fetch;
  return { fn, asked };
}

const openrouter = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-test-key' });
const groq = resolveTarget({ kind: 'groq', apiKey: 'gsk-test-key' });
const candidate = (model: string, extra: Partial<RouteCandidate> = {}): RouteCandidate => ({
  connectionId: 'openrouter', model, target: openrouter, capabilities: { tools: true, vision: false }, contextLength: 131_072, ...extra,
});
const ask = (text: string): RunMessage[] => [{ role: 'user', content: text }];

async function execute(run: Partial<RoutedRun> & { candidates: RouteCandidate[] }, fetchImpl: typeof fetch, health = new RouterHealth()) {
  const events: ProgressPayload[] = [];
  const executor = routedExecutor({ owner: 'u1', request: { maxTokens: 256 }, messages: ask('Hello there'), tools: [], documents: [], ...run }, { health, fetchImpl, enqueue: fn => fn() });
  let result: Awaited<ReturnType<typeof executor>> | undefined;
  let thrown: unknown;
  try { result = await executor({ signal: new AbortController().signal, emit: event => events.push(event) }); }
  catch (e) { thrown = e; }
  return { result, thrown, events, routes: events.filter(e => e.type === 'route'), text: events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('') };
}

describe('spacing requests to one account', () => {
  /** A pacer on a clock that never really waits: the waits are recorded instead. */
  const paced = () => {
    let now = 0;
    const waits: number[] = [];
    const pacer = new AccountPacer(() => now, async ms => { waits.push(ms); now += ms; });
    return { pacer, waits, tick: (ms: number) => { now += ms; } };
  };

  it('spaces requests by what the provider allows a minute, and not at all on this machine', async () => {
    const { pacer, waits } = paced();
    const signal = new AbortController().signal;
    // OpenRouter's free models allow 20 a minute: one request every three seconds.
    for (let i = 0; i < 3; i++) await pacer.take('account-a', 'openrouter', 'remote', signal);
    expect(waits).toEqual([3000, 3000]);
    expect(pacer.gap('groq', 'remote')).toBe(2000);
    expect(pacer.gap('cerebras', 'remote')).toBe(12_000);
    expect(pacer.gap('ollama', 'local')).toBe(0);
  });

  it('keeps each account on its own schedule, and waits no longer than needed', async () => {
    const { pacer, waits, tick } = paced();
    const signal = new AbortController().signal;
    await pacer.take('account-a', 'openrouter', 'remote', signal);
    await pacer.take('account-b', 'openrouter', 'remote', signal);
    expect(waits).toEqual([]);
    tick(3000);
    await pacer.take('account-a', 'openrouter', 'remote', signal);
    expect(waits).toEqual([]);
  });

  it('makes parallel requests to one account wait their turn', async () => {
    const waits: number[] = [];
    let clock = 0;
    const pacer = new AccountPacer(() => clock, async ms => { waits.push(ms); clock += ms; });
    let sent = 0;
    const fetchImpl = (async () => { sent++; return stream(answer('ok')); }) as typeof fetch;
    const health = new RouterHealth();
    const ranked = rankCandidates([candidate('a'), candidate('b')], profileTask(ask('hi'), []), health, 'u').ranked;
    const context = (): Parameters<typeof tryInOrder>[1] => ({
      owner: 'u', health, request: {}, messages: ask('hi'), tools: [], documents: [],
      signal: new AbortController().signal, fetchImpl, enqueue: task => task(), maxAttempts: 1, blockedAccounts: new Set(), pacer,
    });
    await Promise.all([tryInOrder([ranked[0]], context()), tryInOrder([ranked[1]], context())]);
    // The first goes at once; the second waits for the account's next slot, three seconds later.
    expect(waits).toEqual([3000]);
    expect(sent).toBe(2);
  });
});

describe('fitting a long answer to a model', () => {
  const fits = (asked: number, extra: Partial<RouteCandidate>, chars = 4000) =>
    fitOutput(asked, { ...candidate('m', { contextLength: undefined }), ...extra }, ask('x'.repeat(chars)));

  it('asks a model for no more output than it can give, instead of leaving it out', () => {
    // 4,000 characters is about 1,000 tokens of prompt.
    expect(fits(8000, { contextLength: 8192 })).toBe(8192 - 1000 - 256);
    expect(fits(8000, { contextLength: 131_072 })).toBeUndefined();
    expect(fits(8000, { contextLength: 131_072, maxOutputTokens: 4096 })).toBe(4096);
    expect(fits(2048, { contextLength: 131_072 })).toBeUndefined();
    expect(fits(8000, {})).toBeUndefined();
  });

  it('judges what fits on a reserve, so a long answer does not rule out every smaller model', () => {
    const long = [{ role: 'user' as const, content: 'x'.repeat(4000) }];
    // Asking for 8,000 tokens of output does not push the request past a 8k model's context.
    expect(profileTask(long, [], 8000).estimatedTokens).toBe(1000 + RESERVED_OUTPUT);
    expect(rankCandidates([candidate('small', { contextLength: 8192 })], profileTask(long, [], 8000), new RouterHealth(), 'u').ranked).toHaveLength(1);
    expect(promptTokens(long)).toBe(1000);
  });
});

describe('task profile', () => {
  it('classifies the latest request and what a model must support', () => {
    expect(profileTask(ask('Fix this bug in my Python function'), []).kind).toBe('code');
    expect(profileTask(ask('Solve 3x + 4 = 19'), []).kind).toBe('math');
    expect(profileTask(ask('What is 15% of 80?'), []).kind).toBe('math');
    expect(profileTask(ask('What is 12 - 7?'), []).kind).toBe('math');
    expect(profileTask(ask('See you on 2026-09-14, call 555-0199'), []).kind).toBe('general');
    expect(profileTask(ask('Extract the names as JSON'), []).kind).toBe('extraction');
    expect(profileTask(ask('Write a short email to my landlord'), []).kind).toBe('writing');
    expect(profileTask(ask('Why is the sky blue?'), []).kind).toBe('reasoning');
    expect(profileTask(ask('Hi!'), []).kind).toBe('general');
    const images: RunMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image', mimeType: 'image/png', data: 'aW1n' }] }];
    const profile = profileTask(images, ['calculator'], 100);
    expect(profile).toMatchObject({ vision: true, tools: true });
    expect(profile.estimatedTokens).toBe(Math.ceil('What is this?'.length / 4) + 1000 + 100);
  });

  it('reads total parameter counts from model IDs and ignores active counts', () => {
    expect(parameterBillions('meta-llama/llama-3.3-70b-instruct:free')).toBe(70);
    expect(parameterBillions('nvidia/nemotron-3-super-120b-a12b:free')).toBe(120);
    expect(parameterBillions('mistralai/mixtral-8x7b-instruct')).toBe(56);
    expect(parameterBillions('meta-llama/llama-3.2-1b-instruct')).toBe(1);
    expect(parameterBillions('google/gemma-3n-e4b-it:free')).toBeUndefined();
    expect(parameterBillions('deepseek/deepseek-r1-0528:free')).toBeUndefined();
  });
});

describe('ranking', () => {
  const task = (text: string, tools = false) => profileTask(ask(text), tools ? ['calculator'] : [], 256);

  it('prefers a coding model for code, larger models otherwise, and keeps meta-routers last', () => {
    const list = [candidate('openrouter/free'), candidate('meta-llama/llama-3.3-70b-instruct:free'), candidate('qwen/qwen3-coder:free'), candidate('google/gemma-3-4b-it:free')];
    const code = rankCandidates(list, task('Refactor this TypeScript function'), new RouterHealth(), 'u1').ranked.map(r => r.candidate.model);
    expect(code[0]).toBe('qwen/qwen3-coder:free');
    expect(code.at(-1)).toBe('openrouter/free');
    const chat = rankCandidates(list, task('Tell me about octopuses'), new RouterHealth(), 'u1').ranked.map(r => r.candidate.model);
    expect(chat[0]).toBe('meta-llama/llama-3.3-70b-instruct:free');
    // A coding model loses its lead on a general question.
    expect(chat.indexOf('qwen/qwen3-coder:free')).toBeGreaterThan(0);
  });

  it('leaves out models that cannot take the request, and says why', () => {
    const images: RunMessage[] = [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'aW1n' }] }];
    const list = [
      candidate('text-only-70b', { capabilities: { tools: true, vision: false } }),
      candidate('vision-11b', { capabilities: { tools: false, vision: true } }),
      candidate('tiny-context-8b', { capabilities: { tools: true, vision: true }, contextLength: 512 }),
    ];
    const ranking = rankCandidates(list, profileTask(images, [], 256), new RouterHealth(), 'u1');
    expect(ranking.ranked.map(r => r.candidate.model)).toEqual(['vision-11b']);
    expect(ranking.excluded).toEqual({ 'cannot read images': 1, 'context too small': 1 });
    const tools = rankCandidates(list, profileTask(images, ['calculator'], 256), new RouterHealth(), 'u1');
    expect(tools.excluded['cannot use tools']).toBe(1);
  });

  it('skips models cooling down after a rate limit and reports when the first returns', () => {
    let now = 1_000_000;
    const health = new RouterHealth(() => now);
    health.failure(accountOf('u1', openrouter), 'busy-70b', { category: 'quota', message: 'limited', retryable: true, retryAfterMs: 30_000 });
    const ranking = rankCandidates([candidate('busy-70b'), candidate('idle-8b')], task('Hi'), health, 'u1');
    expect(ranking.ranked.map(r => r.candidate.model)).toEqual(['idle-8b']);
    expect(ranking.nextAvailableAt).toBe(1_030_000);
    now += 31_000;
    expect(rankCandidates([candidate('busy-70b')], task('Hi'), health, 'u1').ranked).toHaveLength(1);
  });

  it('ranks by Bench results once a model has at least three graded answers for the task', () => {
    const list = [candidate('big-70b'), candidate('small-8b')];
    const bench = benchIndex([
      { connectionId: 'openrouter', model: 'big-70b', category: 'math', passed: 0, failed: 3, errors: 0, lastAt: 1 },
      { connectionId: 'openrouter', model: 'small-8b', category: 'math', passed: 3, failed: 0, errors: 0, lastAt: 1 },
      { connectionId: 'openrouter', model: 'small-8b', category: 'code', passed: 0, failed: 2, errors: 0, lastAt: 1 },
    ]);
    const order = (text: string, index = bench) => rankCandidates(list, task(text), new RouterHealth(), 'u1', index).ranked.map(r => r.candidate.model);
    expect(order('Solve 12 * 7')).toEqual(['small-8b', 'big-70b']);
    expect(rankCandidates(list, task('Solve 12 * 7'), new RouterHealth(), 'u1', bench).ranked[0].why).toContain('passed 3 of 3 Bench math tests');
    // Two graded code answers are too few to count, so size decides.
    expect(order('Fix this TypeScript bug')).toEqual(['big-70b', 'small-8b']);
    expect(order('Solve 12 * 7', new Map())).toEqual(['big-70b', 'small-8b']);
  });

  it('keeps health separate per account, so a new key or another user starts fresh', () => {
    const health = new RouterHealth();
    health.failure(accountOf('u1', openrouter), 'm-70b', { category: 'auth', message: 'bad key', retryable: false, scope: 'account' });
    expect(health.coolingUntil(accountOf('u1', openrouter), 'other-model')).toBeDefined();
    expect(health.coolingUntil(accountOf('u2', openrouter), 'm-70b')).toBeUndefined();
    const rotated = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-new-key' });
    expect(health.coolingUntil(accountOf('u1', rotated), 'm-70b')).toBeUndefined();
  });
});

describe('routed execution', () => {
  it('tries the next model when the first is rate limited before answering, and reports each attempt', async () => {
    const { fn, asked } = fakeProviders({
      'big-120b': () => error(429, 'Provider returned error'),
      'mid-70b': () => stream(answer('Hello from mid')),
    });
    const health = new RouterHealth();
    const { result, routes, text } = await execute({ candidates: [candidate('mid-70b'), candidate('big-120b')] }, fn, health);
    expect(asked).toEqual(['big-120b', 'mid-70b']);
    expect(text).toBe('Hello from mid');
    expect(routes.map(r => r.type === 'route' && [r.attempt, r.model, r.status])).toEqual([[1, 'big-120b', 'trying'], [1, 'big-120b', 'failed'], [2, 'mid-70b', 'trying']]);
    expect(result?.route).toEqual({ connectionId: 'openrouter', model: 'mid-70b', task: 'general', attempts: 2 });
    expect(result?.usage?.total_tokens).toBe(5);

    // The next run skips the model that is cooling down instead of asking it again.
    const second = await execute({ candidates: [candidate('mid-70b'), candidate('big-120b')] }, fn, health);
    expect(asked.slice(2)).toEqual(['mid-70b']);
    expect(second.result?.route?.attempts).toBe(1);
  });

  it('never switches models after part of an answer was shown', async () => {
    const { fn, asked } = fakeProviders({
      'big-120b': () => stream(sse([{ choices: [{ delta: { content: 'Half an ans' } }] }], false)),
      'mid-70b': () => stream(answer('unused')),
    });
    const { thrown, text, routes } = await execute({ candidates: [candidate('mid-70b'), candidate('big-120b')] }, fn);
    expect(asked).toEqual(['big-120b']);
    expect(text).toBe('Half an ans');
    expect((thrown as ProviderFailure).error.category).toBe('transport');
    expect(routes).toHaveLength(1);
  });

  it('skips the rest of an account after an account-wide free limit and moves to another connection', async () => {
    const { fn, asked } = fakeProviders({
      'or-big-120b': () => error(429, 'Rate limit exceeded: free-models-per-day'),
      'or-mid-70b': () => stream(answer('unused')),
      'groq-8b': () => stream(answer('From Groq')),
    });
    const candidates = [candidate('or-big-120b'), candidate('or-mid-70b'), candidate('groq-8b', { connectionId: 'groq', target: groq })];
    const { result, text } = await execute({ candidates }, fn);
    expect(asked).toEqual(['or-big-120b', 'groq-8b']);
    expect(text).toBe('From Groq');
    expect(result?.route).toMatchObject({ connectionId: 'groq', model: 'groq-8b', attempts: 2 });
  });

  it("passes on the concrete model when OpenRouter's own free router answers", async () => {
    const { fn } = fakeProviders({
      'openrouter/free': () => stream(sse([{ model: 'vendor/picked-9b:free', provider: 'Vendor', choices: [{ delta: { content: 'Picked.' }, finish_reason: 'stop' }] }])),
    });
    const { result, events } = await execute({ candidates: [candidate('openrouter/free')] }, fn);
    expect(events).toContainEqual({ type: 'model', model: 'vendor/picked-9b:free', provider: 'Vendor' });
    expect(result?.route?.model).toBe('openrouter/free');
  });

  it('does not route around a refusal', async () => {
    const fn = (async (_url: RequestInfo | URL, init: RequestInit = {}) => JSON.parse(String(init.body)).model === 'first-70b'
      ? stream(sse([{ choices: [{ delta: {}, finish_reason: 'content_filter' }] }]))
      : stream(answer('should not be asked'))) as typeof fetch;
    const { thrown } = await execute({ candidates: [candidate('first-70b'), candidate('small-1b')] }, fn);
    expect((thrown as ProviderFailure).error.category).toBe('refused');
  });

  it(`stops after ${MAX_ATTEMPTS} attempts and explains what happened`, async () => {
    const models = ['a-100b', 'b-90b', 'c-80b', 'd-70b', 'e-60b'];
    const { fn, asked } = fakeProviders(Object.fromEntries(models.map(m => [m, () => error(503, 'overloaded')])));
    const { thrown } = await execute({ candidates: models.map(m => candidate(m)) }, fn);
    expect(asked).toHaveLength(MAX_ATTEMPTS);
    const failure = (thrown as ProviderFailure).error;
    expect(failure.category).toBe('unavailable');
    expect(failure.message).toMatch(/^4 free models failed/);
  });

  it('explains when no candidate can take the request', async () => {
    const { fn, asked } = fakeProviders({});
    const { thrown } = await execute({ candidates: [candidate('small-8b', { contextLength: 300 })], messages: ask('x'.repeat(4000)) }, fn);
    expect(asked).toEqual([]);
    expect((thrown as ProviderFailure).error.message).toBe('No free model can take this request. Left out: 1 context too small.');
  });

  it('reports quota per connection and records the route on the completed event', async () => {
    const { fn } = fakeProviders({
      'mid-70b': () => new Response(answer('ok'), { headers: { 'content-type': 'text/event-stream', 'x-ratelimit-remaining': '19', 'x-ratelimit-limit': '20' } }),
    });
    const registry = new RunRegistry();
    const executor = routedExecutor({ owner: 'u1', candidates: [candidate('mid-70b')], request: {}, messages: ask('Hi'), tools: [], documents: [] }, { health: new RouterHealth(), fetchImpl: fn });
    const { runId } = registry.start('route-key-1', false, executor, 'u1');
    const events: RunEnvelope[] = [];
    const sub = registry.subscribe(runId, 0, e => events.push(e));
    if (sub.status !== 'ok') throw new Error(sub.status);
    events.push(...sub.replay);
    await new Promise(resolve => setTimeout(resolve, 20));
    const byType = Object.fromEntries(events.map(e => [e.event.type, e.event]));
    expect(byType.quota).toMatchObject({ connectionId: 'openrouter', quota: { requestsRemaining: 19 } });
    expect(byType.completed).toMatchObject({ type: 'completed', route: { model: 'mid-70b', attempts: 1, task: 'general' } });
  });
});

describe('route validation', () => {
  const base = { idempotencyKey: 'route-validate-1', messages: [{ role: 'user', content: 'Hi' }] };
  const route = (models: object[], connections: object[] = [{ id: 'openrouter', target: { kind: 'openrouter', apiKey: 'sk-or-test-key' } }]) => ({ strategy: 'free', connections, models });

  it('accepts a route in place of a model and normalizes candidates', () => {
    const run = validateRunRequest({ ...base, route: route([{ connectionId: 'openrouter', model: 'm-70b', capabilities: { tools: 'yes', vision: false }, contextLength: 8192 }]) });
    expect(run.route?.candidates).toEqual([expect.objectContaining({ connectionId: 'openrouter', model: 'm-70b', capabilities: { tools: null, vision: false }, contextLength: 8192 })]);
  });

  it('rejects unknown connections, duplicates, missing keys, and unknown strategies', () => {
    expect(() => validateRunRequest({ ...base, route: route([{ connectionId: 'elsewhere', model: 'm' }]) })).toThrow(/must name one of the route connections/);
    expect(() => validateRunRequest({ ...base, route: route([{ connectionId: 'openrouter', model: 'm' }, { connectionId: 'openrouter', model: 'm' }]) })).toThrow(/listed twice/);
    expect(() => validateRunRequest({ ...base, route: route([{ connectionId: 'openrouter', model: 'm' }], [{ id: 'openrouter', target: { kind: 'openrouter' } }]) })).toThrow(/Connection openrouter: Add an API key/);
    expect(() => validateRunRequest({ ...base, route: { ...route([{ connectionId: 'openrouter', model: 'm' }]), strategy: 'paid' } })).toThrow(/Unknown route strategy/);
  });

  it('keeps only models on this machine when document tools are on', () => {
    const connections = [{ id: 'openrouter', target: { kind: 'openrouter', apiKey: 'sk-or-test-key' } }, { id: 'lm', target: { kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' } }];
    const documents = [{ id: 'd1', title: 'Notes', content: 'text' }];
    const run = validateRunRequest({ ...base, tools: ['search_documents'], documents, route: route([{ connectionId: 'openrouter', model: 'remote' }, { connectionId: 'lm', model: 'local' }], connections) });
    expect(run.route?.candidates.map(c => c.model)).toEqual(['local']);
    expect(() => validateRunRequest({ ...base, tools: ['search_documents'], documents, route: route([{ connectionId: 'openrouter', model: 'remote' }]) })).toThrow(/Document tools run only on models on this machine/);
  });
});
