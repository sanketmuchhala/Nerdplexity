import { db } from './db';
import * as credentials from './credentials';
import useConnections from '../state/connections';

/** The Exa key uses the same session-only or remembered storage as provider keys, under a reserved ID. */
export const EXA_KEY_ID = 'search:exa';

export const hasSearchKey = () => credentials.hasKey(EXA_KEY_ID);
export const searchKey = () => credentials.getKey(EXA_KEY_ID);
export const searchKeyRemembered = async () => !!(await db.credentials.get(EXA_KEY_ID));

export async function setSearchKey(key: string, remember: boolean) {
  await credentials.setKey(EXA_KEY_ID, key, remember);
  useConnections.getState().keysChanged();
}

export async function clearSearchKey() {
  await credentials.clearKey(EXA_KEY_ID);
  useConnections.getState().keysChanged();
}
