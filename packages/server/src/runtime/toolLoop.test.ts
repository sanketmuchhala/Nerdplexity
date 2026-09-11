import { describe, expect, it } from 'vitest';
import type { ToolName } from '@app/types';
import { resolveTarget } from './destinations.js';
import { runWithTools, TOOL_LIMITS, type ToolLoopEvent } from './toolLoop.js';

type Call = { id?: string; name: string; arguments: string };
const sse = (records: unknown[]) => records.map(r => `data: ${JSON.stringify(r)}\n\n`).join('') + 'data: [DONE]\n\n';
const usage = (prompt: number) => ({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: 2 } });
const toolStep = (calls: Call[], text = '') => sse([
  ...(text ? [{ choices: [{ delta: { content: text } }] }] : []),
  { choices: [{ delta: { tool_calls: calls.map((c, index) => ({ index, ...(c.id ? { id: c.id } : {}), function: { name: c.name, arguments: c.arguments } })) } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  usage(5),
]);
const answer = (text: string, reportUsage = true) => sse([
  { choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, ...(reportUsage ? [usage(7)] : []),
]);

function fakeModel(...bodies: string[]) {
  const requests: any[] = [];
  const fn = (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(bodies[Math.min(requests.length - 1, bodies.length - 1)], { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fn, requests };
}

const request = { target: resolveTarget({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' }), model: 'm', messages: [{ role: 'user' as const, content: 'What is 6*7?' }] };
const documents = [{ id: 'd1', title: 'Launch notes', content: 'Decision: ship on Friday.' }];

async function collect(fn: typeof fetch, tools: ToolName[] = ['calculator'], signal = new AbortController().signal, onEvent?: (e: ToolLoopEvent) => void) {
  const events: ToolLoopEvent[] = [];
  let error: unknown;
  try {
    for await (const event of runWithTools(request, tools, documents, signal, fn)) { events.push(event); onEvent?.(event); }
  } catch (e) { error = e; }
  return { events, error, text: events.flatMap(e => e.type === 'delta' ? [e.text] : []).join(''), tools: events.filter(e => e.type === 'tool') };
}

describe('tool loop', () => {
  it('runs a multi-step loop, returns results by call ID, and streams every step', async () => {
    const { fn, requests } = fakeModel(
      toolStep([{ id: 'call_a', name: 'calculator', arguments: '{"expression":"6*7"}' }], 'Let me compute.'),
      toolStep([{ id: 'call_b', name: 'search_documents', arguments: '{"query":"decision"}' }]),
      answer('It is 42, and the notes say ship on Friday.'),
    );
    const result = await collect(fn, ['calculator', 'search_documents']);
    expect(result.error).toBeUndefined();
    expect(result.text).toBe('Let me compute.\n\nIt is 42, and the notes say ship on Friday.');
    expect(result.tools.map(t => t.type === 'tool' && [t.id, t.status, t.source, t.step])).toEqual([
      ['call_a', 'running', 'computed', 1], ['call_a', 'completed', 'computed', 1],
      ['call_b', 'running', 'retrieved', 2], ['call_b', 'completed', 'retrieved', 2],
    ]);
    expect(result.events.at(-1)).toEqual({ type: 'done', usage: { prompt_tokens: 17, completion_tokens: 6, total_tokens: 23 }, finishReason: 'stop' });
    expect(requests[0].tools.map((t: any) => t.function.name)).toEqual(['calculator', 'search_documents']);
    expect(requests[0].messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('Launch notes') });
    expect(requests[1].messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'Let me compute.', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'calculator', arguments: '{"expression":"6*7"}' } }] },
      { role: 'tool', tool_call_id: 'call_a', content: '{"expression":"6*7","result":42}' },
    ]);
  });

  it('reports unknown tools, disabled tools, and malformed arguments to the model, then finishes', async () => {
    const { fn, requests } = fakeModel(
      toolStep([{ id: 'a', name: 'shell', arguments: '{}' }, { id: 'b', name: 'read_document', arguments: '{"id":"d1"}' }, { id: 'c', name: 'calculator', arguments: '{"expression":' }]),
      answer('I could not use those tools.'),
    );
    const result = await collect(fn);
    expect(result.error).toBeUndefined();
    expect(result.tools.filter(t => t.type === 'tool' && t.status !== 'running').map(t => t.type === 'tool' && t.status)).toEqual(['error', 'denied', 'error']);
    expect(requests[1].messages.slice(-3).map((m: any) => JSON.parse(m.content).error)).toEqual([
      expect.stringContaining('no tool named'), expect.stringContaining('not enabled'), expect.stringContaining('not valid JSON'),
    ]);
  });

  it('stops at the step limit with unique IDs for generated calls', async () => {
    const { fn, requests } = fakeModel(toolStep([{ name: 'calculator', arguments: '{"expression":"1+1"}' }]));
    const result = await collect(fn);
    expect((result.error as Error).message).toContain(`all ${TOOL_LIMITS.steps} tool steps`);
    expect(requests).toHaveLength(TOOL_LIMITS.steps);
    const ids = result.tools.filter(t => t.type === 'tool' && t.status === 'completed').map(t => t.type === 'tool' && t.id);
    expect(ids).toEqual(Array.from({ length: TOOL_LIMITS.steps }, (_, i) => `call_${i + 1}_1`));
  });

  it('refuses a step that exceeds the call limit without running any of its calls', async () => {
    const many = Array.from({ length: TOOL_LIMITS.calls + 1 }, (_, i) => ({ id: `c${i}`, name: 'calculator', arguments: '{"expression":"1"}' }));
    const result = await collect(fakeModel(toolStep(many)).fn);
    expect((result.error as Error).message).toContain(`more than ${TOOL_LIMITS.calls} tool calls`);
    expect(result.tools).toHaveLength(0);
  });

  it('stops promptly when canceled between tool calls', async () => {
    const controller = new AbortController();
    const { fn, requests } = fakeModel(toolStep([{ id: 'a', name: 'calculator', arguments: '{"expression":"2"}' }, { id: 'b', name: 'calculator', arguments: '{"expression":"3"}' }]), answer('never'));
    const result = await collect(fn, ['calculator'], controller.signal, event => { if (event.type === 'tool' && event.status === 'completed') controller.abort(new Error('canceled')); });
    expect((result.error as Error).message).toBe('canceled');
    expect(result.tools.filter(t => t.type === 'tool' && t.status === 'completed')).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('omits usage when any step did not report it, rather than understating the total', async () => {
    const { fn } = fakeModel(toolStep([{ id: 'a', name: 'calculator', arguments: '{"expression":"2"}' }]), answer('2', false));
    const result = await collect(fn);
    expect(result.events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});
