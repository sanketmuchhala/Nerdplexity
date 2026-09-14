import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { BillingStatus, Connection, ConnectionKind, ConnectionTarget, DiscoveryResult, ProviderError, RateLimitState } from '@app/types';
import { KEYED_KINDS } from '../lib/db';
import * as store from '../lib/store';
import { authHeaders, sessionEnded } from '../lib/api';
import * as credentials from '../lib/credentials';
import { isLocal, usesBaseURL } from '../lib/cost';
import { followRun, startRun } from '../workspace/runClient';
import { apiUrl, unreachableMessage } from '../lib/backend';
import { routerPool, type RouterPool } from '../lib/router';

export { isLocal, usesBaseURL };

export type CatalogState =
  | { status: 'loading'; previous?: DiscoveryResult }
  | { status: 'done'; result: DiscoveryResult };

export interface ConnectionInput {
  id?: string;
  kind: ConnectionKind;
  name: string;
  baseURL?: string;
  /** undefined keeps the current key; '' clears it. */
  key?: string;
  remember: boolean;
  billing?: BillingStatus;
}

/** Result of sending a short test prompt to one model. */
export type CheckState =
  | { status: 'running' }
  | { status: 'passed'; at: number; ttftMs?: number; durationMs: number }
  | { status: 'failed'; at: number; error: Pick<ProviderError, 'category' | 'message'> };

export const requiresKey = (kind: ConnectionKind) => KEYED_KINDS.includes(kind);

export const targetFor = (connection: Connection): ConnectionTarget => ({
  kind: connection.kind,
  ...(usesBaseURL(connection.kind) ? { baseURL: connection.baseURL } : {}),
  ...(credentials.getKey(connection.id) ? { apiKey: credentials.getKey(connection.id) } : {}),
});

export const modelKey = (connectionId: string, modelId: string) => `${connectionId}::${modelId}`;

/** The newest discovery result, including one shown while a refresh is in progress. */
export const latestResult = (state?: CatalogState): DiscoveryResult | undefined => state?.status === 'done' ? state.result : state?.previous;

/** The free models the Free Router can use right now, with the keys to reach them. */
export function currentRouterPool(connections: Connection[], catalog: Record<string, CatalogState>): RouterPool {
  const catalogs = Object.fromEntries(Object.entries(catalog).map(([id, state]) => [id, latestResult(state)]));
  return routerPool(connections, catalogs, targetFor, connection => !requiresKey(connection.kind) || !!credentials.getKey(connection.id));
}

export async function verifyConnection(target: ConnectionTarget, signal?: AbortSignal): Promise<DiscoveryResult> {
  try {
    const response = await fetch(apiUrl('/v1/models/discover'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ target }), signal,
    });
    if (response.status === 401) {
      try { sessionEnded(); } catch { /* sign-in is shown */ }
      return { ok: false, error: { category: 'auth', message: 'Sign in to continue.' }, checkedAt: Date.now() };
    }
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    return await response.json();
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return { ok: false, error: { category: 'offline', message: unreachableMessage() }, checkedAt: Date.now() };
  }
}

interface ConnectionStore {
  connections: Connection[];
  catalog: Record<string, CatalogState>;
  /** Incremented when keys change so components re-read credential state. */
  keyVersion: number;
  /** Latest rate-limit headers seen per connection, also saved on the connection record. */
  quota: Record<string, RateLimitState & { at: number }>;
  checks: Record<string, CheckState>;
  setQuota: (connectionId: string, quota: RateLimitState) => void;
  checkModel: (connectionId: string, modelId: string) => Promise<void>;
  load: () => Promise<void>;
  save: (input: ConnectionInput) => Promise<Connection>;
  remove: (id: string) => Promise<void>;
  discover: (id: string) => Promise<void>;
  discoverAll: () => Promise<void>;
  /** Signal a key change made outside connections, such as the web search key. */
  keysChanged: () => void;
}

const inflight = new Map<string, AbortController>();

const useConnections = create<ConnectionStore>((set, get) => ({
  connections: [],
  catalog: {},
  keyVersion: 0,
  quota: {},
  checks: {},
  keysChanged: () => set(state => ({ keyVersion: state.keyVersion + 1 })),

  setQuota: (connectionId, quota) => {
    const snapshot = { ...quota, at: Date.now() };
    set(state => ({ quota: { ...state.quota, [connectionId]: snapshot } }));
    void store.connections.patch(connectionId, { quota: snapshot }).catch(() => undefined);
  },

  checkModel: async (connectionId, modelId) => {
    const connection = get().connections.find(c => c.id === connectionId);
    const key = modelKey(connectionId, modelId);
    if (!connection || get().checks[key]?.status === 'running') return;
    const finish = (result: CheckState) => set(state => ({ checks: { ...state.checks, [key]: result } }));
    finish({ status: 'running' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('The check timed out after 60 seconds.')), 60_000);
    try {
      // A short prompt proves the model can run, which listing models cannot.
      const { runId } = await startRun({
        idempotencyKey: uuidv4(), target: targetFor(connection), model: modelId,
        messages: [{ role: 'user', content: 'Reply with the word OK.' }], settings: { maxTokens: 64 },
      }, controller.signal);
      const terminal = await followRun(runId, 0, envelope => {
        if (envelope.event.type === 'quota') get().setQuota(connectionId, envelope.event.quota);
      }, controller.signal);
      if (terminal.type === 'completed') finish({ status: 'passed', at: Date.now(), ttftMs: terminal.timing.ttftMs, durationMs: terminal.timing.durationMs });
      else finish({ status: 'failed', at: Date.now(), error: terminal.type === 'failed' ? terminal.error : { category: 'unknown', message: 'The check was canceled.' } });
    } catch (error) {
      finish({ status: 'failed', at: Date.now(), error: { category: 'transport', message: controller.signal.aborted ? 'The check timed out after 60 seconds.' : (error as Error).message } });
    } finally {
      clearTimeout(timer);
    }
  },

  load: async () => {
    await credentials.loadRememberedKeys();
    const connections = await store.connections.list();
    connections.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
    const quota = Object.fromEntries(connections.filter(c => c.quota).map(c => [c.id, c.quota!]));
    set(state => ({ connections, quota, keyVersion: state.keyVersion + 1 }));
  },

  save: async input => {
    const name = input.name.trim();
    if (!name) throw new Error('Give this connection a name.');
    if (usesBaseURL(input.kind) && !input.baseURL?.trim()) throw new Error('Enter the server address.');
    const now = Date.now();
    const existing = input.id ? get().connections.find(c => c.id === input.id) : undefined;
    // Hosted providers keep a stable ID so one key maps to one provider.
    const id = existing?.id ?? (requiresKey(input.kind) && !get().connections.some(c => c.id === input.kind) ? input.kind : uuidv4());
    if (input.key !== undefined) await credentials.setKey(id, input.key, input.remember);
    else if (credentials.hasKey(id)) await credentials.setKey(id, credentials.getKey(id), input.remember);
    const connection: Connection = {
      id, kind: input.kind, name,
      ...(usesBaseURL(input.kind) ? { baseURL: input.baseURL!.trim() } : {}),
      keyStorage: credentials.hasKey(id) ? (input.remember ? 'device' : 'session') : 'none',
      ...(requiresKey(input.kind) ? { billing: input.billing ?? existing?.billing ?? 'unknown' } : {}),
      ...(existing?.quota ? { quota: existing.quota } : {}),
      enabled: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await store.connections.put(connection);
    set(state => ({
      connections: existing ? state.connections.map(c => (c.id === id ? connection : c)) : [...state.connections, connection],
      keyVersion: state.keyVersion + 1,
    }));
    return connection;
  },

  remove: async id => {
    inflight.get(id)?.abort();
    await store.connections.remove(id);
    await credentials.clearKey(id);
    set(state => {
      const catalog = { ...state.catalog };
      delete catalog[id];
      return { connections: state.connections.filter(c => c.id !== id), catalog, keyVersion: state.keyVersion + 1 };
    });
  },

  discover: async id => {
    const connection = get().connections.find(c => c.id === id);
    if (!connection) return;
    inflight.get(id)?.abort();
    const controller = new AbortController();
    inflight.set(id, controller);
    const current = get().catalog[id];
    set(state => ({ catalog: { ...state.catalog, [id]: { status: 'loading', previous: current?.status === 'done' ? current.result : current?.previous } } }));
    try {
      const result = requiresKey(connection.kind) && !credentials.hasKey(id)
        ? { ok: false as const, error: { category: 'auth' as const, message: 'Add an API key to list models.' }, checkedAt: Date.now() }
        : await verifyConnection(targetFor(connection), controller.signal);
      if (inflight.get(id) === controller) set(state => ({ catalog: { ...state.catalog, [id]: { status: 'done', result } } }));
    } catch {
      // Superseded by a newer request or removal.
    } finally {
      if (inflight.get(id) === controller) inflight.delete(id);
    }
  },

  discoverAll: async () => {
    await Promise.all(get().connections.filter(c => c.enabled).map(c => get().discover(c.id)));
  },
}));

export default useConnections;
