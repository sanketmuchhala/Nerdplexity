import type { BenchCategory, BenchResult, ConnectionKind, ProviderError } from '@app/types';
import { ModelRequest, ProviderFailure, streamModel, ToolCall } from '../runtime/adapters.js';
import type { ResolvedTarget } from '../runtime/destinations.js';
import type { ProgressPayload, RunExecutor } from '../runtime/runs.js';
import { enqueueLocal } from '../queue/localQueue.js';
import { grade } from './grade.js';
import type { BenchItem } from './suite.js';

export interface BenchJob {
  connections: Map<string, ResolvedTarget>;
  models: { connectionId: string; model: string }[];
  items: BenchItem[];
}

export interface BenchDeps {
  save: (result: BenchResult) => Promise<void>;
  fetchImpl?: typeof fetch;
  /** Serializes models on this machine with chat runs. */
  enqueue?: <T>(fn: () => Promise<T>) => Promise<T>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Minimum time between two requests to one connection. */
  gapMs?: (target: ResolvedTarget) => number;
}

/** Requests per minute allowed by each provider's free tier, as its docs state; Bench stays under them. */
const FREE_RPM: Partial<Record<ConnectionKind, number>> = {
  openrouter: 20, groq: 30, gemini: 10, cerebras: 5, sambanova: 20, mistral: 60, huggingface: 60,
};
const DEFAULT_RPM = 20;

/** 10% slower than the limit, in whole milliseconds. */
export const benchGapMs = (target: ResolvedTarget) =>
  target.execution === 'local' ? 0 : Math.ceil(66_000 / (FREE_RPM[target.kind] ?? DEFAULT_RPM));

/** Room for each kind of answer: worked math and code need more than a short span or a tool call. */
const MAX_TOKENS: Record<BenchCategory, number> = { code: 1024, math: 1024, instructions: 1200, tools: 512, facts: 256 };
/** After this many failed requests in a row, a model is skipped for the rest of the job. */
const MAX_CONSECUTIVE_ERRORS = 3;
/** A rate limit shorter than this is waited out once; a longer one skips the model. */
const MAX_WAIT_MS = 60_000;

function sleepFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (ms <= 0) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))} s`;

/**
 * Send every item to every model, grade each answer, and save it. Connections run side by side;
 * requests to one connection go one at a time, spaced to stay under its free rate limit. Items
 * go to every model before the next item, so a job cut short still compares models on the same
 * questions. A rate limit skips the model (or, when account-wide, the whole connection) rather
 * than counting as a wrong answer.
 */
export function benchExecutor(job: BenchJob, deps: BenchDeps): RunExecutor {
  const { save, fetchImpl = fetch, enqueue = enqueueLocal, sleep = sleepFor, now = Date.now, gapMs = benchGapMs } = deps;
  const total = job.items.length * job.models.length;
  return async ({ signal, emit }) => {
    let done = 0;
    const progress = (event: Omit<Extract<ProgressPayload, { type: 'bench' }>, 'type' | 'done' | 'total'>, count = 1) => {
      done += count;
      emit({ type: 'bench', ...event, done, total });
    };

    const runConnection = async (connectionId: string, target: ResolvedTarget) => {
      const models = job.models.filter(m => m.connectionId === connectionId).map(m => m.model);
      const active = new Set(models);
      const errors = new Map<string, number>();
      let lastSent = -Infinity;
      const answered = new Map<string, number>();
      const record = async (model: string, result: BenchResult) => {
        await save(result);
        answered.set(model, (answered.get(model) ?? 0) + 1);
        progress({ result });
      };
      const skip = (model: string, why: string) => {
        if (!active.delete(model)) return;
        const remaining = job.items.length - (answered.get(model) ?? 0);
        emit({ type: 'status', message: `Skipping ${model}: ${why}` });
        if (remaining > 0) progress({ skipped: remaining }, remaining);
      };

      for (const item of job.items) {
        for (const model of models) {
          signal.throwIfAborted();
          if (!active.has(model)) continue;
          for (let attempt = 1; ; attempt++) {
            await sleep(lastSent + gapMs(target) - now(), signal);
            lastSent = now();
            const outcome = await ask(target, model, item, signal, fetchImpl, enqueue, now);
            if ('failure' in outcome) {
              const { failure } = outcome;
              if (failure.category === 'quota' || failure.category === 'auth') {
                const wait = failure.retryAfterMs;
                if (failure.category === 'quota' && failure.scope !== 'account' && attempt === 1 && wait !== undefined && wait <= MAX_WAIT_MS) {
                  emit({ type: 'status', message: `${model} is rate limited; waiting ${seconds(wait)}.` });
                  await sleep(wait, signal);
                  continue;
                }
                const why = failure.category === 'auth' ? 'the key was rejected.' : failure.message;
                if (failure.category === 'auth' || failure.scope === 'account') for (const other of [...active]) skip(other, why);
                else skip(model, why);
                break;
              }
              await record(model, { connectionId, model, itemId: item.id, category: item.category, status: 'error', detail: failure.message.slice(0, 300), at: now() });
              const streak = (errors.get(model) ?? 0) + 1;
              errors.set(model, streak);
              if (streak >= MAX_CONSECUTIVE_ERRORS) skip(model, `${streak} requests in a row failed (${failure.message.slice(0, 120)})`);
              break;
            }
            errors.set(model, 0);
            const { passed, detail } = outcome.refused ? { passed: false, detail: 'The model refused to answer.' } : grade(item.grade, outcome.text, outcome.toolCalls);
            await record(model, {
              connectionId, model, itemId: item.id, category: item.category, status: passed ? 'passed' : 'failed',
              ...(detail ? { detail: detail.slice(0, 300) } : {}), latencyMs: outcome.latencyMs,
              ...(outcome.ttftMs !== undefined ? { ttftMs: outcome.ttftMs } : {}), at: now(),
            });
            break;
          }
        }
      }
    };

    await Promise.all([...job.connections].map(([id, target]) => runConnection(id, target)));
    return {};
  };
}

type Outcome = { text: string; toolCalls?: ToolCall[]; latencyMs: number; ttftMs?: number; refused?: boolean } | { failure: ProviderError };

/** One graded request. A refusal is a wrong answer, not an error: the questions are harmless. */
async function ask(
  target: ResolvedTarget, model: string, item: BenchItem, signal: AbortSignal, fetchImpl: typeof fetch,
  enqueue: <T>(fn: () => Promise<T>) => Promise<T>, now: () => number,
): Promise<Outcome> {
  const request: ModelRequest = {
    target, model, messages: [{ role: 'user', content: item.prompt }], maxTokens: MAX_TOKENS[item.category], temperature: 0,
    // Bench handles rate limits itself, visibly, instead of the adapter's short silent waits.
    waitOnRateLimit: false,
    ...(item.tools ? { tools: item.tools } : {}),
  };
  const send = async (): Promise<Outcome> => {
    const started = now();
    let text = '';
    let ttftMs: number | undefined;
    try {
      for await (const event of streamModel(request, signal, fetchImpl)) {
        if (event.type === 'delta') { ttftMs ??= now() - started; text += event.text; }
        if (event.type === 'done') return { text, ...(event.toolCalls ? { toolCalls: event.toolCalls } : {}), latencyMs: now() - started, ...(ttftMs !== undefined ? { ttftMs } : {}) };
      }
      return { failure: { category: 'transport', message: 'The stream ended without a result.', retryable: true } };
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof ProviderFailure)) throw error;
      if (error.error.category === 'refused') return { text, refused: true, latencyMs: now() - started };
      return { failure: error.error };
    }
  };
  return target.execution === 'local' ? enqueue(send) : send();
}
