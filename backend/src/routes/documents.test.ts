import { describe, expect, it } from 'vitest';
import { validateRunRequest } from './runs.js';

describe('document run limits', () => {
  const request = { idempotencyKey: 'documents-test-001', target: { kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }, model: 'test', messages: [{ role: 'user', content: 'Read the report' }], tools: ['read_document'] };
  it('accepts extracted documents larger than the former 100 KB limit', () => {
    const documents = [{ id: 'report', title: 'report.pdf', content: 'x'.repeat(1_500_000) }];
    expect(validateRunRequest({ ...request, documents }).documents).toEqual(documents);
  });
  it('bounds individual documents and the whole workspace', () => {
    const document = { id: 'report', title: 'report.pdf', content: 'x'.repeat(2_000_001) };
    expect(() => validateRunRequest({ ...request, documents: [document] })).toThrow('2 MB');
    expect(() => validateRunRequest({ ...request, documents: Array.from({ length: 3 }, (_, id) => ({ ...document, id: String(id), content: 'x'.repeat(1_500_000) })) })).toThrow('4 MB');
  });
});
