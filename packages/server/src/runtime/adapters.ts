import Anthropic from '@anthropic-ai/sdk';
import type { ProviderError, RunMessage, Usage } from '@app/types';
import { readLines } from './streams.js';
import { redact, ResolvedTarget } from './destinations.js';

type FetchFn = typeof fetch;

export interface ModelRequest {
  target: ResolvedTarget;
  model: string;
  messages: RunMessage[];
  temperature?: number;
  maxTokens?: number;
  numCtx?: number;
}

export type AdapterEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'status'; message: string }
  | { type: 'done'; usage?: Usage; finishReason?: string };

export class ProviderFailure extends Error {
  constructor(public error: ProviderError) { super(error.message); }
}

const DEFAULT_MAX_TOKENS = 2048;
const INCOMPLETE = 'The stream ended before the model finished. The partial answer was kept.';
const LABEL: Record<ResolvedTarget['kind'], string> = {
  ollama: 'Ollama', 'openai-compatible': 'The endpoint', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', deepseek: 'DeepSeek',
};

function retryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Map an HTTP failure to a safe, categorized provider error. */
export function failureFromStatus(status: number, detail: string, target: ResolvedTarget, retryAfterHeader?: string | null): ProviderFailure {
  const label = LABEL[target.kind];
  const text = redact(detail, target.apiKey).replace(/\s+/g, ' ').trim().slice(0, 300);
  const make = (category: ProviderError['category'], message: string, retryable: boolean) =>
    new ProviderFailure({ category, message, retryable, ...(retryAfter(retryAfterHeader) !== undefined ? { retryAfterMs: retryAfter(retryAfterHeader) } : {}) });
  if (status === 401 || status === 403) return make('auth', `${label} rejected the API key.`, false);
  if (status === 429) return make('quota', `${label} is rate limiting requests or the quota is used up.${text ? ` ${text}` : ''}`, true);
  if (status === 404) return make('invalid-request', `${label} could not find this model.${text ? ` ${text}` : ''}`, false);
  if (status === 400 || status === 413 || status === 422) {
    const context = /context|too long|too many tokens|maximum.*tokens|token limit|prompt is too long/i.test(text);
    return make(context ? 'context' : 'invalid-request', `${label} rejected the request${text ? `: ${text}` : '.'}`, false);
  }
  if (status >= 500) return make('unavailable', `${label} is unavailable (${status}).${text ? ` ${text}` : ''}`, true);
  return make('unknown', `${label} returned ${status}${text ? `: ${text}` : '.'}`, false);
}

function providerMessage(body: string): string {
  try {
    const data = JSON.parse(body);
    const error = Array.isArray(data) ? data[0]?.error : data.error;
    if (typeof error === 'string') return error;
    if (typeof error?.message === 'string') return error.message;
  } catch { /* not JSON */ }
  return body;
}

async function post(fetchImpl: FetchFn, url: string, target: ResolvedTarget, body: unknown, signal: AbortSignal): Promise<Response> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...target.headers },
    body: JSON.stringify(body),
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw failureFromStatus(response.status, providerMessage(await response.text().catch(() => '')), target, response.headers.get('retry-after'));
  if (!response.body) throw new ProviderFailure({ category: 'transport', message: `${LABEL[target.kind]} returned an empty stream.`, retryable: true });
  return response;
}

/** Read stream lines. A connection that drops mid-body means an incomplete answer, not an unreachable server. */
async function* bodyLines(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  try {
    yield* readLines(response.body!);
  } catch (error) {
    if (!signal.aborted && error instanceof TypeError) throw new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
    throw error;
  }
}

const rejectsTemperature = (error: unknown) =>
  error instanceof ProviderFailure && error.error.category === 'invalid-request' && /temperature/i.test(error.message);
const TEMPERATURE_NOTICE = 'This model does not accept a temperature setting; using its default.';

function parseRecord(payload: string, target: ResolvedTarget): any {
  try { return JSON.parse(payload); }
  catch { throw new ProviderFailure({ category: 'transport', message: `${LABEL[target.kind]} sent a malformed stream record.`, retryable: true }); }
}

const normalizeUsage = (prompt: unknown, completion: unknown): Usage | undefined =>
  Number.isFinite(prompt) && Number.isFinite(completion)
    ? { prompt_tokens: prompt as number, completion_tokens: completion as number, total_tokens: (prompt as number) + (completion as number) }
    : undefined;

/** OpenAI, DeepSeek, and OpenAI-compatible servers share the chat completions SSE format. */
async function* streamOpenAIStyle(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const body: Record<string, unknown> = {
    model: req.model, messages: req.messages, stream: true, stream_options: { include_usage: true },
    // OpenAI replaced max_tokens with max_completion_tokens; other servers still use max_tokens.
    [target.kind === 'openai' ? 'max_completion_tokens' : 'max_tokens']: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
  const url = `${target.baseURL}/chat/completions`;
  let response: Response;
  try { response = await post(fetchImpl, url, target, body, signal); }
  catch (error) {
    if (!rejectsTemperature(error) || body.temperature === undefined) throw error;
    // A validation rejection happens before generation, so resending cannot duplicate output or billing.
    yield { type: 'status', message: TEMPERATURE_NOTICE };
    delete body.temperature;
    response = await post(fetchImpl, url, target, body, signal);
  }
  let usage: Usage | undefined;
  let finishReason: string | undefined;
  let done = false;
  for await (const line of bodyLines(response, signal)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') { done = true; break; }
    if (!payload) continue;
    const data = parseRecord(payload, target);
    if (data.error) throw failureFromStatus(Number(data.error.code) || 500, providerMessage(JSON.stringify(data)), target);
    const choice = data.choices?.[0];
    const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
    if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
    const text = choice?.delta?.content;
    if (typeof text === 'string' && text) yield { type: 'delta', text };
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    usage = normalizeUsage(data.usage?.prompt_tokens, data.usage?.completion_tokens) ?? usage;
  }
  // Some servers omit [DONE]; a reported finish reason still marks a complete answer.
  if (!done && !finishReason) throw new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
  yield { type: 'done', usage, finishReason };
}

async function* streamOllama(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const response = await post(fetchImpl, `${target.baseURL}/api/chat`, target, {
    model: req.model, messages: req.messages, stream: true,
    options: { num_predict: req.maxTokens ?? DEFAULT_MAX_TOKENS, num_ctx: req.numCtx ?? 8192, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
  }, signal);
  for await (const line of bodyLines(response, signal)) {
    const data = parseRecord(line, target);
    if (data.error) throw failureFromStatus(500, String(data.error), target);
    const thinking = data.message?.thinking;
    if (typeof thinking === 'string' && thinking) yield { type: 'reasoning', text: thinking };
    const text = data.message?.content;
    if (typeof text === 'string' && text) yield { type: 'delta', text };
    if (data.done) {
      yield { type: 'done', usage: normalizeUsage(data.prompt_eval_count, data.eval_count), finishReason: data.done_reason };
      return;
    }
  }
  throw new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
}

/** Gemini needs alternating roles; merge consecutive turns from the same side. */
function geminiContents(messages: RunMessage[]) {
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last?.role === role) last.parts[0].text += `\n\n${message.content}`;
    else contents.push({ role, parts: [{ text: message.content }] });
  }
  return contents;
}

const systemText = (messages: RunMessage[]) => messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
const GEMINI_BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

async function* streamGemini(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const system = systemText(req.messages);
  const body: Record<string, any> = {
    contents: geminiContents(req.messages),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
  };
  // alt=sse selects the event-stream format; the key stays in the x-goog-api-key header.
  const url = `${target.baseURL}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
  const response = await post(fetchImpl, url, target, body, signal);
  let usage: Usage | undefined;
  let finishReason: string | undefined;
  for await (const line of bodyLines(response, signal)) {
    if (!line.startsWith('data:')) continue;
    const data = parseRecord(line.slice(5).trim(), target);
    if (data.error) throw failureFromStatus(Number(data.error.code) || 500, providerMessage(JSON.stringify(data)), target);
    if (data.promptFeedback?.blockReason) throw new ProviderFailure({ category: 'refused', message: `Gemini blocked this prompt (${data.promptFeedback.blockReason}).`, retryable: false });
    const candidate = data.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text !== 'string' || !part.text) continue;
      yield part.thought ? { type: 'reasoning', text: part.text } : { type: 'delta', text: part.text };
    }
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    const meta = data.usageMetadata;
    if (meta) usage = normalizeUsage(meta.promptTokenCount, meta.candidatesTokenCount ?? 0) ?? usage;
  }
  if (!finishReason) throw new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
  if (GEMINI_BLOCKED.has(finishReason)) throw new ProviderFailure({ category: 'refused', message: `Gemini stopped the answer (${finishReason}). The partial answer was kept.`, retryable: false });
  yield { type: 'done', usage, finishReason: finishReason.toLowerCase() };
}

function anthropicFailure(error: unknown, target: ResolvedTarget, streamed: boolean): unknown {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderFailure({ category: 'timeout', message: 'Anthropic did not respond in time.', retryable: true });
  if (error instanceof Anthropic.APIUserAbortError) return error;
  // A stream cut after output began surfaces as a TypeError or as the SDK's base error wrapping one.
  const dropped = error instanceof TypeError || (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError) && (error as { cause?: unknown }).cause instanceof TypeError);
  if (streamed && dropped) return new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderFailure({ category: 'transport', message: streamed ? INCOMPLETE : 'Unable to reach Anthropic. Check your network connection.', retryable: true });
  }
  if (error instanceof Anthropic.APIError) {
    const body = error.error as any;
    const detail = typeof body?.error?.message === 'string' ? body.error.message : error.message;
    // 529 means overloaded; treat like other server-side unavailability.
    return failureFromStatus(error.status ?? 500, detail, target, error.headers?.get('retry-after'));
  }
  return error;
}

async function* streamAnthropic(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const client = new Anthropic({ apiKey: target.apiKey, maxRetries: 0, timeout: 600_000, fetch: fetchImpl });
  const system = systemText(req.messages);
  const params: Anthropic.MessageStreamParams = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: req.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ...(system ? { system } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const stream = client.messages.stream(params, { signal });
    let streamed = false;
    try {
      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type === 'text_delta' && event.delta.text) { streamed = true; yield { type: 'delta', text: event.delta.text }; }
        if (event.delta.type === 'thinking_delta' && event.delta.thinking) { streamed = true; yield { type: 'reasoning', text: event.delta.thinking }; }
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        const explanation = (message as any).stop_details?.explanation;
        throw new ProviderFailure({ category: 'refused', message: `Claude declined to continue${explanation ? `: ${explanation}` : '.'} The partial answer was kept.`, retryable: false });
      }
      const usage = message.usage;
      const input = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      yield { type: 'done', usage: normalizeUsage(input, usage.output_tokens), finishReason: message.stop_reason ?? undefined };
      return;
    } catch (error) {
      const failure = anthropicFailure(error, target, streamed);
      // Newer Claude models reject sampling parameters; this is a pre-generation validation error.
      if (attempt === 0 && !streamed && params.temperature !== undefined && rejectsTemperature(failure)) {
        yield { type: 'status', message: TEMPERATURE_NOTICE };
        delete params.temperature;
        continue;
      }
      throw failure;
    }
  }
}

/** Stream one model response. Throws ProviderFailure for provider errors; rethrows aborts. */
export async function* streamModel(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn = fetch): AsyncGenerator<AdapterEvent> {
  const source = req.target.kind === 'ollama' ? streamOllama(req, signal, fetchImpl)
    : req.target.kind === 'anthropic' ? streamAnthropic(req, signal, fetchImpl)
    : req.target.kind === 'gemini' ? streamGemini(req, signal, fetchImpl)
    : streamOpenAIStyle(req, signal, fetchImpl);
  try {
    yield* source;
  } catch (error) {
    if (signal.aborted || error instanceof ProviderFailure) throw error;
    const name = (error as Error)?.name;
    if (name === 'TimeoutError') throw new ProviderFailure({ category: 'timeout', message: `${LABEL[req.target.kind]} did not respond in time.`, retryable: true });
    if (error instanceof TypeError) {
      throw new ProviderFailure({
        category: 'transport', retryable: true,
        message: req.target.execution === 'local' ? 'Unable to reach the model server. Check that it is running.' : `Unable to reach ${LABEL[req.target.kind]}. Check your network connection.`,
      });
    }
    throw new ProviderFailure({ category: 'unknown', message: redact((error as Error)?.message || 'The model request failed.', req.target.apiKey).slice(0, 300), retryable: false });
  }
}
