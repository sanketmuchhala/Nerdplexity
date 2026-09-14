import { randomUUID } from 'crypto';
import type { ProviderError, RouteOutcome, RunEnvelope, RunEventPayload, RunState, RunTiming, TerminalPayload, Usage } from '@app/types';
import { enqueueLocal, getLocalQueueStatus } from '../queue/localQueue.js';
import { ProviderFailure } from './adapters.js';

/** Events an executor may emit. Lifecycle events are emitted by the registry. */
export type ProgressPayload = Extract<RunEventPayload, { type: 'status' | 'delta' | 'reasoning' | 'quota' | 'tool' | 'route' }>;

export interface RunContext {
  signal: AbortSignal;
  emit: (payload: ProgressPayload) => void;
}

export type RunExecutor = (ctx: RunContext) => Promise<{ usage?: Usage; finishReason?: string; loadMs?: number; route?: RouteOutcome }>;

export interface RunRegistryOptions {
  /** Cancel a run when no client has been subscribed for this long. */
  orphanMs?: number;
  /** Keep finished runs available for replay this long. */
  retainMs?: number;
  maxRuns?: number;
  /** Replay buffer per run; older events are dropped beyond this. */
  maxBufferBytes?: number;
  /** Hard limit on one run's duration. */
  timeoutMs?: number;
  /** Serialize local runs on one machine. Injectable for tests. */
  enqueue?: <T>(fn: () => Promise<T>) => Promise<T>;
  queuePosition?: () => number;
}

type Listener = (envelope: RunEnvelope) => void;

interface ServerRun {
  id: string;
  key: string;
  /** The user who started it; only they can follow or cancel it. */
  owner: string;
  state: RunState;
  events: RunEnvelope[];
  nextSeq: number;
  bytes: number;
  listeners: Set<Listener>;
  controller: AbortController;
  createdAt: number;
  startedAt?: number;
  firstTextAt?: number;
  finishedAt?: number;
  orphanTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
}

export type SubscribeResult =
  | { status: 'ok'; replay: RunEnvelope[]; terminal: boolean; unsubscribe: () => void }
  | { status: 'unknown' }
  | { status: 'expired' };

const TERMINAL = new Set<RunEventPayload['type']>(['completed', 'failed', 'canceled']);

export class RunRegistry {
  private runs = new Map<string, ServerRun>();
  private byKey = new Map<string, string>();
  private opts: Required<RunRegistryOptions>;

  constructor(options: RunRegistryOptions = {}) {
    this.opts = {
      orphanMs: 60_000, retainMs: 10 * 60_000, maxRuns: 100, maxBufferBytes: 8_000_000, timeoutMs: 10 * 60_000,
      enqueue: enqueueLocal,
      queuePosition: () => { const q = getLocalQueueStatus(); return q.queueSize + (q.processing ? 1 : 0); },
      ...options,
    };
  }

  /**
   * Start a run, or return the existing run for a repeated idempotency key. Keys are per owner,
   * so one user's key can never return another user's run.
   */
  start(key: string, local: boolean, execute: RunExecutor, owner = ''): { runId: string; existing: boolean } {
    key = `${owner}\n${key}`;
    const known = this.byKey.get(key);
    if (known && this.runs.has(known)) return { runId: known, existing: true };
    this.prune();
    const run: ServerRun = {
      id: randomUUID(), key, owner, state: 'queued', events: [], nextSeq: 1, bytes: 0, listeners: new Set(),
      controller: new AbortController(), createdAt: Date.now(),
    };
    this.runs.set(run.id, run);
    this.byKey.set(key, run.id);
    this.append(run, { type: 'queued', position: local ? this.opts.queuePosition() : 0 });
    run.timeoutTimer = setTimeout(() => this.cancel(run.id, 'timeout'), this.opts.timeoutMs);
    run.timeoutTimer.unref?.();
    this.watchOrphan(run);
    void this.drive(run, local, execute);
    return { runId: run.id, existing: false };
  }

  /** Who started this run, or undefined when the server does not have it. */
  ownerOf(id: string): string | undefined {
    return this.runs.get(id)?.owner;
  }

  state(id: string): RunState | undefined {
    return this.runs.get(id)?.state;
  }

  /** Replay events after `after`, then deliver live events until the terminal event. */
  subscribe(id: string, after: number, listener: Listener): SubscribeResult {
    const run = this.runs.get(id);
    if (!run) return { status: 'unknown' };
    const firstRetained = run.events[0]?.seq ?? run.nextSeq;
    if (after + 1 < firstRetained) return { status: 'expired' };
    const replay = run.events.filter(e => e.seq > after);
    const terminal = run.state !== 'queued' && run.state !== 'running';
    if (terminal) return { status: 'ok', replay, terminal, unsubscribe: () => undefined };
    run.listeners.add(listener);
    clearTimeout(run.orphanTimer);
    return {
      status: 'ok', replay, terminal,
      unsubscribe: () => { run.listeners.delete(listener); this.watchOrphan(run); },
    };
  }

  /** Cancel a queued or running run. Reports the terminal state immediately. */
  cancel(id: string, reason: 'user' | 'no-client' | 'timeout' = 'user'): RunState | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    if (run.state === 'queued' || run.state === 'running') {
      // Record the terminal state before aborting so output produced during the abort is dropped.
      this.finish(run, { type: 'canceled', reason, timing: this.timing(run) });
      run.controller.abort(new Error(`Run canceled: ${reason}`));
    }
    return run.state;
  }

  private async drive(run: ServerRun, local: boolean, execute: RunExecutor) {
    const exec = async () => {
      // A run canceled while queued releases its slot without calling the model.
      if (run.state !== 'queued') return;
      run.state = 'running';
      run.startedAt = Date.now();
      this.append(run, { type: 'started' });
      const result = await execute({
        signal: run.controller.signal,
        emit: payload => {
          if (run.state !== 'running') return;
          if (payload.type === 'delta' && run.firstTextAt === undefined) run.firstTextAt = Date.now();
          this.append(run, payload);
        },
      });
      this.finish(run, { type: 'completed', ...result, timing: this.timing(run) });
    };
    try {
      await (local ? this.opts.enqueue(exec) : exec());
    } catch (error) {
      if (run.controller.signal.aborted) return;
      const failure: ProviderError = error instanceof ProviderFailure
        ? error.error
        : { category: 'unknown', message: ((error as Error)?.message || 'The run failed.').slice(0, 300), retryable: false };
      this.finish(run, { type: 'failed', error: failure, timing: this.timing(run) });
    }
  }

  private timing(run: ServerRun): RunTiming {
    const now = Date.now();
    return {
      queuedMs: (run.startedAt ?? now) - run.createdAt,
      ...(run.firstTextAt !== undefined && run.startedAt !== undefined ? { ttftMs: run.firstTextAt - run.startedAt } : {}),
      durationMs: now - run.createdAt,
    };
  }

  private append(run: ServerRun, event: RunEventPayload) {
    const envelope: RunEnvelope = { v: 1, runId: run.id, seq: run.nextSeq++, ts: Date.now(), event };
    run.events.push(envelope);
    run.bytes += JSON.stringify(envelope).length;
    // Keep the newest events; a client that falls further behind cannot replay and is told so.
    while (run.bytes > this.opts.maxBufferBytes && run.events.length > 1) {
      run.bytes -= JSON.stringify(run.events.shift()).length;
    }
    for (const listener of [...run.listeners]) listener(envelope);
  }

  /** Emit exactly one terminal event per run. */
  private finish(run: ServerRun, event: TerminalPayload) {
    if (run.state !== 'queued' && run.state !== 'running') return;
    run.state = event.type;
    run.finishedAt = Date.now();
    clearTimeout(run.orphanTimer);
    clearTimeout(run.timeoutTimer);
    this.append(run, event);
    run.listeners.clear();
  }

  private watchOrphan(run: ServerRun) {
    if (run.listeners.size || (run.state !== 'queued' && run.state !== 'running')) return;
    clearTimeout(run.orphanTimer);
    run.orphanTimer = setTimeout(() => this.cancel(run.id, 'no-client'), this.opts.orphanMs);
    run.orphanTimer.unref?.();
  }

  private prune() {
    const now = Date.now();
    const finished = [...this.runs.values()].filter(r => r.finishedAt !== undefined).sort((a, b) => a.finishedAt! - b.finishedAt!);
    let excess = this.runs.size - this.opts.maxRuns + 1;
    for (const run of finished) {
      if (now - run.finishedAt! < this.opts.retainMs && excess <= 0) continue;
      this.runs.delete(run.id);
      this.byKey.delete(run.key);
      excess--;
    }
  }
}

export const isTerminal = (event: RunEventPayload) => TERMINAL.has(event.type);
