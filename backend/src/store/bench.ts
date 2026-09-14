import { randomUUID } from 'crypto';
import { and, desc, eq, max, sql } from 'drizzle-orm';
import type { BenchCategory, BenchResult, BenchScore } from '@app/types';
import type { Database } from '../db/client.js';
import { benchResults } from '../db/schema.js';

// Bench results. Every function takes the owner's ID and never reads or writes another user's rows.

export async function saveBenchResult(db: Database, userId: string, result: BenchResult) {
  await db.insert(benchResults).values({
    userId, id: randomUUID(), connectionId: result.connectionId, model: result.model, itemId: result.itemId, category: result.category,
    status: result.status, detail: result.detail ?? null, latencyMs: result.latencyMs ?? null, ttftMs: result.ttftMs ?? null, at: result.at,
  });
}

/** Pass, fail, and error counts per model and category, from every saved result. */
export async function benchScores(db: Database, userId: string): Promise<BenchScore[]> {
  const rows = await db.select({
    connectionId: benchResults.connectionId, model: benchResults.model, category: benchResults.category,
    passed: sql<number>`count(*) filter (where ${benchResults.status} = 'passed')`,
    failed: sql<number>`count(*) filter (where ${benchResults.status} = 'failed')`,
    errors: sql<number>`count(*) filter (where ${benchResults.status} = 'error')`,
    latencyMs: sql<number | null>`avg(${benchResults.latencyMs}) filter (where ${benchResults.status} <> 'error')`,
    lastAt: max(benchResults.at),
  }).from(benchResults).where(eq(benchResults.userId, userId))
    .groupBy(benchResults.connectionId, benchResults.model, benchResults.category);
  return rows.map(row => ({
    connectionId: row.connectionId, model: row.model, category: row.category as BenchCategory,
    passed: Number(row.passed), failed: Number(row.failed), errors: Number(row.errors),
    ...(row.latencyMs !== null ? { latencyMs: Math.round(Number(row.latencyMs)) } : {}),
    lastAt: Number(row.lastAt),
  }));
}

export async function recentBenchResults(db: Database, userId: string, limit = 200): Promise<BenchResult[]> {
  const rows = await db.select().from(benchResults).where(eq(benchResults.userId, userId)).orderBy(desc(benchResults.at)).limit(limit);
  return rows.map(row => ({
    connectionId: row.connectionId, model: row.model, itemId: row.itemId, category: row.category as BenchCategory,
    status: row.status as BenchResult['status'], at: row.at,
    ...(row.detail !== null ? { detail: row.detail } : {}),
    ...(row.latencyMs !== null ? { latencyMs: row.latencyMs } : {}),
    ...(row.ttftMs !== null ? { ttftMs: row.ttftMs } : {}),
  }));
}

/** Delete all results, or one model's. Returns how many were removed. */
export async function clearBenchResults(db: Database, userId: string, only?: { connectionId: string; model: string }) {
  const where = only
    ? and(eq(benchResults.userId, userId), eq(benchResults.connectionId, only.connectionId), eq(benchResults.model, only.model))
    : eq(benchResults.userId, userId);
  return (await db.delete(benchResults).where(where).returning({ id: benchResults.id })).length;
}
