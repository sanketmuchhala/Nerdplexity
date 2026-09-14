import type { DataKind, ImportRequest } from '@app/types';
import { db } from './db';
import * as store from './store';

// Before the server kept saved data, it lived in this browser's IndexedDB. The first time an
// account opens the app here, that data is copied to the server. IndexedDB is left as it was.

const IMPORTED_BY = 'nerdplexity:browser-data-imported-by';
/** Keep each request well under the server's 50 MB import limit. */
const BATCH_BYTES = 8_000_000;

/**
 * Copy this browser's saved data to the signed-in account, once. Returns the number of threads
 * copied. Data another account on this browser already imported is not copied again, so a
 * second person signing in here never receives the first person's threads.
 */
export async function importBrowserData(accountId: string): Promise<number> {
  let owner: string | null = null;
  try { owner = localStorage.getItem(IMPORTED_BY); } catch { /* treat as not imported */ }
  if (owner && owner !== accountId) {
    await store.importData({ done: true });
    return 0;
  }

  const [conversations, documents, runs, connections, presets, comparisons, settings] = await Promise.all([
    db.conversations.toArray(), db.documents.toArray(), db.runs.toArray(), db.connections.toArray(),
    db.presets.toArray(), db.comparisons.toArray(), db.settings.get(1),
  ]).catch(() => [[], [], [], [], [], [], undefined] as const);

  const items: [DataKind, unknown][] = [
    ...conversations.map(c => ['conversations', c] as [DataKind, unknown]),
    ...documents.map(d => ['documents', d] as [DataKind, unknown]),
    ...runs.map(r => ['runs', r] as [DataKind, unknown]),
    ...connections.map(c => ['connections', c] as [DataKind, unknown]),
    ...presets.map(p => ['presets', p] as [DataKind, unknown]),
    ...comparisons.map(c => ['comparisons', c] as [DataKind, unknown]),
  ];
  let batch: ImportRequest = {};
  let bytes = 0;
  let threads = 0;
  const send = async (last: boolean) => {
    const result = await store.importData({ ...batch, ...(last ? { done: true, ...(settings ? { settings: withoutKeys(settings) } : {}) } : {}) });
    threads += result.imported.conversations;
    batch = {};
    bytes = 0;
  };
  for (const [kind, record] of items) {
    const size = JSON.stringify(record).length;
    if (bytes && bytes + size > BATCH_BYTES) await send(false);
    (batch[kind] ??= []).push(record);
    bytes += size;
  }
  await send(true);
  try { localStorage.setItem(IMPORTED_BY, accountId); } catch { /* the server also records the import */ }
  return threads;
}

/** Legacy settings carried per-provider API keys; they never leave this browser. */
function withoutKeys(settings: object): Record<string, unknown> {
  const { apiKeys: _keys, ...rest } = settings as Record<string, unknown>;
  return rest;
}
