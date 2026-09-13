import type { RunRecord } from './db';

export interface RunMeasurement {
  providerMs?: number;
  generationMs?: number;
  tokensPerSecond?: number;
  contextUtilization?: number;
  estimatedCostUsd?: number;
  costProvenance: 'catalog-snapshot' | 'zero-price-snapshot' | 'unavailable';
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

/** Measurements shown for one saved run. Missing provider data stays unavailable. */
export function measurementFor(run: RunRecord): RunMeasurement {
  const providerMs = finite(run.durationMs) ? Math.max(0, run.durationMs - (run.queuedMs ?? 0)) : undefined;
  const generationMs = providerMs !== undefined && finite(run.ttftMs) ? providerMs - run.ttftMs : undefined;
  const tokensPerSecond = run.mode === 'chat' && run.status === 'completed' && run.usage
    && run.usage.completion_tokens > 0 && generationMs !== undefined && generationMs > 0
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
    ? ((run.usage.prompt_tokens * (run.pricing?.inputPerMillion ?? 0))
      + (run.usage.completion_tokens * (run.pricing?.outputPerMillion ?? 0))) / 1_000_000
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

/** A portable run export excludes server recovery/control identifiers. */
export function exportRuns(runs: RunRecord[]) {
  return JSON.stringify({
    format: 'nerdplexity-runs', version: 1, exportedAt: new Date().toISOString(),
    runs: runs.map(({ idempotencyKey: _idempotencyKey, runId: _runId, lastSeq: _lastSeq, ...run }) => run),
  }, null, 2);
}
