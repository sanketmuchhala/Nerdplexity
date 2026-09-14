import type { Connection, ConnectionTarget, DiscoveryResult, ModelRef, RouteModel, RouteRequest } from '@app/types';
import { costStatus } from './cost';

/** The Free Router is chosen like a model: this connection ID and model ID, which no real connection uses. */
export const ROUTER_CONNECTION_ID = 'nerdplexity-router';
export const ROUTER_MODEL_ID = 'free';
export const ROUTER_NAME = 'Free Router';
export const ROUTER_REF: ModelRef = { connectionId: ROUTER_CONNECTION_ID, modelId: ROUTER_MODEL_ID };

export const isRouter = (ref?: { connectionId?: string } | null) => ref?.connectionId === ROUTER_CONNECTION_ID;

/** The server's limits on one route. */
const MAX_CONNECTIONS = 12;
const MAX_MODELS = 200;

export interface RouterPool {
  /** Null when no free model can be reached. */
  route: RouteRequest | null;
  models: number;
  connections: number;
  /** Free models on this machine; document tools can use only these. */
  local: number;
}

/**
 * Every enabled model Nerdplexity has verified as free (on this machine, listed at $0, or on an
 * account marked as having no billing), on connections that have the key they need. Unknown
 * prices are never included, so a routed run cannot reach a paid model.
 */
export function routerPool(
  connections: Connection[],
  catalogs: Record<string, DiscoveryResult | undefined>,
  targetFor: (connection: Connection) => ConnectionTarget,
  ready: (connection: Connection) => boolean,
): RouterPool {
  const routeConnections: RouteRequest['connections'] = [];
  const models: RouteModel[] = [];
  let local = 0;
  for (const connection of connections) {
    if (!connection.enabled || !ready(connection) || routeConnections.length >= MAX_CONNECTIONS) continue;
    const catalog = catalogs[connection.id];
    if (!catalog?.ok) continue;
    const free = catalog.models.filter(model => costStatus(connection, model, catalog.execution).free).slice(0, MAX_MODELS - models.length);
    if (!free.length) continue;
    routeConnections.push({ id: connection.id, target: targetFor(connection) });
    if (catalog.execution === 'local') local += free.length;
    for (const model of free) {
      models.push({
        connectionId: connection.id, model: model.id, displayName: model.displayName,
        capabilities: { tools: model.capabilities.tools, vision: model.capabilities.vision },
        ...(model.contextLength ? { contextLength: model.contextLength } : {}),
      });
    }
  }
  return {
    route: models.length ? { strategy: 'free', connections: routeConnections, models } : null,
    models: models.length, connections: routeConnections.length, local,
  };
}
