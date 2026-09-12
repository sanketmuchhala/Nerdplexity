import type { ToolName, ToolTrace, Usage } from '@app/types';
import { AdapterEvent, ModelMessage, ModelRequest, streamModel } from './adapters.js';
import { executeTool, toolInstructions, toolSource, toolSpecs, WorkspaceDocument } from './tools.js';

type FetchFn = typeof fetch;

export const TOOL_LIMITS = { steps: 6, calls: 12 } as const;

export type ToolLoopEvent = AdapterEvent | ({ type: 'tool' } & ToolTrace);

function parsedOrRaw(json: string): unknown {
  try { return JSON.parse(json); } catch { return json; }
}

/**
 * Bounded tool loop: stream a model step, run the calls it asks for, return the results, repeat.
 * Every step streams through the normal adapter, so text, reasoning, quota, and failures behave as in chat.
 * No tool changes anything outside the app (web search only reads), so a retry of the whole run repeats no external effect.
 */
export async function* runWithTools(
  req: ModelRequest, enabled: ToolName[], documents: WorkspaceDocument[], signal: AbortSignal, fetchImpl: FetchFn = fetch,
  search?: { apiKey: string },
): AsyncGenerator<ToolLoopEvent> {
  const tools = new Set(enabled);
  const specs = toolSpecs(tools);
  const messages: ModelMessage[] = [{ role: 'system', content: toolInstructions(tools, documents, TOOL_LIMITS) }, ...req.messages];
  // Usage is reported only when every step reported it; a partial sum would understate the run.
  let usage: Usage | undefined = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let loadMs: number | undefined;
  let callsUsed = 0;
  let wroteText = false;

  for (let step = 1; step <= TOOL_LIMITS.steps; step++) {
    signal.throwIfAborted();
    if (step > 1) yield { type: 'status', message: `Tools · step ${step} of ${TOOL_LIMITS.steps}` };
    let done: Extract<AdapterEvent, { type: 'done' }> | undefined;
    let text = '';
    for await (const event of streamModel({ ...req, messages, tools: specs }, signal, fetchImpl)) {
      if (event.type === 'done') { done = event; continue; }
      if (event.type === 'delta') {
        // Keep text from separate steps from running together in the saved answer.
        if (!text && wroteText) yield { type: 'delta', text: '\n\n' };
        text += event.text;
        wroteText = true;
      }
      yield event;
    }
    if (!done) throw new Error('The model stream ended without a result.');
    usage = usage && done.usage ? {
      prompt_tokens: usage.prompt_tokens + done.usage.prompt_tokens,
      completion_tokens: usage.completion_tokens + done.usage.completion_tokens,
      total_tokens: usage.total_tokens + done.usage.total_tokens,
    } : undefined;
    loadMs ??= done.loadMs;

    if (!done.toolCalls?.length) {
      yield { type: 'done', ...(usage ? { usage } : {}), finishReason: done.finishReason, ...(loadMs !== undefined ? { loadMs } : {}) };
      return;
    }
    if (callsUsed + done.toolCalls.length > TOOL_LIMITS.calls) {
      throw new Error(`The model asked for more than ${TOOL_LIMITS.calls} tool calls. Narrow the request and try again. Completed tool results are saved in Run history.`);
    }
    // Generated IDs restart each step; make them unique within the run so results match their calls.
    const calls = done.toolCalls.map((call, i) => call.generatedId ? { ...call, id: `call_${step}_${i + 1}` } : call);
    messages.push({ role: 'assistant', content: text, toolCalls: calls });
    for (const call of calls) {
      signal.throwIfAborted();
      callsUsed++;
      const trace = { id: call.id, name: call.name.slice(0, 64) || 'unnamed', step };
      yield { type: 'tool', ...trace, input: parsedOrRaw(call.arguments), output: null, status: 'running', source: toolSource(call.name) };
      const outcome = await executeTool(call.name, call.arguments, { enabled: tools, documents, signal, search, fetchImpl });
      yield {
        type: 'tool', ...trace, input: outcome.input, output: outcome.output ?? null, status: outcome.status,
        ...(outcome.error ? { error: outcome.error } : {}), durationMs: outcome.durationMs, source: outcome.source,
      };
      messages.push({
        role: 'tool', toolCallId: call.id, name: call.name,
        content: JSON.stringify(outcome.status === 'completed' ? outcome.output : { error: outcome.error }),
        ...(outcome.status === 'completed' ? {} : { isError: true }),
      });
    }
  }
  throw new Error(`The model used all ${TOOL_LIMITS.steps} tool steps without a final answer. Completed tool results are saved in Run history.`);
}
