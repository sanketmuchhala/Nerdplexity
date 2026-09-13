import { describe, expect, it } from 'vitest';
import { DestinationError, redact, resolveTarget } from './destinations.js';

describe('resolveTarget', () => {
  it('pins hosted providers to their own endpoint regardless of the supplied URL', () => {
    const target = resolveTarget({ kind: 'openai', baseURL: 'https://attacker.example/v1', apiKey: 'sk-test-123456' });
    expect(target.baseURL).toBe('https://api.openai.com/v1');
    expect(target.execution).toBe('remote');
    expect(target.headers).toEqual({ Authorization: 'Bearer sk-test-123456' });
  });

  it('pins OpenRouter and Groq to their official endpoints', () => {
    expect(resolveTarget({ kind: 'openrouter', baseURL: 'https://evil.example/v1', apiKey: 'or' }).baseURL).toBe('https://openrouter.ai/api/v1');
    expect(resolveTarget({ kind: 'groq', apiKey: 'gsk' })).toMatchObject({ baseURL: 'https://api.groq.com/openai/v1', headers: { Authorization: 'Bearer gsk' } });
  });

  it('requires a key for hosted providers', () => {
    expect(() => resolveTarget({ kind: 'anthropic', apiKey: '  ' })).toThrow(DestinationError);
  });

  it('sends Gemini keys as a header and leaves Anthropic auth to its SDK', () => {
    expect(resolveTarget({ kind: 'gemini', apiKey: 'AIza-key' }).headers).toEqual({ 'x-goog-api-key': 'AIza-key' });
    expect(resolveTarget({ kind: 'anthropic', apiKey: 'sk-ant-key' }).headers).toEqual({});
  });

  it('keeps Ollama on this machine', () => {
    expect(resolveTarget({ kind: 'ollama', baseURL: 'http://localhost:11434/' })).toMatchObject({ baseURL: 'http://localhost:11434', execution: 'local' });
    expect(() => resolveTarget({ kind: 'ollama', baseURL: 'https://ollama.example.com' })).toThrow(/this machine/);
    expect(() => resolveTarget({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434/api' })).toThrow(/without \/api/);
  });

  it('accepts compatible endpoints with provider-specific paths', () => {
    expect(resolveTarget({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234' })).toMatchObject({ baseURL: 'http://127.0.0.1:1234/v1', execution: 'local' });
    expect(resolveTarget({ kind: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1/', apiKey: 'or-key' })).toMatchObject({
      baseURL: 'https://openrouter.ai/api/v1', execution: 'remote', headers: { Authorization: 'Bearer or-key' },
    });
  });

  it('requires https for anything that is not this machine', () => {
    expect(() => resolveTarget({ kind: 'openai-compatible', baseURL: 'http://api.example.com/v1' })).toThrow(/https/);
    expect(() => resolveTarget({ kind: 'openai-compatible', baseURL: 'ftp://127.0.0.1/v1' })).toThrow(DestinationError);
  });

  it('rejects credentials, queries, and fragments in the URL', () => {
    for (const baseURL of ['https://user:pass@api.example.com/v1', 'https://api.example.com/v1?key=secret', 'https://api.example.com/v1#frag']) {
      expect(() => resolveTarget({ kind: 'openai-compatible', baseURL })).toThrow(/credentials, query strings/);
    }
  });

  it('rejects unknown kinds and malformed input', () => {
    expect(() => resolveTarget({ kind: 'auto' })).toThrow(/Unknown connection type/);
    expect(() => resolveTarget(null)).toThrow(DestinationError);
    expect(() => resolveTarget({ kind: 'openai-compatible', baseURL: 'not a url' })).toThrow(/full URL/);
  });
});

describe('redact', () => {
  it('removes every occurrence of the key', () => {
    expect(redact('bad key sk-1234 (sk-1234)', 'sk-1234')).toBe('bad key [redacted] ([redacted])');
    expect(redact('unchanged', undefined)).toBe('unchanged');
  });
});

describe('hosted mode', () => {
  const withHosted = (fn: () => void) => {
    const previous = process.env.NERDPLEXITY_HOSTED;
    process.env.NERDPLEXITY_HOSTED = '1';
    try { fn(); } finally { if (previous === undefined) delete process.env.NERDPLEXITY_HOSTED; else process.env.NERDPLEXITY_HOSTED = previous; }
  };

  it('refuses this-machine and private-network targets, including encoded addresses', () => withHosted(() => {
    for (const baseURL of ['http://127.0.0.1:11434', 'http://localhost:1234/v1', 'https://10.0.0.5/v1', 'https://192.168.1.20/v1', 'https://172.16.0.1/v1',
      'https://169.254.169.254/v1', 'https://[::1]/v1', 'https://[fd00::1]/v1', 'https://2130706433/v1', 'https://printer.local/v1', 'https://metadata.google.internal/v1']) {
      expect(() => resolveTarget({ kind: 'openai-compatible', baseURL }), baseURL).toThrow('hosted');
    }
    expect(() => resolveTarget({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' })).toThrow('hosted');
  }));

  it('still allows hosted providers and public https endpoints', () => withHosted(() => {
    expect(resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-1' }).baseURL).toBe('https://openrouter.ai/api/v1');
    expect(resolveTarget({ kind: 'openai-compatible', baseURL: 'https://api.example.com/v1' }).execution).toBe('remote');
  }));

  it('is off unless NERDPLEXITY_HOSTED is set', () => {
    expect(resolveTarget({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }).execution).toBe('local');
  });
});
