import Anthropic from '@anthropic-ai/sdk';
import type { ProviderError, RateLimitState, RunMessage, Usage } from '@app/types';
import { readLines } from './streams.js';
import { redact, ResolvedTarget } from './destinations.js';

type FetchFn = typeof fetch;

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** JSON text as the model produced it; may be malformed. */
  arguments: string;
  /** The provider sent no ID; this one was generated and is not sent back to providers that issue their own. */
  generatedId?: boolean;
  /** Gemini thought signature, which must be returned with the call. */
  signature?: string;
}

/** Conversation turns sent to a model, including the tool turns of a tool-enabled run. */
export type ModelMessage =
  | RunMessage
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ModelRequest {
  target: ResolvedTarget;
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  numCtx?: number;
  tools?: ToolSpec[];
}

export type AdapterEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'status'; message: string }
  | { type: 'quota'; quota: RateLimitState }
  | { type: 'done'; usage?: Usage; finishReason?: string; loadMs?: number; toolCalls?: ToolCall[] };

export class ProviderFailure extends Error {
  constructor(public error: ProviderError) { super(error.message); }
}

const DEFAULT_MAX_TOKENS = 2048;
/** A rate-limited request never reached the model, so a short wait and resend cannot duplicate output or billing. */
const MAX_AUTO_WAIT_MS = 10_000;
const MAX_AUTO_RETRIES = 2;
const INCOMPLETE = 'The stream ended before the model finished. The partial answer was kept.';
const LABEL: Record<ResolvedTarget['kind'], string> = {
  ollama: 'Ollama', 'openai-compatible': 'The endpoint', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', deepseek: 'DeepSeek',
  openrouter: 'OpenRouter', groq: 'Groq',
};
// These providers replaced max_tokens with max_completion_tokens.
const COMPLETION_TOKENS_PARAM = new Set<ResolvedTarget['kind']>(['openai', 'groq']);

function retryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Wait time from Retry-After, or from an epoch reset time (OpenRouter's X-RateLimit-Reset). */
export function retryAfterFrom(headers: Headers | undefined): number | undefined {
  const explicit = retryAfter(headers?.get('retry-after'));
  if (explicit !== undefined) return explicit;
  const reset = Number(headers?.get('x-ratelimit-reset'));
  if (!Number.isFinite(reset) || reset <= 0) return undefined;
  const resetMs = reset > 1e12 ? reset : reset > 1e9 ? reset * 1000 : undefined;
  return resetMs === undefined ? undefined : Math.max(0, resetMs - Date.now());
}

/** Parse durations such as "2m59.56s", "7.66s", "6ms", or "1h2m". */
export function parseDuration(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    total += Number(amount) * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1);
  }
  return matched ? Math.round(total) : undefined;
}

/** Rate-limit state from x-ratelimit-* headers, when the provider sends them. */
export function quotaFrom(headers: Headers): RateLimitState | undefined {
  const num = (name: string) => { const v = headers.get(name); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };
  const quota: RateLimitState = {
    requestsLimit: num('x-ratelimit-limit-requests') ?? num('x-ratelimit-limit'),
    requestsRemaining: num('x-ratelimit-remaining-requests') ?? num('x-ratelimit-remaining'),
    requestsResetMs: parseDuration(headers.get('x-ratelimit-reset-requests')),
    tokensLimit: num('x-ratelimit-limit-tokens'),
    tokensRemaining: num('x-ratelimit-remaining-tokens'),
    tokensResetMs: parseDuration(headers.get('x-ratelimit-reset-tokens')),
  };
  const present = Object.fromEntries(Object.entries(quota).filter(([, v]) => v !== undefined)) as RateLimitState;
  return Object.keys(present).length ? present : undefined;
}

/** Map an HTTP failure to a safe, categorized provider error. */
export function failureFromStatus(status: number, detail: string, target: ResolvedTarget, headers?: Headers): ProviderFailure {
  const label = LABEL[target.kind];
  const text = redact(detail, target.apiKey).replace(/\s+/g, ' ').trim().slice(0, 300);
  const wait = status === 429 || status >= 500 ? retryAfterFrom(headers) : undefined;
  const make = (category: ProviderError['category'], message: string, retryable: boolean) =>
    new ProviderFailure({ category, message, retryable, ...(wait !== undefined ? { retryAfterMs: wait } : {}) });
  if (status === 401 || status === 403) return make('auth', `${label} rejected the API key.`, false);
  if (status === 402) return make('quota', `${label} reports insufficient credits or a negative balance. This can block free models too.${text ? ` ${text}` : ''}`, false);
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
  if (!response.ok) throw failureFromStatus(response.status, providerMessage(await response.text().catch(() => '')), target, response.headers);
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

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

const shortRateLimit = (error: unknown) =>
  error instanceof ProviderFailure && error.error.category === 'quota' && error.error.retryable
    && error.error.retryAfterMs !== undefined && error.error.retryAfterMs <= MAX_AUTO_WAIT_MS ? error.error.retryAfterMs : undefined;

/** Send a request, waiting out short rate limits a bounded number of times, visibly. */
async function* sendWithRetry(target: ResolvedTarget, send: () => Promise<Response>, signal: AbortSignal): AsyncGenerator<AdapterEvent, Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await send();
      const quota = quotaFrom(response.headers);
      if (quota) yield { type: 'quota', quota };
      return response;
    } catch (error) {
      const wait = shortRateLimit(error);
      if (wait === undefined || attempt > MAX_AUTO_RETRIES) throw error;
      yield { type: 'status', message: `${LABEL[target.kind]} is rate limiting requests. Retrying in ${Math.max(1, Math.ceil(wait / 1000))}s (${attempt} of ${MAX_AUTO_RETRIES}).` };
      await sleep(wait, signal);
    }
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

type ContentPart = Exclude<RunMessage['content'], string>[number];
const partsOf = (message: ModelMessage): ContentPart[] => typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
const textOf = (message: ModelMessage) => partsOf(message).filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text').map(part => part.text).join('\n');
const imagesOf = (message: ModelMessage) => partsOf(message).filter((part): part is Extract<ContentPart, { type: 'image' }> => part.type === 'image');
const hasToolCalls = (message: ModelMessage): message is Extract<ModelMessage, { toolCalls: ToolCall[] }> => 'toolCalls' in message;

/** Arguments as an object for providers that take objects; malformed arguments were already reported to the model as a tool error. */
function argumentsObject(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** A tool result as a JSON object (Gemini requires an object). */
function resultObject(content: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value };
  } catch { return { result: content }; }
}

const openAITools = (tools: ToolSpec[]) => tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));

function openAIMessage(message: ModelMessage) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (hasToolCalls(message)) {
    return { role: 'assistant', content: message.content || null, tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) };
  }
  return typeof message.content === 'string' ? message : {
    ...message,
    content: message.content.map(part => part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }),
  };
}

function ollamaMessage(message: ModelMessage) {
  if (message.role === 'tool') return { role: 'tool', content: message.content, tool_name: message.name };
  if (hasToolCalls(message)) return { role: 'assistant', content: message.content, tool_calls: message.toolCalls.map(call => ({ function: { name: call.name, arguments: argumentsObject(call.arguments) } })) };
  const images = imagesOf(message);
  return { role: message.role, content: textOf(message), ...(images.length ? { images: images.map(part => part.data) } : {}) };
}

/** Collect streamed tool calls; OpenAI-style providers send each call in fragments keyed by index. */
function toolCallAccumulator() {
  const calls: { id?: string; name: string; arguments: string; signature?: string }[] = [];
  return {
    add(index: number | undefined, part: { id?: unknown; name?: unknown; arguments?: unknown; signature?: unknown }) {
      const call = calls[Number.isInteger(index) ? index! : calls.length] ??= { name: '', arguments: '' };
      if (typeof part.id === 'string' && part.id) call.id = part.id;
      if (typeof part.name === 'string' && part.name && !call.name) call.name = part.name;
      if (typeof part.arguments === 'string') call.arguments += part.arguments;
      else if (part.arguments && typeof part.arguments === 'object') call.arguments = JSON.stringify(part.arguments);
      if (typeof part.signature === 'string') call.signature = part.signature;
    },
    result(): ToolCall[] | undefined {
      const list = calls.filter(Boolean).map((call, i) => ({
        id: call.id ?? `call_${i + 1}`, name: call.name, arguments: call.arguments || '{}',
        ...(call.id ? {} : { generatedId: true }), ...(call.signature ? { signature: call.signature } : {}),
      }));
      return list.length ? list : undefined;
    },
  };
}

/** OpenAI, DeepSeek, and OpenAI-compatible servers share the chat completions SSE format. */
async function* streamOpenAIStyle(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const body: Record<string, unknown> = {
    model: req.model, messages: req.messages.map(openAIMessage), stream: true, stream_options: { include_usage: true },
    // OpenAI replaced max_tokens with max_completion_tokens; other servers still use max_tokens.
    [COMPLETION_TOKENS_PARAM.has(target.kind) ? 'max_completion_tokens' : 'max_tokens']: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.tools?.length ? { tools: openAITools(req.tools) } : {}),
  };
  const url = `${target.baseURL}/chat/completions`;
  const send = () => post(fetchImpl, url, target, body, signal);
  let response: Response;
  try { response = yield* sendWithRetry(target, send, signal); }
  catch (error) {
    if (!rejectsTemperature(error) || body.temperature === undefined) throw error;
    // A validation rejection happens before generation, so resending cannot duplicate output or billing.
    yield { type: 'status', message: TEMPERATURE_NOTICE };
    delete body.temperature;
    response = yield* sendWithRetry(target, send, signal);
  }
  let usage: Usage | undefined;
  let finishReason: string | undefined;
  let done = false;
  const calls = toolCallAccumulator();
  for await (const line of bodyLines(response, signal)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') { done = true; break; }
    if (!payload) continue;
    const data = parseRecord(payload, target);
    if (data.error) throw failureFromStatus(Number(data.error.code) || 500, providerMessage(JSON.stringify(data)), target);
    const choice = data.choices?.[0];
    // Groq has reported streaming usage under x_groq.
    const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
    if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
    const text = choice?.delta?.content;
    if (typeof text === 'string' && text) yield { type: 'delta', text };
    for (const part of Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : []) {
      calls.add(part?.index, { id: part?.id, name: part?.function?.name, arguments: part?.function?.arguments });
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const reported = data.usage ?? data.x_groq?.usage;
    usage = normalizeUsage(reported?.prompt_tokens, reported?.completion_tokens) ?? usage;
  }
  // Some servers omit [DONE]; a reported finish reason still marks a complete answer.
  if (!done && !finishReason) throw new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
  const toolCalls = req.tools?.length ? calls.result() : undefined;
  yield { type: 'done', usage, finishReason, ...(toolCalls ? { toolCalls } : {}) };
}

async function* streamOllama(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const response = yield* sendWithRetry(target, () => post(fetchImpl, `${target.baseURL}/api/chat`, target, {
    model: req.model, messages: req.messages.map(ollamaMessage), stream: true,
    options: { num_predict: req.maxTokens ?? DEFAULT_MAX_TOKENS, num_ctx: req.numCtx ?? 8192, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
    ...(req.tools?.length ? { tools: openAITools(req.tools) } : {}),
  }, signal), signal);
  // Ollama sends each tool call whole, with arguments as an object.
  const calls = toolCallAccumulator();
  for await (const line of bodyLines(response, signal)) {
    const data = parseRecord(line, target);
    if (data.error) throw failureFromStatus(500, String(data.error), target);
    const thinking = data.message?.thinking;
    if (typeof thinking === 'string' && thinking) yield { type: 'reasoning', text: thinking };
    const text = data.message?.content;
    if (typeof text === 'string' && text) yield { type: 'delta', text };
    for (const call of Array.isArray(data.message?.tool_calls) ? data.message.tool_calls : []) {
      calls.add(undefined, { id: call?.id, name: call?.function?.name, arguments: call?.function?.arguments ?? {} });
    }
    if (data.done) {
      // load_duration is in nanoseconds; it is near zero when the model was already in memory.
      const loadMs = Number.isFinite(data.load_duration) && data.load_duration >= 0 ? Math.round(data.load_duration / 1e6) : undefined;
      const toolCalls = req.tools?.length ? calls.result() : undefined;
      yield { type: 'done', usage: normalizeUsage(data.prompt_eval_count, data.eval_count), finishReason: data.done_reason, ...(loadMs !== undefined ? { loadMs } : {}), ...(toolCalls ? { toolCalls } : {}) };
      return;
    }
  }
  throw new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
}

type GeminiPart = Record<string, unknown>;

/** Gemini needs alternating roles; merge consecutive turns from the same side. Tool results go back as function responses. */
function geminiContents(messages: ModelMessage[]) {
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    let parts: GeminiPart[];
    if (message.role === 'tool') {
      parts = [{ functionResponse: { name: message.name, response: resultObject(message.content) } }];
    } else if (hasToolCalls(message)) {
      parts = [
        ...(message.content ? [{ text: message.content }] : []),
        ...message.toolCalls.map(call => ({
          functionCall: { name: call.name, args: argumentsObject(call.arguments), ...(call.generatedId ? {} : { id: call.id }) },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        })),
      ];
    } else {
      parts = partsOf(message).map(part => part.type === 'text' ? { text: part.text } : { inlineData: { mimeType: part.mimeType, data: part.data } });
    }
    const last = contents[contents.length - 1];
    if (last?.role !== role) { contents.push({ role, parts }); continue; }
    // Separate merged text turns; never put text between function calls or responses.
    if ('text' in last.parts[last.parts.length - 1] && 'text' in parts[0]) last.parts.push({ text: '\n\n' });
    last.parts.push(...parts);
  }
  return contents;
}

/** Gemini's function declarations accept an OpenAPI subset without additionalProperties. */
function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'additionalProperties').map(([key, value]) => [key, geminiSchema(value)]));
}

const systemText = (messages: ModelMessage[]) => messages.filter(m => m.role === 'system').map(textOf).join('\n\n');
const GEMINI_BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

async function* streamGemini(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const system = systemText(req.messages);
  const body: Record<string, any> = {
    contents: geminiContents(req.messages),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
    ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map(({ name, description, parameters }) => ({ name, description, parameters: geminiSchema(parameters) })) }] } : {}),
  };
  // alt=sse selects the event-stream format; the key stays in the x-goog-api-key header.
  const url = `${target.baseURL}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
  const response = yield* sendWithRetry(target, () => post(fetchImpl, url, target, body, signal), signal);
  let usage: Usage | undefined;
  let finishReason: string | undefined;
  const calls = toolCallAccumulator();
  for await (const line of bodyLines(response, signal)) {
    if (!line.startsWith('data:')) continue;
    const data = parseRecord(line.slice(5).trim(), target);
    if (data.error) throw failureFromStatus(Number(data.error.code) || 500, providerMessage(JSON.stringify(data)), target);
    if (data.promptFeedback?.blockReason) throw new ProviderFailure({ category: 'refused', message: `Gemini blocked this prompt (${data.promptFeedback.blockReason}).`, retryable: false });
    const candidate = data.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) {
        calls.add(undefined, { id: part.functionCall.id, name: part.functionCall.name, arguments: part.functionCall.args ?? {}, signature: part.thoughtSignature });
        continue;
      }
      if (typeof part.text !== 'string' || !part.text) continue;
      yield part.thought ? { type: 'reasoning', text: part.text } : { type: 'delta', text: part.text };
    }
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    const meta = data.usageMetadata;
    // Output includes thinking tokens; total minus prompt counts them once however the fields are split.
    if (meta) {
      const output = Number.isFinite(meta.totalTokenCount) && Number.isFinite(meta.promptTokenCount)
        ? meta.totalTokenCount - meta.promptTokenCount
        : (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
      usage = normalizeUsage(meta.promptTokenCount, output) ?? usage;
    }
  }
  if (!finishReason) throw new ProviderFailure({ category: 'transport', message: INCOMPLETE, retryable: true });
  if (GEMINI_BLOCKED.has(finishReason)) throw new ProviderFailure({ category: 'refused', message: `Gemini stopped the answer (${finishReason}). The partial answer was kept.`, retryable: false });
  const toolCalls = req.tools?.length ? calls.result() : undefined;
  yield { type: 'done', usage, finishReason: finishReason.toLowerCase(), ...(toolCalls ? { toolCalls } : {}) };
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
    return failureFromStatus(error.status ?? 500, detail, target, error.headers ?? undefined);
  }
  return error;
}

/** Tool results go back as tool_result blocks; results for one step share a single user turn. */
function anthropicMessages(messages: ModelMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content, ...(message.isError ? { is_error: true } : {}) };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(part => part.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (hasToolCalls(message)) {
      out.push({ role: 'assistant', content: [
        // Anthropic rejects empty text blocks.
        ...(message.content.trim() ? [{ type: 'text' as const, text: message.content }] : []),
        ...message.toolCalls.map(call => ({ type: 'tool_use' as const, id: call.id, name: call.name, input: argumentsObject(call.arguments) })),
      ] });
      continue;
    }
    out.push({ role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' ? { type: 'text' as const, text: part.text } : { type: 'image' as const, source: { type: 'base64' as const, media_type: part.mimeType, data: part.data } }) });
  }
  return out;
}

async function* streamAnthropic(req: ModelRequest, signal: AbortSignal, fetchImpl: FetchFn): AsyncGenerator<AdapterEvent> {
  const { target } = req;
  const client = new Anthropic({ apiKey: target.apiKey, maxRetries: 0, timeout: 600_000, fetch: fetchImpl });
  const system = systemText(req.messages);
  const params: Anthropic.MessageStreamParams = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: anthropicMessages(req.messages),
    ...(system ? { system } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.tools?.length ? { tools: req.tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters as Anthropic.Tool.InputSchema })) } : {}),
  };
  let rateLimitRetries = 0;
  for (;;) {
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
      // The SDK assembles each tool_use input from its streamed JSON fragments.
      const toolCalls = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map(block => ({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }));
      yield { type: 'done', usage: normalizeUsage(input, usage.output_tokens), finishReason: message.stop_reason ?? undefined, ...(req.tools?.length && toolCalls.length ? { toolCalls } : {}) };
      return;
    } catch (error) {
      const failure = anthropicFailure(error, target, streamed);
      // Newer Claude models reject sampling parameters; this is a pre-generation validation error.
      if (!streamed && params.temperature !== undefined && rejectsTemperature(failure)) {
        yield { type: 'status', message: TEMPERATURE_NOTICE };
        delete params.temperature;
        continue;
      }
      const wait = streamed ? undefined : shortRateLimit(failure);
      if (wait !== undefined && rateLimitRetries < MAX_AUTO_RETRIES) {
        rateLimitRetries++;
        yield { type: 'status', message: `Anthropic is rate limiting requests. Retrying in ${Math.max(1, Math.ceil(wait / 1000))}s (${rateLimitRetries} of ${MAX_AUTO_RETRIES}).` };
        await sleep(wait, signal);
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
