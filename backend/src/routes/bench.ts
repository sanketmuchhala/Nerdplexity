import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { BenchCategory, BenchSuiteInfo } from '@app/types';
import type { Database } from '../db/client.js';
import type { RunRegistry } from '../runtime/runs.js';
import { benchExecutor } from '../bench/runner.js';
import { loadSuite, selectItems, suiteGeneratedAt } from '../bench/suite.js';
import { benchScores, clearBenchResults, recentBenchResults, saveBenchResult } from '../store/bench.js';
import { resolveConnections } from './runs.js';

type FetchFn = typeof fetch;

export const BENCH_CATEGORIES: readonly BenchCategory[] = ['code', 'math', 'instructions', 'tools', 'facts'];
const MAX_MODELS = 30;
/** A Bench job may run longer than a chat run: small free limits space requests out. */
const JOB_TIMEOUT_MS = 3 * 60 * 60_000;

const handle = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

export function validateBenchRequest(body: any) {
  if (!body || typeof body !== 'object') throw new Error('Request body is required.');
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey)) throw new Error('A valid idempotency key is required.');
  const connections = resolveConnections(body.connections);
  const models = body.models;
  if (!Array.isArray(models) || !models.length || models.length > MAX_MODELS) throw new Error(`Choose 1–${MAX_MODELS} models.`);
  const seen = new Set<string>();
  for (const entry of models) {
    if (!entry || !connections.has(entry.connectionId) || typeof entry.model !== 'string' || !entry.model.trim() || entry.model.length > 200) throw new Error('Each model must name one of the connections.');
    const key = `${entry.connectionId}\n${entry.model}`;
    if (seen.has(key)) throw new Error(`${entry.model} is listed twice.`);
    seen.add(key);
  }
  const categories = body.categories;
  if (!Array.isArray(categories) || !categories.length || categories.some((c: unknown) => !BENCH_CATEGORIES.includes(c as BenchCategory)) || new Set(categories).size !== categories.length) {
    throw new Error(`Choose categories from: ${BENCH_CATEGORIES.join(', ')}.`);
  }
  if (!Number.isInteger(body.perCategory) || body.perCategory < 1 || body.perCategory > 20) throw new Error('Choose 1–20 items per category.');
  // Only the connections a model uses are contacted.
  const used = new Map([...connections].filter(([id]) => models.some((m: any) => m.connectionId === id)));
  return {
    key: body.idempotencyKey as string,
    job: { connections: used, models: models.map((m: any) => ({ connectionId: m.connectionId, model: m.model })), items: selectItems(categories, body.perCategory) },
  };
}

export function benchRouter(registry: RunRegistry, db: Database, fetchImpl: FetchFn = fetch): Router {
  const router = Router();

  router.get('/suite', (_req, res) => {
    const suite = loadSuite();
    const info: BenchSuiteInfo = {
      generatedAt: suiteGeneratedAt(),
      categories: BENCH_CATEGORIES.map(category => {
        const items = suite.filter(item => item.category === category);
        const { dataset, license, url } = items[0].source;
        return { category, count: items.length, dataset, license, url };
      }),
    };
    res.json(info);
  });

  // Start a job; follow and cancel it through /v1/runs/:id/events and /v1/runs/:id/cancel.
  router.post('/', (req, res) => {
    let valid: ReturnType<typeof validateBenchRequest>;
    try { valid = validateBenchRequest(req.body); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const owner = req.userId ?? '';
    const executor = benchExecutor(valid.job, { save: result => saveBenchResult(db, owner, result), fetchImpl });
    const started = registry.start(`bench:${valid.key}`, false, executor, owner, { timeoutMs: JOB_TIMEOUT_MS });
    res.status(started.existing ? 200 : 201).json({ ...started, total: valid.job.items.length * valid.job.models.length });
  });

  router.get('/results', handle(async (req, res) => {
    const owner = req.userId!;
    res.json({ scores: await benchScores(db, owner), recent: await recentBenchResults(db, owner) });
  }));

  router.delete('/results', handle(async (req, res) => {
    const { connectionId, model } = req.body ?? {};
    const only = typeof connectionId === 'string' && typeof model === 'string' ? { connectionId, model } : undefined;
    res.json({ removed: await clearBenchResults(db, req.userId!, only) });
  }));

  return router;
}
