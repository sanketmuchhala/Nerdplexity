import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { workbenchSettings } from './workbench';
import type { ComparisonRecord } from './db';

it('upgrades a P3 database without changing its data and persists P4/P5 records across reopen', async () => {
  const legacy = new Dexie('ChatDatabase');
  legacy.version(4).stores({
    conversations: 'id, title, provider, model, createdAt, updatedAt, connectionId', settings: '++id',
    events: 'id, ts, corr_id, provider, model', documents: 'id, title, updatedAt',
    runs: 'id, conversationId, startedAt, status', connections: 'id, kind', credentials: 'connectionId',
  });
  const fixtures = {
    conversations: { id: 'thread', connectionId: 'conn', model: 'chosen', messages: [{ id: 'm', role: 'assistant', content: 'Keep literal \\n' }] },
    settings: { id: 1, costPolicy: 'free-only', connectionsVersion: 1 },
    credentials: { connectionId: 'conn', key: 'remembered-test-key' },
    connections: { id: 'conn', kind: 'custom' },
    runs: { id: 'run', conversationId: 'thread', status: 'running', output: 'Partial answer' },
    events: { id: 'event', model: 'old-model' }, documents: { id: 'doc', content: 'Saved notes' },
  };
  for (const [name, row] of Object.entries(fixtures)) await legacy.table(name).put(row);
  legacy.close();
  const { db } = await import('./db');
  try {
    await db.open();
    expect(db.verno).toBe(6);
    for (const [name, row] of Object.entries(fixtures)) expect(await db.table(name).toArray()).toEqual([row]);
    const preset = { id: 'preset', name: 'Focused', model: { connectionId: 'conn', modelId: 'chosen' }, settings: workbenchSettings(), updatedAt: 1 };
    await db.presets.add(preset);
    const comparison: ComparisonRecord = { id: 'comparison', prompt: 'Same prompt', createdAt: 1, updatedAt: 1, input: { messages: [{ role: 'user', content: 'Same prompt' }], settings: {}, configured: workbenchSettings(), context: { estimatedTokens: 3, budget: 8192, omittedMessages: 0, limitKnown: false }, documents: [] }, sides: [{ connectionId: 'a', modelId: 'one', status: 'completed', output: 'A' }, { connectionId: 'b', modelId: 'two', status: 'completed', output: 'B' }] };
    await db.comparisons.add(comparison);
    db.close(); await db.open();
    expect(await db.presets.get('preset')).toEqual(preset);
    expect(await db.comparisons.get('comparison')).toEqual(comparison);
    expect(await db.credentials.get('conn')).toEqual(fixtures.credentials);
  } finally { db.close(); }
});
