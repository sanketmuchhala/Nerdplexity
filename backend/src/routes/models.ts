import { Router } from 'express';
import { resolveTarget } from '../runtime/destinations.js';
import { readLines } from '../runtime/streams.js';

type FetchFn = typeof fetch;

export function validateOllamaRequest(body: any) {
  if (!body || typeof body !== 'object') throw new Error('Request body is required.');
  const target = resolveTarget(body.target);
  if (target.kind !== 'ollama') throw new Error('Model installation is available only for Ollama connections.');
  if (typeof body.model !== 'string' || !/^[A-Za-z0-9._:/-]{1,200}$/.test(body.model)) throw new Error('Enter a valid Ollama model name.');
  return { target, model: body.model };
}

export function normalizePullEvent(event: any) {
  if (!event || typeof event !== 'object') return null;
  return {
    status: typeof event.status === 'string' ? event.status.slice(0, 200) : 'Working',
    ...(Number.isFinite(event.total) ? { total: event.total } : {}),
    ...(Number.isFinite(event.completed) ? { completed: event.completed } : {}),
    ...(typeof event.digest === 'string' ? { digest: event.digest.slice(0, 100) } : {}),
    done: event.status === 'success',
    ...(typeof event.error === 'string' ? { error: event.error.slice(0, 300) } : {}),
  };
}

export function modelsRouter(fetchImpl: FetchFn = fetch): Router {
  const router = Router();

  router.post('/ollama/pull', async (req, res) => {
    try {
      const { target, model } = validateOllamaRequest(req.body);
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const upstream = await fetchImpl(`${target.baseURL}/api/pull`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!upstream.ok || !upstream.body) {
        const detail = (await upstream.text().catch(() => '')).slice(0, 300);
        res.status(upstream.ok ? 502 : upstream.status).json({ error: detail || `Ollama returned ${upstream.status}.` });
        return;
      }
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      for await (const line of readLines(upstream.body)) {
        let event: any;
        try { event = JSON.parse(line); }
        catch { throw new Error('Ollama sent malformed progress data.'); }
        const normalized = normalizePullEvent(event);
        if (!normalized) continue;
        res.write(`${JSON.stringify(normalized)}\n`);
      }
      if (!res.writableEnded) res.end();
    } catch (error) {
      if (res.headersSent && !res.writableEnded && !res.destroyed) {
        res.write(`${JSON.stringify({ status: 'failed', done: true, error: (error as Error).message.slice(0, 300) })}\n`);
        res.end();
      } else if (!res.headersSent) res.status(400).json({ error: (error as Error).message });
    }
  });

  router.delete('/ollama', async (req, res) => {
    try {
      const { target, model } = validateOllamaRequest(req.body);
      const upstream = await fetchImpl(`${target.baseURL}/api/delete`, {
        method: 'DELETE', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
      });
      if (!upstream.ok) {
        const detail = (await upstream.text().catch(() => '')).slice(0, 300);
        res.status(upstream.status).json({ error: detail || `Ollama returned ${upstream.status}.` });
        return;
      }
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  return router;
}
