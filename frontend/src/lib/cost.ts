import type { Connection, ConnectionKind, DiscoveryResult, ModelDescriptor, ModelRef } from '@app/types';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

export const usesBaseURL = (kind: ConnectionKind) => kind === 'ollama' || kind === 'openai-compatible';

/** Best-effort label before discovery; the server's destination policy is authoritative. */
export function isLocal(connection: Pick<Connection, 'kind' | 'baseURL'>) {
  if (!usesBaseURL(connection.kind)) return false;
  try { return LOOPBACK.has(new URL(connection.baseURL || '').hostname); } catch { return false; }
}

export type CostClass = 'local' | 'zero-price' | 'no-billing' | 'paid' | 'unknown';

export interface CostStatus {
  cls: CostClass;
  /** Allowed under Free only: local, verified $0, or an account the user marked as having no billing. */
  free: boolean;
  label: string;
  detail: string;
}

const money = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2).replace(/\.?0+$/, '')}`);

/** Whether a model can run without charges, and how that is known. Unknown is never treated as free. */
export function costStatus(connection: Connection | undefined, model: ModelDescriptor | undefined, execution?: 'local' | 'remote'): CostStatus {
  if (!connection) return { cls: 'unknown', free: false, label: 'Price unknown', detail: 'The connection for this model was removed.' };
  if (execution ? execution === 'local' : isLocal(connection)) {
    return { cls: 'local', free: true, label: 'On this machine', detail: 'No hosted fee. It uses your own hardware.' };
  }
  if (model?.pricing === 'zero-price') return { cls: 'zero-price', free: true, label: 'Free model', detail: `${connection.name} lists this model at $0.` };
  if (connection.billing === 'no-billing' && connection.kind !== 'openrouter') {
    return { cls: 'no-billing', free: true, label: 'Free plan', detail: `You marked this ${connection.name} account as having no billing, so it cannot be charged.` };
  }
  if (model?.pricing === 'paid') {
    return {
      cls: 'paid', free: false,
      label: model.price ? `${money(model.price.input)} in / ${money(model.price.output)} out per M tokens` : 'Paid',
      detail: `${connection.name} charges for this model.`,
    };
  }
  if (connection.billing === 'paid') return { cls: 'paid', free: false, label: 'Billed account', detail: `You marked this ${connection.name} account as billed.` };
  return { cls: 'unknown', free: false, label: 'Price unknown', detail: `Nerdplexity cannot confirm this model is free on ${connection.name}. It may be billed.` };
}

/** Free alternatives the user can choose after a failure: same connection first, then others. Never chosen automatically. */
export function freeAlternatives(
  connections: Connection[],
  catalogs: Record<string, DiscoveryResult | undefined>,
  exclude: ModelRef,
  limit = 3,
): ModelRef[] {
  const ordered = [...connections].sort((a, b) => Number(b.id === exclude.connectionId) - Number(a.id === exclude.connectionId));
  const result: ModelRef[] = [];
  for (const connection of ordered) {
    const catalog = catalogs[connection.id];
    if (!catalog?.ok) continue;
    const models = [...catalog.models].sort((a, b) =>
      Number(b.id === 'openrouter/free') - Number(a.id === 'openrouter/free'));
    for (const model of models) {
      if (connection.id === exclude.connectionId && model.id === exclude.modelId) continue;
      if (!costStatus(connection, model, catalog.execution).free) continue;
      result.push({ connectionId: connection.id, modelId: model.id });
      if (result.length >= limit) return result;
    }
  }
  return result;
}
