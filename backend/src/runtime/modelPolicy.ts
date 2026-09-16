import type { ModelDescriptor } from '@app/types';
import { discover } from './discovery.js';
import type { ResolvedTarget } from './destinations.js';

export class FreeModelPolicyError extends Error {}

async function catalog(target: ResolvedTarget, signal: AbortSignal, fetchImpl: typeof fetch) {
  signal.throwIfAborted();
  const cancellableFetch: typeof fetch = (input, init = {}) => fetchImpl(input, {
    ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
  });
  const result = await discover(target, cancellableFetch);
  signal.throwIfAborted();
  return result;
}

/** Best-effort current metadata for explicitly paid runs; pricing checks use verifyFreeModel. */
export async function inspectModel(
  target: ResolvedTarget, model: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch,
): Promise<ModelDescriptor | undefined> {
  const result = await catalog(target, signal, fetchImpl);
  return result.ok ? result.models.find(entry => entry.id === model) : undefined;
}

/**
 * Verify prices at dispatch when a provider has no request-time price ceiling.
 * Browser catalogs and account billing labels are not authorization to spend money.
 * Do not cache successful checks: a model's promotional pricing may change between calls.
 */
export async function verifyFreeModel(
  target: ResolvedTarget, model: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch,
): Promise<ModelDescriptor | undefined> {
  signal.throwIfAborted();
  if (target.execution === 'local') return undefined;
  // OpenRouter enforces provider.max_price on the generation request itself. That is a
  // stronger, race-free guarantee than reading a catalog immediately beforehand: even if
  // pricing changes between the two requests, OpenRouter must refuse every route above $0.
  // It also keeps Free Agent and Deep Research from downloading the full catalog per step.
  if (target.kind === 'openrouter') return undefined;
  const result = await catalog(target, signal, fetchImpl);
  if (!result.ok) {
    throw new FreeModelPolicyError(`Free only is on. Cannot verify current pricing: ${result.error.message} No generation request was sent.`);
  }
  const descriptor = result.models.find(entry => entry.id === model);
  if (!descriptor || descriptor.pricing !== 'zero-price') {
    throw new FreeModelPolicyError(`Free only is on. ${model} is ${descriptor?.pricing === 'paid' ? 'a paid model' : 'not verified as free in the provider’s current catalog'}. No generation request was sent.`);
  }
  return descriptor;
}
