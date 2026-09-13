import { describe, expect, it } from 'vitest';
import { allowedOrigins, originAllowed } from './origins.js';

describe('allowed origins', () => {
  it('parses exact origins and ignores malformed or partial entries', () => {
    expect([...allowedOrigins(' https://nerdplexity.vercel.app/ , https://app.example.com, not-a-url, https://x.example.com/path, ftp://files.example.com')])
      .toEqual(['https://nerdplexity.vercel.app', 'https://app.example.com']);
    expect(allowedOrigins('').size).toBe(0);
  });

  it('always allows this machine, and other sites only when listed', () => {
    const extra = allowedOrigins('https://nerdplexity.vercel.app');
    expect(originAllowed('http://localhost:5173', extra)).toBe(true);
    expect(originAllowed('http://127.0.0.1:5373', extra)).toBe(true);
    expect(originAllowed('https://nerdplexity.vercel.app', extra)).toBe(true);
    expect(originAllowed('https://evil.example', extra)).toBe(false);
    expect(originAllowed('https://nerdplexity.vercel.app.evil.example', extra)).toBe(false);
    expect(originAllowed('http://nerdplexity.vercel.app', extra)).toBe(false);
    expect(originAllowed('null', extra)).toBe(false);
  });
});
