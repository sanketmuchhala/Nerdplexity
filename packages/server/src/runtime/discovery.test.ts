import { describe, expect, it } from 'vitest';
import type { DiscoveryResult } from '@app/types';
import { discover } from './discovery.js';

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake fetch that records requests and dispatches by path. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url: url.href, init });
    const route = routes[url.pathname];
    if (!route) return json({ error: 'no route' }, 404);
    return route(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const failure = (result: DiscoveryResult) => {
  if (result.ok) throw new Error('expected failure');
  return result.error;
};
const models = (result: DiscoveryResult) => {
  if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
  return result.models;
};

describe('discover: Ollama', () => {
  it('normalizes installed models with capabilities, context, and loaded state', async () => {
    const { fn } = fakeFetch({
      '/api/tags': () => json({ models: [
        { name: 'qwen3:8b', size: 5_200_000_000, details: { parameter_size: '8.2B', quantization_level: 'Q4_K_M', family: 'qwen3' } },
        { name: 'llava:7b', size: 4_700_000_000, details: {} },
      ] }),
      '/api/ps': () => json({ models: [{ name: 'qwen3:8b' }] }),
      '/api/show': (_url, init) => {
        const { model } = JSON.parse(String(init.body));
        return model === 'qwen3:8b'
          ? json({ capabilities: ['completion', 'tools'], model_info: { 'qwen3.context_length': 40960 } })
          : json({ error: 'not found' }, 500);
      },
    });
    const result = await discover({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }, fn);
    expect(result.ok && result.execution).toBe('local');
    expect(result.ok && result.host?.cpus).toBeGreaterThan(0);
    const [llava, qwen] = models(result);
    expect(qwen).toMatchObject({
      id: 'qwen3:8b', details: '8.2B · Q4_K_M · qwen3', sizeBytes: 5_200_000_000, contextLength: 40960,
      loaded: true, pricing: 'local', capabilities: { tools: true, vision: false },
    });
    // A failed detail lookup leaves capabilities unknown instead of false.
    expect(llava).toMatchObject({ id: 'llava:7b', loaded: false, capabilities: { tools: null, vision: null } });
  });

  it('reports a stopped runtime as offline', async () => {
    const fn = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const error = failure(await discover({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }, fn));
    expect(error).toMatchObject({ category: 'offline', message: expect.stringContaining('Start the runtime') });
  });

  it('distinguishes an empty catalog from a failure', async () => {
    const { fn } = fakeFetch({ '/api/tags': () => json({ models: [] }), '/api/ps': () => json({ models: [] }) });
    expect(models(await discover({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }, fn))).toEqual([]);
  });
});

describe('discover: OpenAI-compatible and hosted providers', () => {
  it('maps auth, missing endpoint, and non-JSON responses to distinct categories', async () => {
    const target = { kind: 'openai-compatible', baseURL: 'https://api.example.com/v1', apiKey: 'sk-live-abcdef123' };
    expect(failure(await discover(target, fakeFetch({ '/v1/models': () => json({}, 401) }).fn)).category).toBe('auth');
    expect(failure(await discover(target, fakeFetch({}).fn)).category).toBe('not-found');
    expect(failure(await discover(target, fakeFetch({ '/v1/models': () => new Response('<html>') }).fn)).category).toBe('invalid-response');
    expect(failure(await discover(target, fakeFetch({ '/v1/models': () => json({}, 429) }).fn)).category).toBe('rate-limited');
  });

  it('never returns the key inside an error message', async () => {
    const target = { kind: 'openai-compatible', baseURL: 'https://api.example.com/v1', apiKey: 'sk-live-abcdef123' };
    const { fn } = fakeFetch({ '/v1/models': () => new Response('upstream saw key sk-live-abcdef123', { status: 500 }) });
    const error = failure(await discover(target, fn));
    expect(error.message).not.toContain('sk-live-abcdef123');
    expect(error.message).toContain('[redacted]');
  });

  it('sends the bearer key and keeps compatible context metadata', async () => {
    const { fn, calls } = fakeFetch({ '/api/v1/models': () => json({ data: [{ id: 'z-model', context_length: 131072 }, { id: 'a-model' }] }) });
    const result = await discover({ kind: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'or-key' }, fn);
    expect(models(result).map(m => [m.id, m.contextLength, m.pricing])).toEqual([['a-model', undefined, 'unknown'], ['z-model', 131072, 'unknown']]);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer or-key');
  });

  it('filters OpenAI models that cannot serve chat', async () => {
    const { fn } = fakeFetch({ '/v1/models': () => json({ data: ['gpt-5', 'text-embedding-3-small', 'whisper-1', 'tts-1', 'dall-e-3', 'o4-mini'].map(id => ({ id })) }) });
    expect(models(await discover({ kind: 'openai', apiKey: 'sk-x' }, fn)).map(m => m.id)).toEqual(['gpt-5', 'o4-mini']);
  });

  it('lists Gemini generateContent models with the key in a header, not the URL', async () => {
    const { fn, calls } = fakeFetch({
      '/v1beta/models': () => json({ models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576, outputTokenLimit: 65536 },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ] }),
    });
    const [model, ...rest] = models(await discover({ kind: 'gemini', apiKey: 'AIza-secret' }, fn));
    expect(rest).toEqual([]);
    expect(model).toMatchObject({ id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextLength: 1048576, maxOutputTokens: 65536 });
    expect(calls[0].url).not.toContain('AIza-secret');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-secret');
  });

  it('lists Anthropic models through the SDK and maps its typed auth error', async () => {
    const page = { data: [{ type: 'model', id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-01-01', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { image_input: { supported: true } } }], has_more: false, first_id: 'claude-opus-5', last_id: 'claude-opus-5' };
    const ok = fakeFetch({ '/v1/models': (_url, init) => {
      expect(new Headers(init.headers).get('x-api-key')).toBe('sk-ant-good');
      return json(page);
    } });
    expect(models(await discover({ kind: 'anthropic', apiKey: 'sk-ant-good' }, ok.fn))[0]).toMatchObject({
      id: 'claude-opus-5', displayName: 'Claude Opus 5', contextLength: 1000000, maxOutputTokens: 128000, capabilities: { tools: null, vision: true },
    });
    const denied = fakeFetch({ '/v1/models': () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401) });
    expect(failure(await discover({ kind: 'anthropic', apiKey: 'sk-ant-bad' }, denied.fn)).category).toBe('auth');
  });

  it('reports policy violations without making a request', async () => {
    const { fn, calls } = fakeFetch({});
    expect(failure(await discover({ kind: 'openai-compatible', baseURL: 'http://api.example.com/v1' }, fn)).category).toBe('invalid-destination');
    expect(calls).toEqual([]);
  });
});
