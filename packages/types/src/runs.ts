// Run lifecycle contracts shared by web and server. Type-only.
import type { ConnectionTarget } from './connections';

export type RunState = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type ProviderErrorCategory =
  | 'auth'
  | 'quota'
  | 'unavailable'
  | 'invalid-request'
  | 'context'
  | 'refused'
  | 'transport'
  | 'timeout'
  | 'unknown';

export interface ProviderError {
  category: ProviderErrorCategory;
  /** Safe to show: never contains credentials. */
  message: string;
  /** Whether trying again later may succeed. Only short rate-limit waits, before any generation, are retried automatically. */
  retryable: boolean;
  retryAfterMs?: number;
}

/** Rate-limit state reported in provider response headers. Meaning of the window varies by provider. */
export interface RateLimitState {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsResetMs?: number;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensResetMs?: number;
}

export interface RunTiming {
  /** Time spent waiting for the local model queue. */
  queuedMs: number;
  /** From dispatch to the model until the first answer text. Absent when no text arrived. */
  ttftMs?: number;
  /** From run creation to the terminal event. */
  durationMs: number;
}

export interface ToolTrace {
  name: string;
  input: unknown;
  output: unknown;
  step: number;
}

export type RunEventPayload =
  | { type: 'queued'; position: number }
  | { type: 'started' }
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'quota'; quota: RateLimitState }
  | ({ type: 'tool' } & ToolTrace)
  /** loadMs: time the runtime reports spending loading the model for this run (Ollama only); a large value means a cold start. */
  | { type: 'completed'; usage?: Usage; finishReason?: string; loadMs?: number; timing: RunTiming }
  | { type: 'failed'; error: ProviderError; timing: RunTiming }
  | { type: 'canceled'; reason: 'user' | 'no-client' | 'timeout'; timing: RunTiming };

export type TerminalPayload = Extract<RunEventPayload, { type: 'completed' | 'failed' | 'canceled' }>;

export interface RunEnvelope {
  v: 1;
  runId: string;
  /** Monotonically increasing from 1 within a run. */
  seq: number;
  ts: number;
  event: RunEventPayload;
}

export interface RunMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | RunContentPart[];
}

export type RunContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string };

export interface RunStartRequest {
  /** Client-generated; repeating a start with the same key returns the same run. */
  idempotencyKey: string;
  target: ConnectionTarget;
  model: string;
  messages: RunMessage[];
  settings?: { temperature?: number; maxTokens?: number; numCtx?: number };
  agent?: boolean;
  documents?: { id: string; title: string; content: string }[];
}

export interface RunStartResponse {
  runId: string;
  /** True when the idempotency key matched an existing run. */
  existing: boolean;
}
