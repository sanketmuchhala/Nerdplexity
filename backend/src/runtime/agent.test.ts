import { describe, expect, it } from 'vitest';
import type { AgentStep, RunMessage } from '@app/types';
import { resolveTarget } from './destinations.js';
import type { ProgressPayload } from './runs.js';
import { AGENT_LIMITS, agentExecutor, chooseStrategy, family, looksMultiPart, parsePlan, pickDrafters, specialists } from './agent.js';
import { benchIndex, profileTask, rankCandidates, RouterHealth, type RouteCandidate } from './router.js';
import { validateRunRequest } from '../routes/runs.js';

const or = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-test-key' });
const candidate = (model: string, extra: Partial<RouteCandidate> = {}): RouteCandidate => ({
  connectionId: 'or', model, target: or, capabilities: { tools: true, vision: false }, contextLength: 131_072, ...extra,
});
const user = (content: string): RunMessage[] => [{ role: 'user', content }];
const sse = (text: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`;
const ok = (text: string) => new Response(sse(text), { headers: { 'content-type': 'text/event-stream' } });
const fail = (status: number) => new Response(JSON.stringify({ error: { message: `status ${status}` } }), { status, headers: { 'content-type': 'application/json' } });

type Role = 'planner' | 'part' | 'writer' | 'draft';
/** One fake provider for every model: answers by the role the request plays, recording each call. */
function fakeModels(answer: (model: string, role: Role, body: any) => Response) {
  const calls: { model: string; role: Role; body: any }[] = [];
  const fn = (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    const system = body.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
    const role: Role = system.includes("Split the user's message") ? 'planner' : system.includes('final writer') ? 'writer' : system.includes('Answer only this part') ? 'part' : 'draft';
    calls.push({ model: body.model, role, body });
    return answer(body.model, role, body);
  }) as typeof fetch;
  return { fn, calls };
}

async function runAgent(candidates: RouteCandidate[], messages: RunMessage[], fetchImpl: typeof fetch, options: { tools?: [] | ['calculator']; health?: RouterHealth } = {}) {
  const events: ProgressPayload[] = [];
  const executor = agentExecutor({ owner: 'u', candidates, request: { maxTokens: 512 }, messages, tools: options.tools ?? [], documents: [] }, { health: options.health ?? new RouterHealth(), fetchImpl, enqueue: task => task() });
  let result: Awaited<ReturnType<typeof executor>> | undefined;
  let thrown: unknown;
  try { result = await executor({ signal: new AbortController().signal, emit: e => events.push(e) }); } catch (e) { thrown = e; }
  const steps = events.filter((e): e is Extract<ProgressPayload, { type: 'agent' }> => e.type === 'agent');
  const final = (id: string) => [...steps].reverse().find(s => s.id === id) as AgentStep | undefined;
  return { result, thrown, events, steps, final, text: events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('') };
}

const three = () => [candidate('meta-llama/llama-3.3-70b-instruct:free'), candidate('qwen/qwen3-32b:free'), candidate('google/gemma-3-12b-it:free')];

describe('strategy', () => {
  it.each([
    ['Hi there!', false],
    ['What is 2 + 2?', false],
    ['What is the capital of France? And why did it become the capital?', true],
    ['Write a Python function to parse dates. Then write a short email announcing it to the team.', true],
    ['Please do these:\n1. Explain TCP vs UDP\n2. Give a haiku about networks', true],
    ['Summarize this:\n- apples\n- oranges', false],
    ['Fix this:\n```js\nconst a = 1\n```\nand explain it. Also write docs.', false],
  ])('%j is multi-part: %s', (text, expected) => {
    expect(looksMultiPart(text)).toBe(expected);
  });

  it('answers directly when simple, with tools on, or with one model; drafts for hard tasks; plans for several parts', () => {
    const profile = (text: string, tools: [] | ['calculator'] = []) => profileTask(user(text), tools);
    expect(chooseStrategy('Hi!', profile('Hi!'), 3).mode).toBe('direct');
    expect(chooseStrategy('Solve 12 * 7', profile('Solve 12 * 7', ['calculator']), 3).mode).toBe('direct');
    expect(chooseStrategy('Solve 12 * 7', profile('Solve 12 * 7'), 1).mode).toBe('direct');
    expect(chooseStrategy('Solve 12 * 7', profile('Solve 12 * 7'), 3).mode).toBe('ensemble');
    expect(chooseStrategy('Why is the sky blue?', profile('Why is the sky blue?'), 3).mode).toBe('ensemble');
    const multi = 'What is the capital of France? And why did it become the capital?';
    expect(chooseStrategy(multi, profile(multi), 3).mode).toBe('plan');
  });

  it('picks drafters from other model families than the writer and each other when it can', () => {
    expect(family('meta-llama/llama-3.3-70b')).toBe('meta-llama');
    expect(family('llama-3.1-8b-instant')).toBe('llama');
    const list = [candidate('meta-llama/llama-3.3-70b'), candidate('meta-llama/llama-3.1-8b'), candidate('qwen/qwen3-32b'), candidate('google/gemma-3-12b')];
    const ranked = rankCandidates(list, profileTask(user('Solve 2+2'), []), new RouterHealth(), 'u').ranked;
    const writer = ranked.find(r => r.candidate.model === 'meta-llama/llama-3.3-70b')!;
    expect(pickDrafters(ranked, writer, 2).map(r => r.candidate.model)).toEqual(['qwen/qwen3-32b', 'google/gemma-3-12b']);
    // With only one other family left, the same family fills the second place.
    const two = ranked.filter(r => !r.candidate.model.startsWith('google'));
    expect(pickDrafters(two, writer, 2).map(r => r.candidate.model)).toEqual(['qwen/qwen3-32b', 'meta-llama/llama-3.1-8b']);
  });

  it('reads the planner reply, tolerating text around the JSON', () => {
    expect(parsePlan('Sure! {"parts":[{"task":"Write code","kind":"code"},{"task":"Write an email","kind":"poetry"}]} Done.')).toEqual([
      { task: 'Write code', kind: 'code' }, { task: 'Write an email', kind: 'general' },
    ]);
    expect(parsePlan('{"parts":[{"task":"a"},{"task":"b"},{"task":"c"},{"task":"d"}]}')).toHaveLength(AGENT_LIMITS.parts);
    expect(parsePlan('no json here')).toBeUndefined();
    expect(parsePlan('{"parts": "nope"}')).toBeUndefined();
  });

  it('ranks specialists per kind with Bench results', () => {
    const list = [candidate('big-70b'), candidate('coder-8b')];
    const bench = benchIndex([{ connectionId: 'or', model: 'coder-8b', category: 'code', passed: 5, failed: 0, errors: 0, lastAt: 1 }]);
    const table = specialists(list, profileTask(user('hi'), []), new RouterHealth(), 'u', bench);
    expect(table.code[0].candidate.model).toBe('coder-8b');
    expect(table.general[0].candidate.model).toBe('big-70b');
  });
});

describe('Free Agent runs', () => {
  it('ensemble: two specialists draft, the strongest checks them and writes the answer', async () => {
    const { fn, calls } = fakeModels((model, role) => role === 'writer' ? ok('Final checked answer: 84.') : ok(`Draft from ${model} says 84`));
    const { result, text, final, steps } = await runAgent(three(), user('Solve 12 * 7'), fn);
    expect(text).toBe('Final checked answer: 84.');
    expect(final('strategy')).toMatchObject({ role: 'strategy', mode: 'ensemble' });
    expect(final('draft-1')).toMatchObject({ role: 'drafter', status: 'done', model: 'qwen/qwen3-32b:free', text: 'Draft from qwen/qwen3-32b:free says 84' });
    expect(final('draft-2')).toMatchObject({ role: 'drafter', status: 'done', model: 'google/gemma-3-12b-it:free' });
    expect(final('writer')).toMatchObject({ role: 'writer', status: 'done', model: 'meta-llama/llama-3.3-70b-instruct:free' });
    const writerCall = calls.find(c => c.role === 'writer')!;
    const note = writerCall.body.messages.find((m: any) => m.role === 'system').content as string;
    expect(note).toContain('Draft 1:\nDraft from qwen/qwen3-32b:free says 84');
    expect(note).toContain('Draft 2:\nDraft from google/gemma-3-12b-it:free says 84');
    expect(calls.filter(c => c.role === 'draft').map(c => c.body.max_tokens)).toEqual([AGENT_LIMITS.draftTokens, AGENT_LIMITS.draftTokens]);
    expect(result?.agent).toEqual({ mode: 'ensemble', task: 'math', calls: 3, writer: { connectionId: 'or', model: 'meta-llama/llama-3.3-70b-instruct:free' } });
    expect(result?.usage).toEqual({ prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 });
    // Drafts are shown as steps; only the final answer streams.
    expect(steps.every(s => s.role !== 'writer' || !s.text)).toBe(true);
  });

  it('keeps going when a drafter fails, and answers directly when every drafter fails', async () => {
    const one = fakeModels((model, role) => role === 'writer' ? ok('Final.') : model.startsWith('google') ? fail(503) : ok('Only draft.'));
    const partial = await runAgent(three(), user('Solve 12 * 7'), one.fn);
    expect(partial.final('draft-2')).toMatchObject({ status: 'failed' });
    const note = one.calls.find(c => c.role === 'writer')!.body.messages.find((m: any) => m.role === 'system').content as string;
    expect(note).toContain('Draft 1:\nOnly draft.');
    expect(note).not.toContain('Draft 2');

    // Without drafts the writer gets no note, so the fake tells it apart by model.
    const none = fakeModels(model => model.startsWith('meta') ? ok('Written alone.') : fail(503));
    const alone = await runAgent(three(), user('Solve 12 * 7'), none.fn);
    expect(alone.text).toBe('Written alone.');
    expect(alone.final('writer')).toMatchObject({ status: 'done', model: 'meta-llama/llama-3.3-70b-instruct:free' });
    expect(none.calls.at(-1)!.body.messages.some((m: any) => m.role === 'system')).toBe(false);
  });

  it('falls back to the next writer before any output, and shows a draft when no writer can answer', async () => {
    const next = fakeModels((model, role) => role === 'writer' && model.startsWith('meta') ? fail(429) : role === 'writer' ? ok('Second writer.') : ok('Draft.'));
    const fallback = await runAgent(three(), user('Solve 12 * 7'), next.fn);
    expect(fallback.text).toBe('Second writer.');
    expect(fallback.result?.agent?.writer.model).not.toContain('llama');

    const noWriter = fakeModels((model, role) => role === 'writer' ? fail(503) : ok(`Draft from ${model}.`));
    const drafted = await runAgent(three(), user('Solve 12 * 7'), noWriter.fn);
    expect(drafted.text).toBe('Draft from qwen/qwen3-32b:free.');
    expect(drafted.events).toContainEqual({ type: 'status', message: 'No model could write the final answer, so this is the draft from qwen/qwen3-32b:free.' });
    expect(drafted.result?.agent?.writer.model).toBe('qwen/qwen3-32b:free');
  });

  it('plan: splits a multi-part message, sends each part to its specialist, and combines them', async () => {
    const list = [candidate('meta-llama/llama-3.3-70b-instruct:free'), candidate('qwen/qwen3-coder:free'), candidate('google/gemma-3-12b-it:free')];
    const { fn, calls } = fakeModels((model, role, body) => {
      if (role === 'planner') return ok('{"parts":[{"task":"Write a Python function that parses ISO dates","kind":"code"},{"task":"Write a two-line email announcing the date parser","kind":"writing"}]}');
      if (role === 'part') return ok(`${model} answered: ${body.messages.at(-1).content}`);
      return ok('Here is the function, and the email.');
    });
    const message = 'Write a Python function to parse ISO dates. Then write a short email announcing it to the team.';
    const { result, final, text } = await runAgent(list, user(message), fn);
    expect(text).toBe('Here is the function, and the email.');
    expect(final('strategy')).toMatchObject({ mode: 'plan' });
    expect(final('planner')).toMatchObject({ status: 'done' });
    expect(final('part-1')).toMatchObject({ role: 'specialist', kind: 'code', model: 'qwen/qwen3-coder:free', task: 'Write a Python function that parses ISO dates' });
    expect(final('part-2')).toMatchObject({ role: 'specialist', kind: 'writing', status: 'done' });
    expect(final('part-2')?.model).not.toBe('qwen/qwen3-coder:free');
    const partCall = calls.find(c => c.role === 'part')!;
    expect(partCall.body.messages.at(-1)).toEqual({ role: 'user', content: expect.stringMatching(/^Write a/) });
    expect(JSON.stringify(partCall.body.messages)).toContain(message);
    const note = calls.find(c => c.role === 'writer')!.body.messages.find((m: any) => m.role === 'system').content as string;
    expect(note).toContain('Part 1: Write a Python function that parses ISO dates');
    expect(note).toContain('Part 2: Write a two-line email');
    expect(result?.agent).toMatchObject({ mode: 'plan', calls: 4 });
  });

  it('turns a plan into an ensemble when the planner finds one task or replies without JSON', async () => {
    const { fn, calls } = fakeModels((_model, role) => role === 'planner' ? ok('I think this is one question.') : role === 'writer' ? ok('Final.') : ok('Draft.'));
    const { final } = await runAgent(three(), user('What is the capital of France? And why did it become the capital?'), fn);
    expect(final('strategy')).toMatchObject({ mode: 'ensemble', reason: expect.stringContaining('planner found a single task') });
    expect(calls.map(c => c.role)).toEqual(['planner', 'draft', 'draft', 'writer']);
  });

  it(`never sends more than ${AGENT_LIMITS.calls} requests for one message`, async () => {
    const list = ['a-100b', 'b-90b', 'c-80b', 'd-70b', 'e-60b', 'f-50b', 'g-40b'].map(m => candidate(`vendor${m[0]}/${m}`));
    const { fn, calls } = fakeModels(() => fail(503));
    const { thrown } = await runAgent(list, user('Solve 12 * 7'), fn);
    expect(calls.length).toBeLessThanOrEqual(AGENT_LIMITS.calls);
    expect(thrown).toBeDefined();
  });

  it('answers simple messages with one request, and runs tools on one model', async () => {
    const { fn, calls } = fakeModels(() => ok('Hello!'));
    const { result, final } = await runAgent(three(), user('Hi!'), fn);
    expect(calls).toHaveLength(1);
    expect(final('strategy')).toMatchObject({ mode: 'direct' });
    expect(result?.agent).toMatchObject({ mode: 'direct', calls: 1 });

    const tools = fakeModels(() => ok('42'));
    await runAgent(three(), user('Solve 6 * 7'), tools.fn, { tools: ['calculator'] });
    expect(tools.calls).toHaveLength(1);
    expect(tools.calls[0].body.tools?.[0]?.function?.name).toBe('calculator');
  });

  it("assigns work only to models the Free Router can rank, never to OpenRouter's own router", async () => {
    const withMeta = [candidate('openrouter/free'), ...three()];
    const { fn, calls } = fakeModels((_model, role) => role === 'writer' ? ok('Final.') : ok('Draft.'));
    await runAgent(withMeta, user('Solve 12 * 7'), fn);
    expect(calls.map(c => c.model)).not.toContain('openrouter/free');

    // With one real model and openrouter/free, there is nothing to combine: the Free Router answers,
    // with openrouter/free as its last resort only.
    const lonely = fakeModels(model => model === 'openrouter/free' ? ok('From the provider router.') : fail(503));
    const { final, text } = await runAgent([candidate('openrouter/free'), candidate('solo-70b')], user('Solve 12 * 7'), lonely.fn);
    expect(final('strategy')).toMatchObject({ mode: 'direct' });
    expect(lonely.calls.map(c => c.model)).toEqual(['solo-70b', 'openrouter/free']);
    expect(text).toBe('From the provider router.');
  });

  it('accepts the agent strategy in a run request', () => {
    const run = validateRunRequest({
      idempotencyKey: 'agent-run-1', messages: user('Hi'),
      route: { strategy: 'agent', connections: [{ id: 'or', target: { kind: 'openrouter', apiKey: 'sk-or-test-key' } }], models: [{ connectionId: 'or', model: 'm' }] },
    });
    expect(run.route?.strategy).toBe('agent');
  });
});
