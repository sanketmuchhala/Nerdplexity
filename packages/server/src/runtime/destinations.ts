import type { ConnectionKind, ConnectionTarget, ExecutionLocation } from '@app/types';

export const CONNECTION_KINDS: readonly ConnectionKind[] = ['ollama', 'openai-compatible', 'openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'groq'];

/** Hosted providers use fixed endpoints so a stored key can only reach its own provider. */
const HOSTED: Partial<Record<ConnectionKind, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/**
 * NERDPLEXITY_HOSTED=1 marks a server deployed for others to reach (Render, Railway). There,
 * "this machine" is the cloud server, so local runtimes and private-network addresses are refused:
 * otherwise a request could make the server probe its own internal network.
 */
export const hostedMode = () => ['1', 'true', 'yes'].includes((process.env.NERDPLEXITY_HOSTED ?? '').toLowerCase());

/**
 * Non-public addresses: IPv4 loopback, private, link-local, and other reserved ranges, any IPv6
 * literal (providers are reached by name), and local-only names.
 */
function privateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith('[')) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal');
}

export class DestinationError extends Error {}

export interface ResolvedTarget {
  kind: ConnectionKind;
  baseURL: string;
  execution: ExecutionLocation;
  apiKey?: string;
  /** Auth headers for fetch-based adapters. Anthropic uses its SDK instead. */
  headers: Record<string, string>;
}

export function isConnectionKind(value: unknown): value is ConnectionKind {
  return typeof value === 'string' && (CONNECTION_KINDS as readonly string[]).includes(value);
}

function normalizeBase(kind: ConnectionKind, input: string | undefined): { baseURL: string; execution: ExecutionLocation } {
  const hosted = HOSTED[kind];
  if (hosted) return { baseURL: hosted, execution: 'remote' };
  if (!input?.trim()) throw new DestinationError('Enter the server address for this connection.');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new DestinationError('Enter a full URL, such as http://127.0.0.1:11434.'); }
  if (url.username || url.password || url.search || url.hash) throw new DestinationError('Remove credentials, query strings, and fragments from the URL. Enter keys in the API key field.');
  const local = LOOPBACK.has(url.hostname);
  if (hostedMode() && (local || privateAddress(url.hostname))) {
    throw new DestinationError('This Nerdplexity server is hosted, so it cannot reach models on your computer or a private network. Run Nerdplexity locally to use Ollama or LM Studio.');
  }
  if (local ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:') {
    throw new DestinationError(local ? 'Use http or https.' : 'Remote endpoints must use https. Plain http is allowed only for this machine.');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (kind === 'ollama') {
    if (!local) throw new DestinationError('Ollama connections must point at this machine, such as http://127.0.0.1:11434.');
    if (pathname) throw new DestinationError('Use the Ollama server URL without /api.');
    url.pathname = '';
  } else {
    // Compatible servers differ (/v1, /api/v1, /openai/v1). A bare host means /v1.
    url.pathname = pathname || '/v1';
  }
  return { baseURL: url.toString().replace(/\/+$/, ''), execution: local ? 'local' : 'remote' };
}

function authHeaders(kind: ConnectionKind, apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  if (kind === 'gemini') return { 'x-goog-api-key': apiKey };
  if (kind === 'anthropic') return {};
  return { Authorization: `Bearer ${apiKey}` };
}

/** Validate a client-supplied connection target against the destination policy. */
export function resolveTarget(input: unknown): ResolvedTarget {
  if (!input || typeof input !== 'object') throw new DestinationError('A connection is required.');
  const { kind, baseURL, apiKey } = input as ConnectionTarget;
  if (!isConnectionKind(kind)) throw new DestinationError('Unknown connection type.');
  if (baseURL !== undefined && typeof baseURL !== 'string') throw new DestinationError('Server address must be text.');
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 1000)) throw new DestinationError('API key must be text.');
  const key = apiKey?.trim() || undefined;
  if (HOSTED[kind] && !key) throw new DestinationError('Add an API key for this provider.');
  const { baseURL: base, execution } = normalizeBase(kind, baseURL);
  return { kind, baseURL: base, execution, apiKey: key, headers: authHeaders(kind, key) };
}

/** Remove a key from text that may be shown to the user. */
export function redact(text: string, apiKey?: string): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}
