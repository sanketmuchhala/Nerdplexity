import { describe, expect, it } from 'vitest';
import { AdapterEvent, ModelRequest, ProviderFailure, streamModel } from './adapters.js';
import { resolveTarget } from './destinations.js';

/** A streaming body delivered in tiny pieces so records and characters split across chunks. */
function chunked(text: string, size = 5): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

const sse = (records: unknown[], done = true) => records.map(r => `data: ${JSON.stringify(r)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
const stream = (body: string, type = 'text/event-stream') => new Response(chunked(body), { status: 200, headers: { 'content-type': type } });
const json = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(...responses: ((init: RequestInit, url: string) => Response)[]) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return next(init, url);
  }) as typeof fetch;
  return { fn, calls };
}

const request = (target: object, extra: Partial<ModelRequest> = {}): ModelRequest => ({
  target: resolveTarget(target), model: 'test-model', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }], temperature: 0.7, maxTokens: 100, ...extra,
});

async function run(req: ModelRequest, fetchImpl: typeof fetch, signal = new AbortController().signal) {
  const events: AdapterEvent[] = [];
  let error: unknown;
  try { for await (const event of streamModel(req, signal, fetchImpl)) events.push(event); }
  catch (e) { error = e; }
  const text = events.filter(e => e.type === 'delta').map(e => (e as { text: string }).text).join('');
  return { events, text, error, done: events.find(e => e.type === 'done') as Extract<AdapterEvent, { type: 'done' }> | undefined };
}

const failure = (error: unknown) => {
  expect(error).toBeInstanceOf(ProviderFailure);
  return (error as ProviderFailure).error;
};

const compat = { kind: 'openai-compatible', baseURL: 'https://api.example.com/v1', apiKey: 'sk-compat-secret' };

describe('OpenAI-style streaming', () => {
  it('streams text and reasoning, and reads usage sent after the finish chunk', async () => {
    const { fn, calls } = fakeFetch(() => stream(sse([
      { choices: [{ delta: { reasoning_content: 'think ' } }] },
      { choices: [{ delta: { content: 'naïve ' } }] },
      { choices: [{ delta: { content: 'code: `a\\b`' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
    ])));
    const result = await run(request(compat), fn);
    expect(result.text).toBe('naïve code: `a\\b`');
    expect(result.events[0]).toEqual({ type: 'reasoning', text: 'think ' });
    expect(result.done).toEqual({ type: 'done', usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }, finishReason: 'stop' });
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect(calls[0].body).toMatchObject({ stream: true, stream_options: { include_usage: true }, max_tokens: 100, temperature: 0.7 });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-compat-secret');
  });

  it('uses max_completion_tokens for OpenAI', async () => {
    const { fn, calls } = fakeFetch(() => stream(sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])));
    await run(request({ kind: 'openai', apiKey: 'sk-openai' }), fn);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].body.max_completion_tokens).toBe(100);
    expect(calls[0].body.max_tokens).toBeUndefined();
  });

  it('resends once without temperature when the model rejects it, and says so', async () => {
    const { fn, calls } = fakeFetch(
      () => json({ error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model.", param: 'temperature' } }, 400),
      () => stream(sse([{ choices: [{ delta: { content: 'fine' }, finish_reason: 'stop' }] }])),
    );
    const result = await run(request({ kind: 'openai', apiKey: 'sk-openai' }), fn);
    expect(calls).toHaveLength(2);
    expect(calls[1].body.temperature).toBeUndefined();
    expect(result.events[0]).toMatchObject({ type: 'status', message: expect.stringContaining('temperature') });
    expect(result.text).toBe('fine');
  });

  it('categorizes quota, auth, context, and missing-model failures without leaking the key', async () => {
    // A long wait is left to the user rather than retried automatically.
    const quota = failure((await run(request(compat), fakeFetch(() => json({ error: { message: 'Rate limit reached' } }, 429, { 'retry-after': '30' })).fn)).error);
    expect(quota).toMatchObject({ category: 'quota', retryable: true, retryAfterMs: 30000 });
    const credits = failure((await run(request(compat), fakeFetch(() => json({ error: { message: 'Insufficient credits' } }, 402)).fn)).error);
    expect(credits).toMatchObject({ category: 'quota', retryable: false });
    const auth = failure((await run(request(compat), fakeFetch(() => json({ error: { message: 'Incorrect API key sk-compat-secret' } }, 401)).fn)).error);
    expect(auth).toMatchObject({ category: 'auth', retryable: false });
    expect(auth.message).not.toContain('sk-compat-secret');
    const context = failure((await run(request(compat), fakeFetch(() => json({ error: { message: "This model's maximum context length is 8192 tokens" } }, 400)).fn)).error);
    expect(context.category).toBe('context');
    const echoed = failure((await run(request(compat), fakeFetch(() => json({ error: { message: 'bad request for key sk-compat-secret' } }, 400)).fn)).error);
    expect(echoed.message).toContain('[redacted]');
    expect(failure((await run(request(compat), fakeFetch(() => json({}, 404)).fn)).error).category).toBe('invalid-request');
    expect(failure((await run(request(compat), fakeFetch(() => json({}, 503)).fn)).error)).toMatchObject({ category: 'unavailable', retryable: true });
  });

  it('waits out a short rate limit visibly, at most twice, and reports quota headers', async () => {
    const quotaHeaders = { 'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': '14370', 'x-ratelimit-reset-requests': '2m59.56s', 'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '5800', 'x-ratelimit-reset-tokens': '7.66s' };
    const ok = () => new Response(chunked(sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])), { headers: { 'content-type': 'text/event-stream', ...quotaHeaders } });
    const limited = () => json({ error: { message: 'slow down' } }, 429, { 'retry-after': '0' });
    const once = fakeFetch(limited, ok);
    const result = await run(request({ kind: 'groq', apiKey: 'gsk-key' }), once.fn);
    expect(once.calls).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ type: 'status', message: expect.stringContaining('Retrying in 1s (1 of 2)') });
    expect(result.events.find(e => e.type === 'quota')).toEqual({ type: 'quota', quota: {
      requestsLimit: 14400, requestsRemaining: 14370, requestsResetMs: 179560, tokensLimit: 6000, tokensRemaining: 5800, tokensResetMs: 7660,
    } });
    expect(result.text).toBe('ok');
    expect(once.calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(once.calls[0].body.max_completion_tokens).toBe(100);
    const always = fakeFetch(limited);
    expect(failure((await run(request(compat), always.fn)).error).category).toBe('quota');
    expect(always.calls).toHaveLength(3);
  });

  it('reads an epoch reset time as the retry wait', async () => {
    const reset = String(Date.now() + 45_000);
    const error = failure((await run(request({ kind: 'openrouter', apiKey: 'or' }), fakeFetch(() => json({ error: { message: 'Rate limit exceeded: free-models-per-day' } }, 429, { 'x-ratelimit-reset': reset })).fn)).error);
    expect(error.retryAfterMs).toBeGreaterThan(40_000);
    expect(error.retryAfterMs).toBeLessThanOrEqual(45_000);
  });

  it('reads Groq usage reported under x_groq', async () => {
    const { fn } = fakeFetch(() => stream(sse([
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], x_groq: { usage: { prompt_tokens: 7, completion_tokens: 2 } } },
    ])));
    expect((await run(request({ kind: 'groq', apiKey: 'g' }), fn)).done?.usage).toEqual({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 });
  });

  it('keeps partial text and fails when the stream ends early', async () => {
    const { fn } = fakeFetch(() => stream(sse([{ choices: [{ delta: { content: 'partial' } }] }], false)));
    const result = await run(request(compat), fn);
    expect(result.text).toBe('partial');
    expect(failure(result.error)).toMatchObject({ category: 'transport', retryable: true });
  });

  it('reports a connection dropped mid-answer as incomplete, not unreachable', async () => {
    const dropping = (body: string) => (async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(body)); setTimeout(() => c.error(new TypeError('terminated')), 5); },
    }), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
    const result = await run(request({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' }), dropping(sse([{ choices: [{ delta: { content: 'half' } }] }], false)));
    expect(result.text).toBe('half');
    expect(failure(result.error)).toMatchObject({ category: 'transport', message: expect.stringContaining('ended before the model finished') });
    const anthropic = await run(request({ kind: 'anthropic', apiKey: 'k' }), dropping(
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n` +
      `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n` +
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'half' } })}\n\n`,
    ));
    expect(anthropic.text).toBe('half');
    expect(failure(anthropic.error).message).toContain('ended before the model finished');
  });

  it('reports a malformed record as a transport failure', async () => {
    const { fn } = fakeFetch(() => stream('data: {not json\n\n'));
    expect(failure((await run(request(compat), fn)).error).category).toBe('transport');
  });

  it('describes an unreachable local server', async () => {
    const fn = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const result = await run(request({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' }), fn);
    expect(failure(result.error)).toMatchObject({ category: 'transport', message: expect.stringContaining('Check that it is running') });
  });

  it('rethrows cancellation instead of reporting a provider failure', async () => {
    const controller = new AbortController();
    const fn = (async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\n`));
        init.signal!.addEventListener('abort', () => c.error(init.signal!.reason));
      },
    }), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
    const events: AdapterEvent[] = [];
    let error: unknown;
    try {
      for await (const event of streamModel(request(compat), controller.signal, fn)) { events.push(event); controller.abort(new Error('user stop')); }
    } catch (e) { error = e; }
    expect(events).toEqual([{ type: 'delta', text: 'a' }]);
    expect(error).not.toBeInstanceOf(ProviderFailure);
  });
});

describe('Ollama streaming', () => {
  it('streams NDJSON content and thinking with native usage', async () => {
    const lines = [
      { message: { role: 'assistant', content: '', thinking: 'hmm' }, done: false },
      { message: { role: 'assistant', content: 'Grüße ' }, done: false },
      { message: { role: 'assistant', content: 'world' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 4 },
    ].map(l => JSON.stringify(l)).join('\n') + '\n';
    const { fn, calls } = fakeFetch(() => stream(lines, 'application/x-ndjson'));
    const result = await run(request({ kind: 'ollama', baseURL: 'http://127.0.0.1:11434' }, { numCtx: 4096 }), fn);
    expect(result.text).toBe('Grüße world');
    expect(result.events[0]).toEqual({ type: 'reasoning', text: 'hmm' });
    expect(result.done).toEqual({ type: 'done', usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }, finishReason: 'stop' });
    expect(calls[0].body).toMatchObject({ stream: true, options: { num_predict: 100, num_ctx: 4096, temperature: 0.7 } });
  });
});

describe('Gemini streaming', () => {
  it('maps roles, keeps the key out of the URL, and separates thoughts from text', async () => {
    const { fn, calls } = fakeFetch(() => stream(sse([
      { candidates: [{ content: { parts: [{ text: 'plan', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 'Hello ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'there' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, thoughtsTokenCount: 5, totalTokenCount: 15 } },
    ], false)));
    const req = request({ kind: 'gemini', apiKey: 'AIza-secret' }, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: 'Sys' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }],
    });
    const result = await run(req, fn);
    expect(result.text).toBe('Hello there');
    expect(result.events[0]).toEqual({ type: 'reasoning', text: 'plan' });
    // Thinking tokens are billed as output, so they count toward completion tokens.
    expect(result.done).toEqual({ type: 'done', usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 }, finishReason: 'stop' });
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-secret');
    expect(calls[0].body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'a\n\nb' }] }, { role: 'model', parts: [{ text: 'c' }] }, { role: 'user', parts: [{ text: 'd' }] }],
      systemInstruction: { parts: [{ text: 'Sys' }] },
      generationConfig: { maxOutputTokens: 100, temperature: 0.7 },
    });
  });

  it('reports a safety stop as a refusal and keeps partial text', async () => {
    const { fn } = fakeFetch(() => stream(sse([
      { candidates: [{ content: { parts: [{ text: 'Start' }] } }] },
      { candidates: [{ finishReason: 'SAFETY' }] },
    ], false)));
    const result = await run(request({ kind: 'gemini', apiKey: 'k' }), fn);
    expect(result.text).toBe('Start');
    expect(failure(result.error).category).toBe('refused');
  });
});

describe('Anthropic streaming (SDK)', () => {
  const events = (text: string[], stopReason = 'end_turn') => [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...text.map(t => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 6 } }],
    ['message_stop', { type: 'message_stop' }],
  ].map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');

  it('streams text deltas and reports usage and stop reason', async () => {
    const { fn, calls } = fakeFetch(() => stream(events(['Hel', 'lo'])));
    const result = await run(request({ kind: 'anthropic', apiKey: 'sk-ant-key' }, { model: 'claude-opus-5' }), fn);
    expect(result.text).toBe('Hello');
    expect(result.done).toEqual({ type: 'done', usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 }, finishReason: 'end_turn' });
    expect(calls[0].body).toMatchObject({ model: 'claude-opus-5', max_tokens: 100, system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }], stream: true });
    expect(new Headers(calls[0].init.headers).get('x-api-key')).toBe('sk-ant-key');
  });

  it('treats a refusal stop reason as a refusal, not a completed answer', async () => {
    const { fn } = fakeFetch(() => stream(events(['Part'], 'refusal')));
    const result = await run(request({ kind: 'anthropic', apiKey: 'k' }), fn);
    expect(result.text).toBe('Part');
    expect(failure(result.error).category).toBe('refused');
  });

  it('resends once without temperature when the model rejects sampling parameters', async () => {
    const { fn, calls } = fakeFetch(
      () => json({ type: 'error', error: { type: 'invalid_request_error', message: 'temperature is not supported for this model' } }, 400),
      () => stream(events(['ok'])),
    );
    const result = await run(request({ kind: 'anthropic', apiKey: 'k' }), fn);
    expect(calls).toHaveLength(2);
    expect(calls[1].body.temperature).toBeUndefined();
    expect(result.events[0]).toMatchObject({ type: 'status' });
    expect(result.text).toBe('ok');
  });

  it('maps typed SDK errors', async () => {
    const auth = failure((await run(request({ kind: 'anthropic', apiKey: 'k' }), fakeFetch(() => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)).fn)).error);
    expect(auth.category).toBe('auth');
    const overloaded = failure((await run(request({ kind: 'anthropic', apiKey: 'k' }), fakeFetch(() => json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529)).fn)).error);
    expect(overloaded).toMatchObject({ category: 'unavailable', retryable: true });
  });
});
