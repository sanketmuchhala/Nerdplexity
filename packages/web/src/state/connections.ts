import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Connection, ConnectionKind, ConnectionTarget, DiscoveryResult } from '@app/types';
import { db, HOSTED_PROVIDERS } from '../lib/db';
import * as credentials from '../lib/credentials';

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
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

export const requiresKey = (kind: ConnectionKind) => (HOSTED_PROVIDERS as readonly string[]).includes(kind);
export const usesBaseURL = (kind: ConnectionKind) => kind === 'ollama' || kind === 'openai-compatible';

/** Best-effort label before discovery; the server's destination policy is authoritative. */
export function isLocal(connection: Pick<Connection, 'kind' | 'baseURL'>) {
  if (!usesBaseURL(connection.kind)) return false;
  try { return LOOPBACK.has(new URL(connection.baseURL || '').hostname); } catch { return false; }
}

export const targetFor = (connection: Connection): ConnectionTarget => ({
  kind: connection.kind,
  ...(usesBaseURL(connection.kind) ? { baseURL: connection.baseURL } : {}),
  ...(credentials.getKey(connection.id) ? { apiKey: credentials.getKey(connection.id) } : {}),
});

export const modelKey = (connectionId: string, modelId: string) => `${connectionId}::${modelId}`;

async function requestDiscovery(target: ConnectionTarget, signal?: AbortSignal): Promise<DiscoveryResult> {
  try {
    const response = await fetch('/v1/models/discover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }), signal,
    });
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    return await response.json();
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return { ok: false, error: { category: 'offline', message: 'The Nerdplexity backend is not responding. Start it with pnpm dev.' }, checkedAt: Date.now() };
  }
}

interface ConnectionStore {
  connections: Connection[];
  catalog: Record<string, CatalogState>;
  /** Incremented when keys change so components re-read credential state. */
  keyVersion: number;
  load: () => Promise<void>;
  save: (input: ConnectionInput) => Promise<Connection>;
  remove: (id: string) => Promise<void>;
  discover: (id: string) => Promise<void>;
  discoverAll: () => Promise<void>;
}

const inflight = new Map<string, AbortController>();

const useConnections = create<ConnectionStore>((set, get) => ({
  connections: [],
  catalog: {},
  keyVersion: 0,

  load: async () => {
    await credentials.loadRememberedKeys();
    const connections = await db.connections.orderBy('id').toArray();
    connections.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
    set(state => ({ connections, keyVersion: state.keyVersion + 1 }));
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
      enabled: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.connections.put(connection);
    set(state => ({
      connections: existing ? state.connections.map(c => (c.id === id ? connection : c)) : [...state.connections, connection],
      keyVersion: state.keyVersion + 1,
    }));
    return connection;
  },

  remove: async id => {
    inflight.get(id)?.abort();
    await db.transaction('rw', db.connections, db.credentials, async () => {
      await db.connections.delete(id);
      await credentials.clearKey(id);
    });
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
        : await requestDiscovery(targetFor(connection), controller.signal);
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
