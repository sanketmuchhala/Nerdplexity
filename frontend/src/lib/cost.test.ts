import { describe, expect, it } from 'vitest';
import type { Connection, DiscoveryResult, ModelDescriptor } from '@app/types';
import { costStatus, freeAlternatives } from './cost';

const connection = (over: Partial<Connection> = {}): Connection => ({ id: 'c', kind: 'openrouter', name: 'OpenRouter', keyStorage: 'session', enabled: true, createdAt: 0, updatedAt: 0, ...over });
const model = (id: string, over: Partial<ModelDescriptor> = {}): ModelDescriptor => ({ id, displayName: id, capabilities: { tools: null, vision: null }, pricing: 'unknown', source: 'discovered', ...over });

describe('costStatus', () => {
  it('treats local runtimes and verified $0 models as free', () => {
    expect(costStatus(connection({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }), undefined)).toMatchObject({ cls: 'local', free: true });
    expect(costStatus(connection(), model('m:free', { pricing: 'zero-price' }))).toMatchObject({ cls: 'zero-price', free: true });
  });

  it('never treats unknown pricing as free', () => {
    expect(costStatus(connection(), model('m'))).toMatchObject({ cls: 'unknown', free: false });
    expect(costStatus(connection(), undefined)).toMatchObject({ cls: 'unknown', free: false });
    expect(costStatus(undefined, model('m', { pricing: 'zero-price' }))).toMatchObject({ free: false });
    // A remote compatible endpoint is not local just because it is compatible.
    expect(costStatus(connection({ kind: 'openai-compatible', baseURL: 'https://api.example.com/v1' }), model('m'))).toMatchObject({ free: false });
  });

  it('shows catalog prices for paid models', () => {
    const status = costStatus(connection(), model('big', { pricing: 'paid', price: { input: 3, output: 15 } }));
    expect(status).toMatchObject({ cls: 'paid', free: false, label: '$3 in / $15 out per M tokens' });
    expect(costStatus(connection(), model('tiny', { pricing: 'paid', price: { input: 0.005, output: 0.1 } })).label).toBe('<$0.01 in / $0.1 out per M tokens');
  });

  it('does not treat a user’s billing statement as proof of free usage', () => {
    expect(costStatus(connection({ kind: 'gemini', name: 'Gemini', billing: 'no-billing' }), model('gemini-2.5-flash'))).toMatchObject({ cls: 'unknown', free: false });
    expect(costStatus(connection({ kind: 'groq', name: 'Groq', billing: 'paid' }), model('llama'))).toMatchObject({ cls: 'paid', free: false });
    for (const kind of ['openai', 'anthropic', 'sambanova', 'huggingface', 'openai-compatible'] as const) {
      const account = connection({ kind, billing: 'no-billing', baseURL: 'https://openrouter.ai/api/v1' });
      expect(costStatus(account, model('paid', { pricing: 'paid', price: { input: 1, output: 2 } })).free, kind).toBe(false);
      expect(costStatus(account, model('unknown')).free, kind).toBe(false);
      expect(costStatus(account, model('free', { pricing: 'zero-price' })).free, kind).toBe(true);
    }
  });

  it('requires verified zero pricing on OpenRouter even when the account has no billing', () => {
    const account = connection({ billing: 'no-billing' });
    expect(costStatus(account, model('paid', { pricing: 'paid' })).free).toBe(false);
    expect(costStatus(account, model('unknown')).free).toBe(false);
    expect(costStatus(account, model('free', { pricing: 'zero-price' })).free).toBe(true);
  });

  it('uses the discovered execution location when known', () => {
    expect(costStatus(connection({ kind: 'openai-compatible', baseURL: 'http://host.docker.internal:1234/v1' }), model('m'), 'remote')).toMatchObject({ free: false });
  });
});

describe('freeAlternatives', () => {
  const remote = connection({ id: 'or' });
  const local = connection({ id: 'ollama', kind: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434' });
  const catalogs: Record<string, DiscoveryResult> = {
    or: { ok: true, execution: 'remote', checkedAt: 0, models: [model('a:free', { pricing: 'zero-price' }), model('paid', { pricing: 'paid' }), model('b:free', { pricing: 'zero-price' }), model('openrouter/free', { pricing: 'zero-price' })] },
    ollama: { ok: true, execution: 'local', checkedAt: 0, models: [model('llama3')] },
  };

  it("suggests only free models, prioritizing OpenRouter's free router without switching automatically", () => {
    expect(freeAlternatives([local, remote], catalogs, { connectionId: 'or', modelId: 'a:free' })).toEqual([
      { connectionId: 'or', modelId: 'openrouter/free' },
      { connectionId: 'or', modelId: 'b:free' },
      { connectionId: 'ollama', modelId: 'llama3' },
    ]);
  });

  it('respects the limit and skips failed catalogs', () => {
    expect(freeAlternatives([remote, local], { ...catalogs, ollama: { ok: false, checkedAt: 0, error: { category: 'offline', message: '' } } }, { connectionId: 'x', modelId: 'y' }, 1)).toEqual([{ connectionId: 'or', modelId: 'openrouter/free' }]);
  });
});
