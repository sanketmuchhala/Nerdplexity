import { count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { DataCounts, DataKind, ImportRequest, ImportResult, StoreStatus } from '@app/types';
import type { Database } from '../db/client.js';
import { comparisons, connections, conversations, documents, presets, runs, settings } from '../db/schema.js';
import { createConversation, listConversations } from './conversations.js';
import * as validate from './validate.js';
import { withoutSecrets } from './validate.js';

// Moving a user's data in bulk: importing a browser's IndexedDB, and copying between databases.
// Imports are idempotent: a record whose ID this user already has is skipped, never overwritten.

const KINDS: DataKind[] = ['conversations', 'documents', 'runs', 'connections', 'presets', 'comparisons'];
const zero = (): DataCounts => ({ conversations: 0, documents: 0, runs: 0, connections: 0, presets: 0, comparisons: 0 });

export async function storeStatus(db: Database, userId: string): Promise<StoreStatus> {
  const tables = { conversations, documents, runs, connections, presets, comparisons };
  const counts = zero();
  await Promise.all(KINDS.map(async kind => {
    const table = tables[kind];
    const [row] = await db.select({ n: count() }).from(table).where(eq(table.userId, userId));
    counts[kind] = Number(row.n);
  }));
  const [row] = await db.select({ importedAt: settings.importedAt }).from(settings).where(eq(settings.userId, userId));
  return { imported: row?.importedAt != null, counts };
}

/** Records that fail validation are skipped and counted, so one damaged record cannot block an import. */
export async function importData(db: Database, userId: string, data: ImportRequest): Promise<ImportResult> {
  const result: ImportResult = { imported: zero(), skipped: zero() };
  const each = async <S extends z.ZodType>(kind: DataKind, schema: S, insert: (record: z.infer<S>) => Promise<boolean>) => {
    for (const raw of data[kind] ?? []) {
      const parsed = schema.safeParse(raw);
      if (parsed.success && await insert(parsed.data)) result.imported[kind]++;
      else result.skipped[kind]++;
    }
  };
  const inserted = (rows: unknown[]) => rows.length > 0;

  await each('conversations', validate.conversation, record => createConversation(db, userId, record));
  await each('documents', validate.document, async doc =>
    inserted(await db.insert(documents).values({ userId, ...doc }).onConflictDoNothing().returning({ id: documents.id })));
  await each('runs', validate.runRecord, async record =>
    inserted(await db.insert(runs).values({ userId, id: record.id, conversationId: record.conversationId, status: record.status, startedAt: record.startedAt, record: withoutSecrets(record) })
      .onConflictDoNothing().returning({ id: runs.id })));
  await each('connections', validate.connection, async record =>
    inserted(await db.insert(connections).values({ userId, id: record.id, kind: record.kind, createdAt: record.createdAt, record: withoutSecrets(record) })
      .onConflictDoNothing().returning({ id: connections.id })));
  await each('presets', validate.preset, async record =>
    inserted(await db.insert(presets).values({ userId, id: record.id, name: record.name, record: withoutSecrets(record) })
      .onConflictDoNothing().returning({ id: presets.id })));
  await each('comparisons', validate.comparison, async record =>
    inserted(await db.insert(comparisons).values({ userId, id: record.id, createdAt: record.createdAt, record: withoutSecrets(record) })
      .onConflictDoNothing().returning({ id: comparisons.id })));

  const now = Date.now();
  const value = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? withoutSecrets(data.settings) : null;
  // Settings the user already has on the server are kept; imported settings only fill an empty account.
  if (value) await db.insert(settings).values({ userId, value, updatedAt: now }).onConflictDoNothing();
  if (data.done) {
    await db.insert(settings).values({ userId, value: null, importedAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: settings.userId, set: { importedAt: now } });
  }
  return result;
}

/** Everything one user has, in the shape importData accepts. */
export async function exportData(db: Database, userId: string): Promise<ImportRequest> {
  const [threads, docs, runRows, connectionRows, presetRows, comparisonRows, settingsRow] = await Promise.all([
    listConversations(db, userId, true),
    db.select({ id: documents.id, title: documents.title, content: documents.content, updatedAt: documents.updatedAt }).from(documents).where(eq(documents.userId, userId)),
    db.select({ record: runs.record }).from(runs).where(eq(runs.userId, userId)),
    db.select({ record: connections.record }).from(connections).where(eq(connections.userId, userId)),
    db.select({ record: presets.record }).from(presets).where(eq(presets.userId, userId)),
    db.select({ record: comparisons.record }).from(comparisons).where(eq(comparisons.userId, userId)),
    db.select({ value: settings.value }).from(settings).where(eq(settings.userId, userId)),
  ]);
  const records = (rows: { record: unknown }[]) => rows.map(row => row.record);
  return {
    conversations: threads, documents: docs, runs: records(runRows), connections: records(connectionRows),
    presets: records(presetRows), comparisons: records(comparisonRows),
    ...(settingsRow[0]?.value ? { settings: settingsRow[0].value as Record<string, unknown> } : {}),
  };
}
