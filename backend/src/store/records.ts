import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { comparisons, connections, documents, presets, runs, settings } from '../db/schema.js';
import { withoutSecrets, type DocumentInput } from './validate.js';

// Documents, run history, connections, presets, comparisons, and settings. Every function takes
// the owner's ID and never reads or writes another user's rows.

type Json = Record<string, unknown>;
const records = (rows: { record: unknown }[]) => rows.map(row => row.record as Json);

// Documents

export const listDocuments = async (db: Database, userId: string) =>
  db.select({ id: documents.id, title: documents.title, content: documents.content, updatedAt: documents.updatedAt })
    .from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.updatedAt));

export async function putDocument(db: Database, userId: string, doc: DocumentInput) {
  await db.insert(documents).values({ userId, ...doc })
    .onConflictDoUpdate({ target: [documents.userId, documents.id], set: { title: doc.title, content: doc.content, updatedAt: doc.updatedAt } });
}

export async function deleteDocument(db: Database, userId: string, id: string) {
  return (await db.delete(documents).where(and(eq(documents.userId, userId), eq(documents.id, id))).returning({ id: documents.id })).length > 0;
}

// Run history

export async function listRuns(db: Database, userId: string, options: { status?: string; limit?: number } = {}) {
  const where = options.status ? and(eq(runs.userId, userId), eq(runs.status, options.status)) : eq(runs.userId, userId);
  return records(await db.select({ record: runs.record }).from(runs).where(where).orderBy(desc(runs.startedAt)).limit(options.limit ?? 100));
}

export async function putRun(db: Database, userId: string, record: Json & { id: string; conversationId: string; status: string; startedAt: number }) {
  const value = withoutSecrets(record);
  await db.insert(runs).values({ userId, id: record.id, conversationId: record.conversationId, status: record.status, startedAt: record.startedAt, record: value })
    .onConflictDoUpdate({ target: [runs.userId, runs.id], set: { conversationId: record.conversationId, status: record.status, startedAt: record.startedAt, record: value } });
}

/**
 * Merge fields into a saved run (progress while streaming). The fields that decide how a run is
 * listed and whether it finished change only through putRun and finishRun.
 */
export async function patchRun(db: Database, userId: string, id: string, patch: Json) {
  const { id: _id, status: _status, startedAt: _startedAt, conversationId: _conversationId, ...rest } = withoutSecrets(patch);
  const updated = await db.update(runs).set({ record: sql`${runs.record} || ${JSON.stringify(rest)}::jsonb` })
    .where(and(eq(runs.userId, userId), eq(runs.id, id))).returning({ id: runs.id });
  return updated.length > 0;
}

/**
 * Record a run's outcome, only if it is still running (or was never saved). Two tabs following
 * the same run both call this; exactly one of them claims it.
 */
export async function finishRun(db: Database, userId: string, record: Json & { id: string; conversationId: string; status: string; startedAt: number }) {
  const value = withoutSecrets(record);
  const claimed = await db.insert(runs).values({ userId, id: record.id, conversationId: record.conversationId, status: record.status, startedAt: record.startedAt, record: value })
    .onConflictDoUpdate({
      target: [runs.userId, runs.id],
      set: { status: record.status, record: value },
      setWhere: eq(runs.status, 'running'),
    }).returning({ id: runs.id });
  return claimed.length > 0;
}

// Connections (never with keys)

export const listConnections = async (db: Database, userId: string) =>
  records(await db.select({ record: connections.record }).from(connections).where(eq(connections.userId, userId)).orderBy(asc(connections.createdAt), asc(connections.id)));

export async function putConnection(db: Database, userId: string, record: Json & { id: string; kind: string; createdAt: number }) {
  const value = withoutSecrets(record);
  await db.insert(connections).values({ userId, id: record.id, kind: record.kind, createdAt: record.createdAt, record: value })
    .onConflictDoUpdate({ target: [connections.userId, connections.id], set: { kind: record.kind, record: value } });
}

export async function patchConnection(db: Database, userId: string, id: string, patch: Json) {
  const { id: _id, kind: _kind, createdAt: _createdAt, ...rest } = withoutSecrets(patch);
  const updated = await db.update(connections).set({ record: sql`${connections.record} || ${JSON.stringify(rest)}::jsonb` })
    .where(and(eq(connections.userId, userId), eq(connections.id, id))).returning({ id: connections.id });
  return updated.length > 0;
}

export async function deleteConnection(db: Database, userId: string, id: string) {
  return (await db.delete(connections).where(and(eq(connections.userId, userId), eq(connections.id, id))).returning({ id: connections.id })).length > 0;
}

// Presets

export const listPresets = async (db: Database, userId: string) =>
  records(await db.select({ record: presets.record }).from(presets).where(eq(presets.userId, userId)).orderBy(asc(presets.name)));

export async function putPreset(db: Database, userId: string, record: Json & { id: string; name: string }) {
  const value = withoutSecrets(record);
  await db.insert(presets).values({ userId, id: record.id, name: record.name, record: value })
    .onConflictDoUpdate({ target: [presets.userId, presets.id], set: { name: record.name, record: value } });
}

export async function deletePreset(db: Database, userId: string, id: string) {
  return (await db.delete(presets).where(and(eq(presets.userId, userId), eq(presets.id, id))).returning({ id: presets.id })).length > 0;
}

// Comparisons

export const listComparisons = async (db: Database, userId: string) =>
  records(await db.select({ record: comparisons.record }).from(comparisons).where(eq(comparisons.userId, userId)).orderBy(desc(comparisons.createdAt)));

export async function putComparison(db: Database, userId: string, record: Json & { id: string; createdAt: number }) {
  const value = withoutSecrets(record);
  await db.insert(comparisons).values({ userId, id: record.id, createdAt: record.createdAt, record: value })
    .onConflictDoUpdate({ target: [comparisons.userId, comparisons.id], set: { record: value } });
}

export async function deleteComparison(db: Database, userId: string, id: string) {
  return (await db.delete(comparisons).where(and(eq(comparisons.userId, userId), eq(comparisons.id, id))).returning({ id: comparisons.id })).length > 0;
}

// Settings

export async function getSettings(db: Database, userId: string): Promise<Json | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.userId, userId));
  return (row?.value as Json | null) ?? null;
}

/** Merge fields into the user's settings and return the result. Concurrent saves of different fields both survive. */
export async function patchSettings(db: Database, userId: string, patch: Json): Promise<Json> {
  const value = withoutSecrets(patch);
  const [row] = await db.insert(settings).values({ userId, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settings.userId,
      set: { value: sql`coalesce(${settings.value}, '{}'::jsonb) || ${JSON.stringify(value)}::jsonb`, updatedAt: Date.now() },
    }).returning({ value: settings.value });
  return row.value as Json;
}
