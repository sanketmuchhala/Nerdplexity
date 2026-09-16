import { describe, expect, it, vi } from 'vitest';
import { resolveTarget } from './destinations.js';
import { inspectModel, verifyFreeModel } from './modelPolicy.js';

const signal = () => new AbortController().signal;
const target = () => resolveTarget({ kind: 'openrouter', apiKey: 'test-only-key' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const fetchCatalog = (models: unknown[]) => vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/key')) return json({ data: {} });
  if (url.pathname.endsWith('/models')) return json({ data: models });
  throw new Error('Policy must never send a generation request.');
}) as unknown as typeof fetch;

describe('free model dispatch policy', () => {
  it('allows local execution without contacting discovery', async () => {
    const fn = vi.fn() as unknown as typeof fetch;
    expect(await verifyFreeModel(resolveTarget({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }), 'local', signal(), fn)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('uses OpenRouter generation-time price enforcement without a racy catalog lookup', async () => {
    const fn = vi.fn() as unknown as typeof fetch;
    expect(await verifyFreeModel(target(), 'vendor/model', signal(), fn)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns current metadata for automatic output budgeting on explicitly paid runs', async () => {
    const fn = fetchCatalog([{ id: 'vendor/model', context_length: 64000, top_provider: { max_completion_tokens: 16000 }, pricing: { prompt: '0.001', completion: '0.002' } }]);
    await expect(inspectModel(target(), 'vendor/model', signal(), fn)).resolves.toMatchObject({ contextLength: 64000, maxOutputTokens: 16000, pricing: 'paid' });
  });

  it('fails closed when a remote provider without a generation-time price ceiling cannot be checked', async () => {
    const remote = resolveTarget({ kind: 'openai-compatible', baseURL: 'https://api.example.com/v1' });
    const fn = (async () => json({ error: 'unavailable' }, 503)) as typeof fetch;
    await expect(verifyFreeModel(remote, 'free', signal(), fn)).rejects.toThrow('Cannot verify current pricing');
    await expect(inspectModel(remote, 'paid', signal(), fn)).resolves.toBeUndefined();
  });

  it('blocks remote compatible models whose provider does not report a price', async () => {
    const remote = resolveTarget({ kind: 'openai-compatible', baseURL: 'https://api.example.com/v1' });
    await expect(verifyFreeModel(remote, 'haiku', signal(), fetchCatalog([{ id: 'haiku' }]))).rejects.toThrow('not verified as free');
    await expect(verifyFreeModel(remote, 'zero', signal(), fetchCatalog([{ id: 'zero', pricing: { prompt: '0', completion: '0' } }]))).resolves.toMatchObject({ pricing: 'zero-price' });
  });

  it('honors cancellation before discovery and passes it to pending requests', async () => {
    const controller = new AbortController();
    const remote = resolveTarget({ kind: 'openai-compatible', baseURL: 'https://api.example.com/v1' });
    const fn = vi.fn(async (_input, init) => {
      controller.abort(new Error('Stopped by user'));
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    }) as unknown as typeof fetch;
    await expect(verifyFreeModel(remote, 'free', controller.signal, fn)).rejects.toThrow('Stopped by user');
    await expect(verifyFreeModel(remote, 'free', controller.signal, fn)).rejects.toThrow('Stopped by user');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
