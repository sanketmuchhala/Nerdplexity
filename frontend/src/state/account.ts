import { create } from 'zustand';
import type { AccountInfo } from '@app/types';
import { apiUrl, unreachableMessage } from '../lib/backend';
import { authHeaders, session } from '../lib/api';
import * as store from '../lib/store';

interface AccountStore {
  /** Who is signed in; the built-in owner on a server without accounts. */
  account?: AccountInfo;
  /** Threads copied from this browser's earlier storage at startup, to announce once. */
  importedThreads?: number;
  load: () => Promise<AccountInfo>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** Messages for the account errors people can act on. */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password do not match an account.',
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists. Sign in instead.',
  PASSWORD_TOO_SHORT: 'Use a password of at least 8 characters.',
  PASSWORD_TOO_LONG: 'Use a password of at most 128 characters.',
  INVALID_EMAIL: 'Enter a valid email address.',
};

async function authRequest(path: string, body: object): Promise<{ token?: string }> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/v1/auth${path}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error(unreachableMessage());
  }
  const data = await response.json().catch(() => null);
  if (response.status === 429) throw new Error('Too many attempts. Wait a minute, then try again.');
  if (!response.ok) throw new Error(MESSAGES[data?.code] ?? data?.message ?? `The server could not complete this (${response.status}).`);
  return data ?? {};
}

const useAccount = create<AccountStore>((set) => ({
  load: async () => {
    const account = await store.account();
    set({ account });
    return account;
  },
  signIn: async (email, password) => {
    const { token } = await authRequest('/sign-in/email', { email: email.trim(), password });
    if (!token) throw new Error('The server did not return a session.');
    session.set(token);
  },
  signUp: async (name, email, password) => {
    const { token } = await authRequest('/sign-up/email', { name: name.trim() || email.trim().split('@')[0], email: email.trim(), password });
    if (!token) throw new Error('The server did not return a session.');
    session.set(token);
  },
  signOut: async () => {
    // Forget the session here even if the server cannot be reached; it expires on its own.
    await authRequest('/sign-out', {}).catch(() => undefined);
    session.clear();
    set({ account: undefined });
  },
}));

export default useAccount;
