// Run lifecycle contracts shared by web and server. Type-only.
import type { Capability, ConnectionTarget } from './connections';
import type { BenchResult } from './bench';

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
  /** 'account': the whole connection is affected (bad key, no credits, account-wide free limit), not just this model. */
  scope?: 'account';
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

/** Built-in tools a run may enable. None of them changes anything outside the app. */
export type ToolName = 'calculator' | 'search_documents' | 'read_document' | 'web_search';

export interface ToolTrace {
  /** Matches the running and finished events of one call. Absent on records saved before P6. */
  id?: string;
  name: string;
  input: unknown;
  output: unknown;
  step: number;
  /** 'denied': the tool exists but was not enabled for this run. Absent on records saved before P6. */
  status?: 'running' | 'completed' | 'error' | 'denied';
  error?: string;
  durationMs?: number;
  /** 'computed' by the app, 'retrieved' from the user's documents, or 'web' search results. */
  source?: 'computed' | 'retrieved' | 'web';
}

/** Model text produced while preparing a tool call. It is activity, not part of the final answer. */
export interface ActivityTrace {
  id: string;
  step: number;
  kind: 'preparation';
  status: 'completed';
  text: string;
}

/** What a routed request asks for, as the router classified it. */
export type TaskKind = 'code' | 'math' | 'reasoning' | 'writing' | 'extraction' | 'general';

/** One model the router may use. The client lists only models it has verified as free. */
export interface RouteModel {
  connectionId: string;
  model: string;
  displayName?: string;
  capabilities?: { tools: Capability; vision: Capability };
  contextLength?: number;
}

/** Let the server choose the model: candidates across connections, each connection's key sent once. */
export interface RouteRequest {
  strategy: 'free';
  connections: { id: string; target: ConnectionTarget }[];
  models: RouteModel[];
}

/** One step of the router's decision, shown with the answer. */
export interface RouteStep {
  attempt: number;
  connectionId: string;
  model: string;
  /** 'skipped': never sent (unsuitable or cooling down). 'trying': sent. 'failed': failed before any answer, so the next model was tried. */
  status: 'skipped' | 'trying' | 'failed';
  /** Safe to show: why this model was chosen, skipped, or failed. */
  reason: string;
  category?: ProviderErrorCategory;
}

/** Which model answered a routed run. */
export interface RouteOutcome {
  connectionId: string;
  model: string;
  task: TaskKind;
  /** Models sent the request, including the one that answered. */
  attempts: number;
}

export type RunEventPayload =
  | { type: 'queued'; position: number }
  | { type: 'started' }
  | { type: 'status'; message: string }
  /** The concrete model answering, when a provider's own router chose it (OpenRouter's openrouter/free). */
  | { type: 'model'; model: string; provider?: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | ({ type: 'activity' } & ActivityTrace)
  /** connectionId: set on routed runs, whose quota may come from several connections. */
  | { type: 'quota'; quota: RateLimitState; connectionId?: string }
  | ({ type: 'tool' } & ToolTrace)
  | ({ type: 'route' } & RouteStep)
  /** A Bench job graded one item (result), or skipped planned requests after a limit; done of total requests. */
  | { type: 'bench'; result?: BenchResult; skipped?: number; done: number; total: number }
  /** loadMs: time the runtime reports spending loading the model for this run (Ollama only); a large value means a cold start. */
  | { type: 'completed'; usage?: Usage; finishReason?: string; loadMs?: number; route?: RouteOutcome; timing: RunTiming }
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

interface RunStartBase {
  /** Client-generated; repeating a start with the same key returns the same run. */
  idempotencyKey: string;
  /** Omission is free-only. Paid single-model requests must explicitly use 'any'. Routes remain free-only. */
  costPolicy?: 'free-only' | 'any';
  messages: RunMessage[];
  settings?: { temperature?: number; maxTokens?: number; numCtx?: number };
  /** Tools the model may call. Document tools require `documents` and a model on this machine. */
  tools?: ToolName[];
  documents?: { id: string; title: string; content: string }[];
  /** Required for web_search. The key is used for this run only and never stored or echoed. */
  search?: { provider: 'exa'; apiKey: string };
}

/** Either one explicit model, or a route the server chooses from. */
export type RunStartRequest = RunStartBase & (
  | { target: ConnectionTarget; model: string; route?: undefined }
  | { route: RouteRequest; target?: undefined; model?: undefined }
);

export interface RunStartResponse {
  runId: string;
  /** True when the idempotency key matched an existing run. */
  existing: boolean;
}
