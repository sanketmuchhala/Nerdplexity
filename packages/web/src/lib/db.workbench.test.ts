import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { workbenchSettings } from './workbench';

it('upgrades a P3 database without changing its data and persists presets across reopen', async () => {
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
    expect(db.verno).toBe(5);
    for (const [name, row] of Object.entries(fixtures)) expect(await db.table(name).toArray()).toEqual([row]);
    const preset = { id: 'preset', name: 'Focused', model: { connectionId: 'conn', modelId: 'chosen' }, settings: workbenchSettings(), updatedAt: 1 };
    await db.presets.add(preset);
    db.close(); await db.open();
    expect(await db.presets.get('preset')).toEqual(preset);
    expect(await db.credentials.get('conn')).toEqual(fixtures.credentials);
  } finally { db.close(); }
});
