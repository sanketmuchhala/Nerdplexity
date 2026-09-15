import { Router, type RequestHandler } from 'express';
import type { BenchScore, TaskKind } from '@app/types';
import { specialists } from '../runtime/agent.js';
import { benchIndex, RouterHealth } from '../runtime/router.js';
import { validateRoute } from './runs.js';

/** What the Free Agent would ask for each kind of task, for the free models the web app lists. */
export function agentRouter(health: RouterHealth, scores: (owner: string) => Promise<BenchScore[]>): Router {
  const router = Router();
  const handle = (fn: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

  router.post('/specialists', handle(async (req, res) => {
    let candidates;
    try { candidates = validateRoute({ ...req.body?.route, strategy: 'agent' }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const owner = req.userId ?? '';
    const bench = benchIndex(await scores(owner).catch(() => []));
    const table = specialists(candidates, { kind: 'general', vision: false, tools: false, estimatedTokens: 2048 }, health, owner, bench);
    const top = (kind: TaskKind) => table[kind].slice(0, 3).map(({ candidate, score, why }) => ({
      connectionId: candidate.connectionId, model: candidate.model, ...(candidate.displayName ? { displayName: candidate.displayName } : {}),
      score: Math.round(score * 1000) / 1000, why,
    }));
    res.json({ specialists: Object.fromEntries((Object.keys(table) as TaskKind[]).map(kind => [kind, top(kind)])) });
  }));

  return router;
}
