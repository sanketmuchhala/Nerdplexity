import { readLines } from './streams.js';
import { redact, resolveTarget } from './destinations.js';

export type RuntimeKind = 'ollama' | 'openai-compatible';
export type RuntimeMessage = { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; tool_name?: string };
export type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
export type RunEvent =
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; input: unknown; output: unknown; step: number }
  | { type: 'done'; usage?: Usage; duration_ms: number; ttft_ms?: number }
  | { type: 'error'; message: string };
export interface LocalRequest {
  runtime: RuntimeKind;
  baseURL?: string;
  model: string;
  messages: RuntimeMessage[];
  temperature?: number;
  max_tokens?: number;
  num_ctx?: number;
  /** Auth headers from the resolved connection. Never logged or echoed. */
  headers?: Record<string, string>;
}

/** Validates a runtime address against the shared destination policy. */
export function runtimeURL(kind: RuntimeKind, input?: string): string {
  return resolveTarget({ kind, baseURL: input || (kind === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234/v1') }).baseURL;
}

export async function fetchRuntime(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: 'error' });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('The endpoint rejected the API key.');
    // Remote endpoints may echo request details; strip auth values and bound the text for the UI.
    let detail = (await response.text()).slice(0, 300);
    for (const value of Object.values((init.headers ?? {}) as Record<string, string>)) {
      const secret = value.replace(/^Bearer /, '');
      if (secret.length >= 8) detail = redact(detail, secret);
    }
    throw new Error(`Runtime returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response;
}

export function generationBody(request: LocalRequest, stream: boolean, tools?: unknown[]) {
  const common = { model: request.model, messages: request.messages, stream, ...(tools ? { tools } : {}) };
  if (request.runtime === 'ollama') {
    return { ...common, options: { temperature: request.temperature ?? 0.7, num_predict: request.max_tokens ?? 2048, num_ctx: request.num_ctx ?? 8192 } };
  }
  return { ...common, temperature: request.temperature ?? 0.7, max_tokens: request.max_tokens ?? 2048, ...(stream ? { stream_options: { include_usage: true } } : {}) };
}

export function extractUsage(data: any, runtime: RuntimeKind): Usage | undefined {
  if (runtime === 'ollama' && Number.isFinite(data.eval_count) && Number.isFinite(data.prompt_eval_count)) {
    return { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count, total_tokens: data.prompt_eval_count + data.eval_count };
  }
  if (runtime === 'openai-compatible' && Number.isFinite(data.usage?.prompt_tokens) && Number.isFinite(data.usage?.completion_tokens)) {
    return { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.prompt_tokens + data.usage.completion_tokens };
  }
}

export async function requestCompletion(request: LocalRequest, signal: AbortSignal, tools?: unknown[]) {
  const base = runtimeURL(request.runtime, request.baseURL);
  const response = await fetchRuntime(`${base}/${request.runtime === 'ollama' ? 'api/chat' : 'chat/completions'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...request.headers },
    body: JSON.stringify(generationBody(request, false, tools)), signal,
  });
  const data = await response.json();
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Runtime failed.');
  const message = request.runtime === 'ollama' ? data.message : data.choices?.[0]?.message;
  if (!message || typeof message !== 'object') throw new Error('Runtime returned no assistant message.');
  return { message, usage: extractUsage(data, request.runtime) };
}

export async function* streamChat(request: LocalRequest, signal: AbortSignal): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const base = runtimeURL(request.runtime, request.baseURL);
  let firstToken: number | undefined;
  let usage: Usage | undefined;
  let completed = false;
  yield { type: 'status', message: 'Waiting for the model' };
  const response = await fetchRuntime(`${base}/${request.runtime === 'ollama' ? 'api/chat' : 'chat/completions'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...request.headers },
    body: JSON.stringify(generationBody(request, true)), signal,
  });
  if (!response.body) throw new Error('Runtime returned an empty stream.');
  for await (const line of readLines(response.body)) {
    signal.throwIfAborted();
    let payload = line;
    if (request.runtime === 'openai-compatible') {
      if (!line.startsWith('data:')) continue;
      payload = line.slice(5).trim();
      if (payload === '[DONE]') { completed = true; break; }
      if (!payload) continue;
    }
    const data = JSON.parse(payload);
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Generation failed.');
    const text = request.runtime === 'ollama' ? data.message?.content : data.choices?.[0]?.delta?.content;
    if (typeof text === 'string' && text) {
      firstToken ??= Date.now() - start;
      yield { type: 'delta', text };
    }
    usage = extractUsage(data, request.runtime) ?? usage;
    if (data.done || data.choices?.[0]?.finish_reason) completed = true;
    if (data.done) break;
  }
  if (!completed) throw new Error('The model stream ended before completion. The partial answer has been kept.');
  yield { type: 'done', usage, duration_ms: Date.now() - start, ttft_ms: firstToken };
}
