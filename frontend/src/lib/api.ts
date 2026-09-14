import { apiUrl, unreachableMessage } from './backend';

// Requests to the Nerdplexity server, signed in when the server has accounts.

const TOKEN_KEY = 'nerdplexity:session';
let token: string | null = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage unavailable: sign in each visit */ }

/**
 * The session token from signing in. Kept in this browser and sent as a bearer header, because
 * the web app and a hosted server are usually on different sites, where cookies are blocked.
 */
export const session = {
  get token() { return token; },
  set(value: string) {
    token = value;
    try { localStorage.setItem(TOKEN_KEY, value); } catch { /* kept for this page only */ }
  },
  clear() {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ }
  },
};

/** Headers that identify the signed-in user, for requests made outside `api`. */
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

/** The server needs a signed-in account (none, or the session expired). */
export class AuthRequired extends Error {
  constructor() { super('Sign in to continue.'); }
}

let onAuthRequired: (() => void) | null = null;
/** Called when any request finds the session missing or expired, to show sign-in. */
export const whenAuthRequired = (handler: () => void) => { onAuthRequired = handler; };

/** The server rejected the session: forget it, show sign-in, and stop the caller. */
export function sessionEnded(): never {
  session.clear();
  onAuthRequired?.();
  throw new AuthRequired();
}

/** A request to the server that failed with its own explanation. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export async function api<T = void>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeaders() },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: init.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(unreachableMessage());
  }
  if (response.status === 401) sessionEnded();
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => undefined);
  // A reply that is not JSON came from something other than the Nerdplexity server (a static host).
  if (data === undefined) throw new Error(unreachableMessage());
  if (!response.ok) throw new ApiError(data?.error || data?.message || `The server could not complete this (${response.status}).`, response.status, data?.code);
  return data as T;
}
