import { describe, expect, it } from 'vitest';
import { normalizePullEvent, validateOllamaRequest } from './models.js';

describe('Ollama model management', () => {
  it('accepts model tags only for a loopback Ollama target', () => {
    expect(validateOllamaRequest({ target: { kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }, model: 'registry.example/team/qwen3:8b' })).toMatchObject({ model: 'registry.example/team/qwen3:8b', target: { kind: 'ollama', execution: 'local' } });
    expect(() => validateOllamaRequest({ target: { kind: 'ollama', baseURL: 'https://remote.example' }, model: 'qwen3' })).toThrow('this machine');
    expect(() => validateOllamaRequest({ target: { kind: 'openai', apiKey: 'secret' }, model: 'qwen3' })).toThrow('only for Ollama');
    expect(() => validateOllamaRequest({ target: { kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }, model: '../bad model' })).toThrow('valid Ollama');
  });

  it('normalizes runtime progress and marks only success terminal', () => {
    expect(normalizePullEvent({ status: 'downloading', digest: 'sha256:x', total: 100, completed: 25 })).toEqual({ status: 'downloading', digest: 'sha256:x', total: 100, completed: 25, done: false });
    expect(normalizePullEvent({ status: 'success' })).toEqual({ status: 'success', done: true });
    expect(normalizePullEvent('bad')).toBeNull();
  });
});
