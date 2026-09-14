import path from 'path';
import { mkdirSync } from 'fs';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  /** 'pglite': embedded Postgres in this process. 'postgres': a Postgres server (DATABASE_URL). */
  kind: 'pglite' | 'postgres';
  /** For logs: the data folder, or "DATABASE_URL". Never the URL itself, which holds a password. */
  location: string;
  close: () => Promise<void>;
}

export interface DatabaseOptions {
  /** A Postgres connection URL. Defaults to DATABASE_URL; without one, PGlite is used. */
  url?: string;
  /** PGlite data folder, or "memory://" for a database that lasts only while the process runs. */
  dataDir?: string;
  /** Create the built-in owner used when accounts are off (local mode). */
  seedLocalUser?: boolean;
}

/** The user every request belongs to when the server runs on the user's own computer. */
export const LOCAL_USER_ID = 'local';

export const MIGRATIONS = path.resolve(__dirname, '../../drizzle');
export const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');

/**
 * Open the database and bring its tables up to date. Postgres when a URL is given (Railway),
 * otherwise PGlite, the same Postgres engine embedded in this process, storing its files in
 * NERDPLEXITY_DATA_DIR (default backend/data).
 */
export async function openDatabase(options: DatabaseOptions = {}): Promise<DatabaseHandle> {
  const url = options.url ?? process.env.DATABASE_URL?.trim();
  let handle: DatabaseHandle;
  if (url) {
    // DATABASE_POOL_SIZE: connections to keep open (default 10; small Postgres plans allow few).
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE) || 10, onnotice: () => undefined });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder: MIGRATIONS });
    handle = { db: db as unknown as Database, kind: 'postgres', location: 'DATABASE_URL', close: () => client.end({ timeout: 5 }) };
  } else {
    const dataDir = options.dataDir ?? (process.env.NERDPLEXITY_DATA_DIR?.trim() || DEFAULT_DATA_DIR);
    const memory = dataDir.startsWith('memory://');
    if (!memory) mkdirSync(dataDir, { recursive: true });
    const client = new PGlite(memory ? undefined : dataDir);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS });
    handle = { db: db as unknown as Database, kind: 'pglite', location: memory ? 'memory' : dataDir, close: () => client.close() };
  }
  if (options.seedLocalUser) {
    await handle.db.insert(schema.user)
      .values({ id: LOCAL_USER_ID, name: 'Owner', email: 'owner@localhost', emailVerified: true })
      .onConflictDoNothing();
  }
  return handle;
}
