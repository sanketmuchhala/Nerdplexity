import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { errorHandler } from './errors.js';

describe('errorHandler', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects malformed JSON with 400 and never logs the request body', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); });
    const app = express();
    app.use(express.json());
    app.post('/v1/runs', (_req, res) => { res.json({ ok: true }); });
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runs`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"target":{"apiKey":"sk-LEAK-CHECK-123"',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'The request body is not valid JSON.' });
      expect(logged.join('\n')).toContain('entity.parse.failed');
      expect(logged.join('\n')).not.toContain('sk-LEAK-CHECK-123');
    } finally {
      server.close();
    }
  });
});
