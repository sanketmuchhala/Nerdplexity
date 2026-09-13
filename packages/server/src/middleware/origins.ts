import type { RequestHandler } from 'express';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Exact origins allowed besides this machine, from ALLOWED_ORIGINS (comma-separated), for a
 * frontend hosted elsewhere, for example "https://nerdplexity.vercel.app". Trailing slashes are
 * ignored; wildcards are not supported.
 */
export function allowedOrigins(value = process.env.ALLOWED_ORIGINS ?? ''): Set<string> {
  const origins = new Set<string>();
  for (const entry of value.split(',')) {
    const trimmed = entry.trim().replace(/\/+$/, '');
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.origin === trimmed && ['http:', 'https:'].includes(url.protocol)) origins.add(url.origin);
    } catch { /* ignore malformed entries */ }
  }
  return origins;
}

/** Whether a browser page at this origin may call the API. */
export function originAllowed(origin: string, extra: ReadonlySet<string>): boolean {
  try {
    const url = new URL(origin);
    return LOOPBACK_HOSTS.has(url.hostname) || extra.has(url.origin);
  } catch {
    return false;
  }
}

/** Reject browser requests from unrelated sites before they reach runtimes or providers. */
export function originGuard(extra: ReadonlySet<string>): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin, extra)) {
      res.status(403).json({ error: extra.size ? 'This site is not allowed to use this Nerdplexity server.' : 'Open Nerdplexity on localhost.' });
      return;
    }
    next();
  };
}
