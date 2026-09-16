import type { Connection, ConnectionTarget, DiscoveryResult, ModelRef, RouteModel, RouteRequest } from '@app/types';
import { costStatus } from './cost';

/** The Free Router is chosen like a model: this connection ID and model ID, which no real connection uses. */
export const ROUTER_CONNECTION_ID = 'nerdplexity-router';
export const ROUTER_MODEL_ID = 'free';
export const ROUTER_NAME = 'Free Router';
export const ROUTER_REF: ModelRef = { connectionId: ROUTER_CONNECTION_ID, modelId: ROUTER_MODEL_ID };

/** The Free Agent is chosen the same way, with its own model ID on the router's connection. */
export const AGENT_MODEL_ID = 'agent';
export const AGENT_NAME = 'Free Agent';
export const AGENT_REF: ModelRef = { connectionId: ROUTER_CONNECTION_ID, modelId: AGENT_MODEL_ID };

type Choice = { connectionId?: string; modelId?: string; model?: string } | null | undefined;
/** The server chooses the model: the Free Router or the Free Agent. */
export const isRouter = (ref?: Choice) => ref?.connectionId === ROUTER_CONNECTION_ID;
export const isAgent = (ref?: Choice) => isRouter(ref) && (ref?.modelId ?? ref?.model) === AGENT_MODEL_ID;
export const routerName = (ref?: Choice) => isAgent(ref) ? AGENT_NAME : ROUTER_NAME;
export const routeStrategy = (ref?: Choice): 'free' | 'agent' => isAgent(ref) ? 'agent' : 'free';

/** The chat store actions needed to choose a model. */
interface ChatActions {
  saveSettings: (patch: { activeModel: ModelRef; agentDefault?: boolean }) => Promise<void>;
  activeConversation: () => { id: string; model?: string; messages: unknown[] } | null | undefined;
  setConversationModel: (id: string, ref: ModelRef) => Promise<void>;
}

/**
 * Make the Free Agent (the default) the chosen model, and the model of the open thread if it is
 * new and empty. Callers use it only when no model has been chosen, or once to move an automatic
 * Free Router default to the Free Agent; a model a person picked is never replaced.
 */
export async function chooseAgentByDefault(chat: ChatActions) {
  await chat.saveSettings({ activeModel: AGENT_REF, agentDefault: true });
  const conversation = chat.activeConversation();
  if (conversation && (!conversation.model || isRouter(conversation)) && conversation.messages.length === 0) await chat.setConversationModel(conversation.id, AGENT_REF);
}

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
