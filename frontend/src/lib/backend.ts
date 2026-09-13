/**
 * Where the Nerdplexity backend runs. Empty means the same origin (local dev through the Vite
 * proxy, or the backend serving the built app). A hosted frontend, such as on Vercel, sets
 * VITE_API_URL at build time to a separately deployed backend.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

export const apiUrl = (path: string) => `${API_BASE}${path}`;

/** Message for a request that got no usable answer from the backend. */
export const unreachableMessage = () => API_BASE
  ? `The Nerdplexity server at ${API_BASE} is not responding.`
  : 'The Nerdplexity server is not responding. Start it with pnpm dev.';
