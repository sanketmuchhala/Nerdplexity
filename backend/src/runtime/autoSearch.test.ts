import { describe, expect, it } from 'vitest';
import type { RunEnvelope, RunMessage } from '@app/types';
import { AUTO_SEARCH_ID, webSearchQuery, withWebResults } from './autoSearch.js';
import type { ProgressPayload } from './runs.js';
import { RunRegistry } from './runs.js';
import { resolveTarget } from './destinations.js';
import { routedExecutor, RouterHealth } from './router.js';
import express from 'express';
import type { AddressInfo } from 'net';
import { runsRouter, validateRunRequest } from '../routes/runs.js';

const user = (content: string): RunMessage[] => [{ role: 'user', content }];
const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
const exaResults = { results: [{ title: 'Release notes', url: 'https://example.com/notes', publishedDate: '2026-09-10', highlights: ['Version 3 shipped.'] }] };

/** Exa and model servers in one fake: records what each received. */
function fakeServices(options: { exa?: () => Response; model?: (body: any) => Response } = {}) {
  const exa: any[] = [];
  const models: any[] = [];
  const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    if (String(url).includes('api.exa.ai')) {
      exa.push({ body, key: (init.headers as Record<string, string>)['x-api-key'] });
      return options.exa?.() ?? new Response(JSON.stringify(exaResults), { headers: { 'content-type': 'application/json' } });
    }
    models.push(body);
    return options.model?.(body) ?? new Response(sse('Answer.'), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fn, exa, models };
}

describe('when to search', () => {
  it.each([
    ['What is the latest version of Node.js?', true],
    ['Any news about the Mars mission?', true],
    ['What is the price of bitcoin right now?', true],
    ['Weather in Paris tomorrow', true],
    ['Who won the 2026 World Cup?', true],
    ['Summarize https://example.com/post', true],
    ['Search the web for good hiking boots', true],
    ['Can you look this up: tallest building', true],
    ['Hi!', false],
    ['Explain recursion simply', false],
    ['Implement binary search in Python', false],
    ['How does Google Gemini work?', false],
    ['Update this function:\n```js\nconst latest = items.at(-1)\n```', false],
    ['Search the web for docs on this:\n```js\nfetch(url)\n```', true],
  ])('%s -> %s', (text, expected) => {
    expect(webSearchQuery(user(text)) !== undefined).toBe(expected);
  });

  it('uses only the latest user message, shortened at a word boundary', () => {
    expect(webSearchQuery([...user('What is the latest iPhone?'), { role: 'assistant', content: 'The 18.' }, ...user('Thanks!')])).toBeUndefined();
    const long = `Latest news on ${'renewable energy policy '.repeat(30)}`;
    const query = webSearchQuery(user(long))!;
    expect(query.length).toBeLessThanOrEqual(300);
    expect(long.startsWith(query)).toBe(true);
    expect(query.endsWith(' ')).toBe(false);
  });
});

describe('searching before the model answers', () => {
  const run = async (messages: RunMessage[], fetchImpl: typeof fetch) => {
    const events: ProgressPayload[] = [];
    const result = await withWebResults(messages, 'exa-key-000001', new AbortController().signal, e => events.push(e), fetchImpl);
    return { result, events };
  };

  it('adds the results after the leading system messages and shows the search', async () => {
    const { fn, exa } = fakeServices();
    const messages: RunMessage[] = [{ role: 'system', content: 'Be brief.' }, ...user('What is the latest version of Widget?')];
    const { result, events } = await run(messages, fn);
    expect(exa).toEqual([{ key: 'exa-key-000001', body: expect.objectContaining({ query: 'What is the latest version of Widget?', numResults: 5 }) }]);
    expect(result.map(m => m.role)).toEqual(['system', 'system', 'user']);
    expect(result[1].content).toContain('untrusted pages');
    expect(result[1].content).toContain('https://example.com/notes');
    expect(events.map(e => e.type === 'tool' && [e.id, e.name, e.step, e.status, e.source])).toEqual([
      [AUTO_SEARCH_ID, 'web_search', 0, 'running', 'web'], [AUTO_SEARCH_ID, 'web_search', 0, 'completed', 'web'],
    ]);
  });

  it('does nothing when the message does not need the web', async () => {
    const { fn, exa } = fakeServices();
    const messages = user('Tell me a joke.');
    const { result, events } = await run(messages, fn);
    expect(result).toBe(messages);
    expect(exa).toEqual([]);
    expect(events).toEqual([]);
  });

  it('shows a failed search and lets the model answer without it', async () => {
    const { fn } = fakeServices({ exa: () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }) });
    const messages = user('Any news today?');
    const { result, events } = await run(messages, fn);
    expect(result).toBe(messages);
    expect(events.at(-1)).toMatchObject({ type: 'tool', status: 'error', error: 'Exa rejected the API key. Check it in Connections.' });
  });
});

describe('automatic search in runs', () => {
  it('accepts automatic search without the web tool, and still needs a key', () => {
    const base = { idempotencyKey: 'auto-search-1', target: { kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' }, model: 'm', messages: user('Hi') };
    expect(validateRunRequest({ ...base, search: { provider: 'exa', apiKey: 'exa-key-000001', auto: true } }).search).toEqual({ apiKey: 'exa-key-000001', auto: true });
    expect(() => validateRunRequest({ ...base, search: { provider: 'exa', auto: true } })).toThrow(/Exa API key/);
    expect(validateRunRequest(base).search).toBeUndefined();
  });

  it('sends the results to the model in a single-model run, never the key', async () => {
    const { fn, models } = fakeServices();
    const app = express();
    app.use(express.json());
    app.use('/v1/runs', runsRouter(new RunRegistry(), fn));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runs`;
      const started = await (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        idempotencyKey: 'auto-search-2', target: { kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' }, model: 'm',
        messages: user('What is the latest version of Widget?'), search: { provider: 'exa', apiKey: 'exa-key-000001', auto: true },
      }) })).json();
      const lines = (await (await fetch(`${base}/${started.runId}/events?after=0`)).text()).trim().split('\n').map(line => JSON.parse(line) as RunEnvelope);
      expect(lines.map(e => e.event.type)).toEqual(['queued', 'started', 'tool', 'tool', 'delta', 'completed']);
      expect(models[0].messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('https://example.com/notes') });
      expect(JSON.stringify(models)).not.toContain('exa-key-000001');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('searches once for a routed run, and every attempt gets the results', async () => {
    let calls = 0;
    const { fn, exa, models } = fakeServices({
      model: () => ++calls === 1
        ? new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503, headers: { 'content-type': 'application/json' } })
        : new Response(sse('Answer.'), { headers: { 'content-type': 'text/event-stream' } }),
    });
    const target = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-key' });
    const candidate = (model: string) => ({ connectionId: 'or', model, target, capabilities: { tools: true, vision: false }, contextLength: 131072 });
    const executor = routedExecutor({
      owner: 'u', candidates: [candidate('big-70b'), candidate('small-8b')], request: {}, messages: user('Any news about Widget today?'),
      tools: [], documents: [], search: { apiKey: 'exa-key-000001', auto: true },
    }, { health: new RouterHealth(), fetchImpl: fn, enqueue: task => task() });
    const events: ProgressPayload[] = [];
    const result = await executor({ signal: new AbortController().signal, emit: e => events.push(e) });
    expect(exa).toHaveLength(1);
    expect(models).toHaveLength(2);
    for (const body of models) expect(JSON.stringify(body.messages)).toContain('https://example.com/notes');
    expect(result.route).toMatchObject({ model: 'small-8b', attempts: 2 });
    expect(events.findIndex(e => e.type === 'tool')).toBeLessThan(events.findIndex(e => e.type === 'route'));
  });
});
