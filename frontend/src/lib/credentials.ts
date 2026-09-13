import { db } from './db';

// Keys for the current page session. Device-remembered keys are mirrored here
// after loading so requests can read them synchronously.
const keys = new Map<string, string>();

export async function loadRememberedKeys() {
  keys.clear();
  for (const credential of await db.credentials.toArray()) keys.set(credential.connectionId, credential.key);
}

export const getKey = (connectionId: string) => keys.get(connectionId) || '';
export const hasKey = (connectionId: string) => keys.has(connectionId);

/** Store a key for this session, and on this device only when `remember` is true. */
export async function setKey(connectionId: string, key: string, remember: boolean) {
  const trimmed = key.trim();
  if (!trimmed) return clearKey(connectionId);
  keys.set(connectionId, trimmed);
  if (remember) await db.credentials.put({ connectionId, key: trimmed, savedAt: Date.now() });
  else await db.credentials.delete(connectionId);
}

export async function clearKey(connectionId: string) {
  keys.delete(connectionId);
  await db.credentials.delete(connectionId);
}

export const maskKey = (key: string) => (key.length <= 8 ? '••••••••' : `${key.slice(0, 3)}••••${key.slice(-4)}`);
