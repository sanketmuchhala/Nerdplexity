/**
 * Where the Nerdplexity backend runs. Empty means the same origin (local dev through the Vite
 * proxy, or the backend serving the built app). A hosted frontend, such as on Vercel, sets
 * VITE_API_URL at build time to a separately deployed backend.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

export const apiUrl = (path: string) => `${API_BASE}${path}`;

/** True when the backend answers its health check with the expected JSON. */
export async function backendReachable(signal?: AbortSignal): Promise<boolean> {
  try {
    // Under /v1 so the Vite dev proxy forwards it; a plain /health would be answered by Vite itself.
    const response = await fetch(apiUrl('/v1/health'), { signal, cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return data?.status === 'ok';
  } catch {
    return false;
  }
}
