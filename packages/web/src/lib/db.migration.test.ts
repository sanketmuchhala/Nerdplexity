import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const V3_SCHEMA = {
  conversations: 'id, title, provider, model, createdAt, updatedAt',
  settings: '++id',
  events: 'id, ts, corr_id, provider, model',
  documents: 'id, title, updatedAt',
  runs: 'id, conversationId, startedAt, status',
};

const legacyMessages = [
  { id: 'm1', role: 'user', content: 'Explain this', createdAt: 1 },
  { id: 'm2', role: 'assistant', content: 'Literal \\n stays and ```code``` too', createdAt: 2 },
];

async function seedLegacyV3() {
  const legacy = new Dexie('ChatDatabase');
  legacy.version(3).stores(V3_SCHEMA);
  await legacy.open();
  await legacy.table('settings').put({
    id: 1, selectedProvider: 'local-ollama', temperature: 0.4, max_tokens: 1234, web_enabled: false, mode: 'direct',
    apiKeys: { openai: 'sk-openai-saved', anthropic: '', gemini: ' AIza-saved ', deepseek: '', 'local-ollama': '' },
    baseURL: 'http://localhost:11434', compatibleBaseURL: 'http://127.0.0.1:9999/v1',
    localRuntime: 'openai-compatible', localModels: { ollama: 'qwen3:8b', 'openai-compatible': 'lm-model' },
  });
  await legacy.table('conversations').bulkPut([
    { id: 'c-ollama', title: 'Ollama thread', provider: 'local-ollama', runtime: 'ollama', model: 'qwen3:8b', createdAt: 1, updatedAt: 3, messages: legacyMessages, settings: { temperature: 0.7 } },
    { id: 'c-lm', title: 'LM thread', provider: 'local-ollama', runtime: 'openai-compatible', model: 'lm-model', createdAt: 1, updatedAt: 2, messages: [], settings: { temperature: 0.7 } },
    { id: 'c-claude', title: 'Claude thread', provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', createdAt: 1, updatedAt: 1, messages: legacyMessages, settings: { temperature: 0.7 } },
  ]);
  await legacy.table('events').put({ id: 'e1', ts: '2026-01-01', corr_id: 'e1', provider: 'openai', model: 'gpt-4o', result: { status: 'ok' } });
  await legacy.table('documents').put({ id: 'd1', title: 'Notes', content: 'text', updatedAt: 1 });
  await legacy.table('runs').put({ id: 'r1', conversationId: 'c-ollama', startedAt: 1, status: 'completed', tools: [] });
  legacy.close();
}

describe('v3 to v4 connection migration', () => {
  let mod: typeof import('./db');

  beforeAll(async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, removeItem: () => undefined });
    await seedLegacyV3();
    mod = await import('./db');
    await mod.initializeDatabase();
  });
  afterAll(() => { mod.db.close(); vi.unstubAllGlobals(); });

  it('creates connections from legacy settings and referenced providers', async () => {
    const connections = await mod.db.connections.orderBy('id').toArray();
    expect(connections.map(c => [c.id, c.kind, c.baseURL, c.keyStorage])).toEqual([
      ['anthropic', 'anthropic', undefined, 'session'],
      ['gemini', 'gemini', undefined, 'device'],
      ['lmstudio', 'openai-compatible', 'http://127.0.0.1:9999/v1', 'none'],
      ['ollama', 'ollama', 'http://localhost:11434', 'none'],
      ['openai', 'openai', undefined, 'device'],
    ]);
  });

  it('moves saved keys into credentials and clears them from settings', async () => {
    const credentials = await mod.db.credentials.orderBy('connectionId').toArray();
    expect(credentials.map(c => [c.connectionId, c.key])).toEqual([['gemini', 'AIza-saved'], ['openai', 'sk-openai-saved']]);
    const settings = await mod.db.settings.get(1);
    expect(Object.values(settings!.apiKeys).every(k => k === '')).toBe(true);
    expect(settings).toMatchObject({ temperature: 0.4, max_tokens: 1234, connectionsVersion: 1, activeModel: { connectionId: 'lmstudio', modelId: 'lm-model' } });
  });

  it('maps conversations to connections and leaves history untouched', async () => {
    const conversations = await mod.db.conversations.orderBy('id').toArray();
    expect(conversations.map(c => [c.id, c.connectionId, c.model])).toEqual([
      ['c-claude', 'anthropic', 'claude-3-5-sonnet-20241022'],
      ['c-lm', 'lmstudio', 'lm-model'],
      ['c-ollama', 'ollama', 'qwen3:8b'],
    ]);
    // Legacy messages keep unknown provenance rather than a guessed one.
    expect(conversations.find(c => c.id === 'c-ollama')!.messages).toEqual(legacyMessages);
    expect(await mod.db.conversations.where('connectionId').equals('anthropic').count()).toBe(1);
  });

  it('preserves events, documents, and runs', async () => {
    expect(await mod.db.events.count()).toBe(1);
    expect(await mod.db.documents.count()).toBe(1);
    expect(await mod.db.runs.count()).toBe(1);
  });

  it('is idempotent and does not resurrect removed connections', async () => {
    await mod.migrateLegacyData();
    expect(await mod.db.connections.count()).toBe(5);
    expect(await mod.db.credentials.count()).toBe(2);
    await mod.db.connections.delete('lmstudio');
    await mod.initializeDatabase();
    expect(await mod.db.connections.get('lmstudio')).toBeUndefined();
  });

  it('gives a fresh install the two local connections and no default model', async () => {
    mod.db.close();
    await Dexie.delete('ChatDatabase');
    await mod.initializeDatabase();
    expect((await mod.db.connections.orderBy('id').toArray()).map(c => c.id)).toEqual(['lmstudio', 'ollama']);
    expect((await mod.db.settings.get(1))?.activeModel).toBeUndefined();
  });
});

describe('credentials', () => {
  it('keeps session keys out of IndexedDB and remembers device keys', async () => {
    const { db } = await import('./db');
    const credentials = await import('./credentials');
    await db.open();
    await credentials.setKey('session-conn', 'sk-session-only', false);
    expect(credentials.getKey('session-conn')).toBe('sk-session-only');
    expect(await db.credentials.get('session-conn')).toBeUndefined();
    await credentials.setKey('device-conn', 'sk-device', true);
    expect((await db.credentials.get('device-conn'))?.key).toBe('sk-device');
    // Reloading drops session keys and restores device keys.
    await credentials.loadRememberedKeys();
    expect(credentials.getKey('session-conn')).toBe('');
    expect(credentials.getKey('device-conn')).toBe('sk-device');
    await credentials.clearKey('device-conn');
    expect(await db.credentials.get('device-conn')).toBeUndefined();
  });
});
