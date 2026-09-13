import type { Conversation, RunRecord } from './db';

export interface RunMeasurement {
  providerMs?: number;
  generationMs?: number;
  tokensPerSecond?: number;
  contextUtilization?: number;
  estimatedCostUsd?: number;
  costProvenance: 'catalog-snapshot' | 'zero-price-snapshot' | 'unavailable';
}

export interface RunAnalytics {
  total: number;
  completed: number;
  failed: number;
  stopped: number;
  running: number;
  completionRate?: number;
  p50ProviderMs?: number;
  p95ProviderMs?: number;
  p50TtftMs?: number;
  tokensPerSecond?: number;
  reportedTokens: number;
  usageCoverage: number;
  estimatedCostUsd: number;
  costCoverage: number;
  contextUtilization?: number;
  toolRuns: number;
  feedback: { helpful: number; unhelpful: number; unrated: number };
  models: Array<{ key: string; model: string; provider: string; runs: number; completed: number; reportedTokens: number; estimatedCostUsd: number; pricedRuns: number }>;
  days: Array<{ day: string; runs: number; completed: number; failed: number; stopped: number }>;
}

const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0;

export function percentile(values: number[], p: number): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const index = Math.max(0, Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length) - 1);
  return sorted[index];
}

export function measurementFor(run: RunRecord): RunMeasurement {
  const providerMs = finite(run.durationMs) ? Math.max(0, run.durationMs - (run.queuedMs ?? 0)) : undefined;
  const generationMs = providerMs !== undefined && finite(run.ttftMs) ? providerMs - run.ttftMs : undefined;
  // Tool execution time is mixed into duration, so a tool run cannot produce a meaningful generation rate.
  const tokensPerSecond = run.mode === 'chat' && run.status === 'completed' && run.usage && run.usage.completion_tokens > 0 && generationMs !== undefined && generationMs > 0
    ? run.usage.completion_tokens / (generationMs / 1000)
    : undefined;
  const budget = run.input?.context.budget;
  const contextUtilization = run.mode === 'chat' && run.usage && finite(budget) && budget > 0
    ? run.usage.prompt_tokens / budget
    : undefined;
  const hasCatalogPrice = run.pricing?.classification === 'paid'
    && finite(run.pricing.inputPerMillion)
    && finite(run.pricing.outputPerMillion);
  const zeroPrice = run.pricing?.classification === 'zero-price';
  const estimatedCostUsd = run.usage && (hasCatalogPrice || zeroPrice)
    ? ((run.usage.prompt_tokens * (run.pricing?.inputPerMillion ?? 0)) + (run.usage.completion_tokens * (run.pricing?.outputPerMillion ?? 0))) / 1_000_000
    : undefined;
  return {
    providerMs,
    ...(generationMs !== undefined && generationMs >= 0 ? { generationMs } : {}),
    ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
    ...(contextUtilization !== undefined ? { contextUtilization } : {}),
    ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    costProvenance: zeroPrice ? 'zero-price-snapshot' : hasCatalogPrice ? 'catalog-snapshot' : 'unavailable',
  };
}

export function deriveRunAnalytics(runs: RunRecord[], conversations: Conversation[]): RunAnalytics {
  const completed = runs.filter(run => run.status === 'completed').length;
  const failed = runs.filter(run => run.status === 'failed' || run.status === 'interrupted').length;
  const stopped = runs.filter(run => run.status === 'canceled' || run.status === 'stopped').length;
  const running = runs.filter(run => run.status === 'running').length;
  const terminal = completed + failed + stopped;
  const measured = runs.map(run => ({ run, metric: measurementFor(run) }));
  const terminalRuns = runs.filter(run => run.status !== 'running');
  const providerTimes = terminalRuns.map(run => measurementFor(run).providerMs).filter(finite);
  const ttfts = terminalRuns.map(run => run.ttftMs).filter(finite);
  const rates = measured.map(item => item.metric.tokensPerSecond).filter(finite);
  const contexts = measured.map(item => item.metric.contextUtilization).filter(finite);
  const usageRuns = runs.filter(run => !!run.usage);
  const costRuns = measured.filter(item => item.metric.estimatedCostUsd !== undefined);
  const feedbackByRun = new Map<string, 'helpful' | 'unhelpful'>();
  for (const conversation of conversations) {
    for (const message of conversation.messages) if (message.role === 'assistant' && message.runId && message.feedback) feedbackByRun.set(message.runId, message.feedback);
  }
  const rated = runs.map(run => run.runId ? feedbackByRun.get(run.runId) : undefined);
  const completedRated = runs.filter(run => run.status === 'completed' && run.runId && feedbackByRun.has(run.runId)).length;
  const byModel = new Map<string, RunAnalytics['models'][number]>();
  for (const run of runs) {
    const key = `${run.connectionId ?? run.provider}::${run.model}`;
    const current = byModel.get(key) ?? { key, model: run.model, provider: run.provider, runs: 0, completed: 0, reportedTokens: 0, estimatedCostUsd: 0, pricedRuns: 0 };
    current.runs += 1;
    current.completed += Number(run.status === 'completed');
    current.reportedTokens += run.usage?.total_tokens ?? 0;
    const cost = measurementFor(run).estimatedCostUsd;
    current.estimatedCostUsd += cost ?? 0;
    current.pricedRuns += Number(cost !== undefined);
    byModel.set(key, current);
  }
  const byDay = new Map<string, RunAnalytics['days'][number]>();
  for (const run of runs) {
    const date = new Date(run.startedAt);
    if (!Number.isFinite(date.getTime())) continue;
    const day = date.toISOString().slice(0, 10);
    const current = byDay.get(day) ?? { day, runs: 0, completed: 0, failed: 0, stopped: 0 };
    current.runs += 1;
    current.completed += Number(run.status === 'completed');
    current.failed += Number(run.status === 'failed' || run.status === 'interrupted');
    current.stopped += Number(run.status === 'canceled' || run.status === 'stopped');
    byDay.set(day, current);
  }
  return {
    total: runs.length, completed, failed, stopped, running,
    ...(terminal ? { completionRate: completed / terminal } : {}),
    ...(providerTimes.length ? { p50ProviderMs: percentile(providerTimes, 50), p95ProviderMs: percentile(providerTimes, 95) } : {}),
    ...(ttfts.length ? { p50TtftMs: percentile(ttfts, 50) } : {}),
    ...(rates.length ? { tokensPerSecond: rates.reduce((sum, value) => sum + value, 0) / rates.length } : {}),
    reportedTokens: usageRuns.reduce((sum, run) => sum + (run.usage?.total_tokens ?? 0), 0),
    usageCoverage: runs.length ? usageRuns.length / runs.length : 0,
    estimatedCostUsd: costRuns.reduce((sum, item) => sum + (item.metric.estimatedCostUsd ?? 0), 0),
    costCoverage: usageRuns.length ? costRuns.length / usageRuns.length : 0,
    ...(contexts.length ? { contextUtilization: contexts.reduce((sum, value) => sum + value, 0) / contexts.length } : {}),
    toolRuns: runs.filter(run => (run.tools?.length ?? 0) > 0 || run.mode === 'agent').length,
    feedback: {
      helpful: rated.filter(value => value === 'helpful').length,
      unhelpful: rated.filter(value => value === 'unhelpful').length,
      unrated: completed - completedRated,
    },
    models: [...byModel.values()].sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model)),
    days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** A portable run export excludes server recovery/control identifiers. */
export function exportRuns(runs: RunRecord[]) {
  return JSON.stringify({
    format: 'nerdplexity-runs', version: 1, exportedAt: new Date().toISOString(),
    runs: runs.map(({ idempotencyKey: _idempotencyKey, runId: _runId, lastSeq: _lastSeq, ...run }) => run),
  }, null, 2);
}
