import os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import type { DiscoveryError, DiscoveryResult, ModelDescriptor } from '@app/types';
import { DestinationError, redact, resolveTarget, ResolvedTarget } from './destinations.js';

type FetchFn = typeof fetch;

const TIMEOUT_MS = 8000;
// OpenAI lists every model family on one endpoint; these cannot serve chat completions.
const OPENAI_NON_CHAT = /(embedding|whisper|tts|dall-e|moderation|davinci|babbage|realtime|transcribe|audio|image|search|computer-use|codex-mini)/i;

class DiscoveryFailure extends Error {
  constructor(public category: DiscoveryError['category'], message: string) { super(message); }
}

function statusFailure(status: number, target: ResolvedTarget, detail: string): DiscoveryFailure {
  if (status === 401 || status === 403) return new DiscoveryFailure('auth', target.apiKey ? 'The provider rejected this API key.' : 'This endpoint requires an API key.');
  if (status === 404) return new DiscoveryFailure('not-found', 'No model list at this address. Check the server URL.');
  if (status === 429) return new DiscoveryFailure('rate-limited', 'The provider is rate limiting requests. Try again later.');
  const safe = redact(detail, target.apiKey).slice(0, 300);
  return new DiscoveryFailure('unknown', `Server returned ${status}${safe ? `: ${safe}` : ''}`);
}

async function getJSON(fetchImpl: FetchFn, url: string, target: ResolvedTarget, init: RequestInit = {}): Promise<any> {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...target.headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw statusFailure(response.status, target, await response.text().catch(() => ''));
  try { return await response.json(); }
  catch { throw new DiscoveryFailure('invalid-response', 'The endpoint did not return JSON. Check the server URL.'); }
}

const withDefaults = (partial: Partial<ModelDescriptor> & { id: string }, pricing: ModelDescriptor['pricing']): ModelDescriptor => ({
  displayName: partial.id,
  capabilities: { tools: null, vision: null },
  pricing,
  source: 'discovered',
  ...partial,
});

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

async function discoverOllama(target: ResolvedTarget, fetchImpl: FetchFn): Promise<ModelDescriptor[]> {
  const tags = await getJSON(fetchImpl, `${target.baseURL}/api/tags`, target);
  if (!Array.isArray(tags?.models)) throw new DiscoveryFailure('invalid-response', 'This endpoint did not return an Ollama model list.');
  // Loaded state and per-model capabilities are best effort; failures leave them unknown.
  const running = await getJSON(fetchImpl, `${target.baseURL}/api/ps`, target).catch(() => null);
  const loaded = Array.isArray(running?.models) ? new Set(running.models.map((m: any) => m.name || m.model)) : null;
  return mapLimited(tags.models, 4, async (m: any) => {
    const id: string = m.name || m.model;
    const show = await getJSON(fetchImpl, `${target.baseURL}/api/show`, target, { method: 'POST', body: JSON.stringify({ model: id }), signal: AbortSignal.timeout(4000) }).catch(() => null);
    const capabilities: string[] | undefined = Array.isArray(show?.capabilities) ? show.capabilities : undefined;
    const contextKey = show?.model_info && Object.keys(show.model_info).find(k => k.endsWith('.context_length'));
    return withDefaults({
      id,
      sizeBytes: Number.isFinite(m.size) ? m.size : undefined,
      details: [m.details?.parameter_size, m.details?.quantization_level, m.details?.family].filter(Boolean).join(' · ') || undefined,
      capabilities: { tools: capabilities ? capabilities.includes('tools') : null, vision: capabilities ? capabilities.includes('vision') : null },
      contextLength: contextKey ? Number(show.model_info[contextKey]) || undefined : undefined,
      loaded: loaded ? loaded.has(id) : undefined,
    }, 'local');
  });
}

async function discoverOpenAIStyle(target: ResolvedTarget, fetchImpl: FetchFn): Promise<ModelDescriptor[]> {
  const data = await getJSON(fetchImpl, `${target.baseURL}/models`, target);
  if (!Array.isArray(data?.data)) throw new DiscoveryFailure('invalid-response', 'This endpoint did not return an OpenAI-compatible model list.');
  const pricing = target.execution === 'local' ? 'local' : 'unknown';
  return data.data
    .filter((m: any) => typeof m?.id === 'string' && !(target.kind === 'openai' && OPENAI_NON_CHAT.test(m.id)))
    .map((m: any) => withDefaults({
      id: m.id,
      displayName: typeof m.name === 'string' ? m.name : m.id,
      contextLength: Number(m.context_length ?? m.context_window) || undefined,
    }, pricing));
}

async function discoverGemini(target: ResolvedTarget, fetchImpl: FetchFn): Promise<ModelDescriptor[]> {
  const models: ModelDescriptor[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
    const data = await getJSON(fetchImpl, `${target.baseURL}/models?${query}`, target);
    if (!Array.isArray(data?.models)) throw new DiscoveryFailure('invalid-response', 'Gemini did not return a model list.');
    for (const m of data.models) {
      if (!m?.supportedGenerationMethods?.includes('generateContent')) continue;
      models.push(withDefaults({
        id: String(m.name).replace(/^models\//, ''),
        displayName: m.displayName || m.name,
        contextLength: Number(m.inputTokenLimit) || undefined,
        maxOutputTokens: Number(m.outputTokenLimit) || undefined,
      }, 'unknown'));
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return models;
}

async function discoverAnthropic(target: ResolvedTarget, fetchImpl: FetchFn): Promise<ModelDescriptor[]> {
  const client = new Anthropic({ apiKey: target.apiKey, maxRetries: 0, timeout: TIMEOUT_MS, fetch: fetchImpl });
  const models: ModelDescriptor[] = [];
  try {
    for await (const m of client.models.list({ limit: 1000 })) {
      models.push(withDefaults({
        id: m.id,
        displayName: m.display_name || m.id,
        capabilities: { tools: null, vision: m.capabilities ? m.capabilities.image_input.supported : null },
        contextLength: m.max_input_tokens ?? undefined,
        maxOutputTokens: m.max_tokens ?? undefined,
      }, 'unknown'));
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new DiscoveryFailure('auth', 'Anthropic rejected this API key.');
    if (error instanceof Anthropic.RateLimitError) throw new DiscoveryFailure('rate-limited', 'Anthropic is rate limiting requests. Try again later.');
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new DiscoveryFailure('timeout', 'Anthropic did not respond in time.');
    if (error instanceof Anthropic.APIConnectionError) throw new DiscoveryFailure('offline', 'Unable to reach Anthropic. Check your network connection.');
    if (error instanceof Anthropic.APIError) throw new DiscoveryFailure('unknown', `Anthropic returned ${error.status ?? 'an error'}.`);
    throw error;
  }
  return models;
}

function classify(error: unknown, target: ResolvedTarget | null): DiscoveryError {
  if (error instanceof DiscoveryFailure) return { category: error.category, message: error.message };
  if (error instanceof DestinationError) return { category: 'invalid-destination', message: error.message };
  const name = (error as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return { category: 'timeout', message: 'The server did not respond in time.' };
  if (error instanceof TypeError) {
    return {
      category: 'offline',
      message: target?.execution === 'local' ? 'Nothing is answering at this address. Start the runtime, then refresh.' : 'Unable to reach this server. Check the address and your network.',
    };
  }
  return { category: 'unknown', message: redact((error as Error)?.message || 'Discovery failed.', target?.apiKey).slice(0, 300) };
}

/** List the models a connection exposes. Never throws; failures are categorized. */
export async function discover(input: unknown, fetchImpl: FetchFn = fetch): Promise<DiscoveryResult> {
  let target: ResolvedTarget | null = null;
  try {
    target = resolveTarget(input);
    const models = target.kind === 'ollama' ? await discoverOllama(target, fetchImpl)
      : target.kind === 'anthropic' ? await discoverAnthropic(target, fetchImpl)
      : target.kind === 'gemini' ? await discoverGemini(target, fetchImpl)
      : await discoverOpenAIStyle(target, fetchImpl);
    models.sort((a, b) => a.id.localeCompare(b.id));
    return {
      ok: true, execution: target.execution, models, checkedAt: Date.now(),
      ...(target.execution === 'local' ? { host: { platform: os.platform(), arch: os.arch(), memory: os.totalmem(), cpus: os.cpus().length } } : {}),
    };
  } catch (error) {
    return { ok: false, error: classify(error, target), checkedAt: Date.now() };
  }
}
