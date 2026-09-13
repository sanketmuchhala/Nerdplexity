// Connection and model catalog contracts shared by web and server.
// Type-only: the server imports these with `import type`.

/** Adapter family used to reach a connection. */
export type ConnectionKind = 'ollama' | 'openai-compatible' | 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'openrouter' | 'groq';

/** Where inference runs, as classified by the server's destination policy. */
export type ExecutionLocation = 'local' | 'remote';

/** 'session' keys live in memory only; 'device' keys are saved in this browser profile. */
export type KeyStorage = 'none' | 'session' | 'device';

/**
 * The user's statement about whether this account can be charged. Nerdplexity
 * cannot read billing settings, so 'no-billing' is recorded as the user's claim.
 */
export type BillingStatus = 'unknown' | 'no-billing' | 'paid';

/** Latest rate-limit headers the provider sent, with when they were seen. */
export interface QuotaSnapshot {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsResetMs?: number;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensResetMs?: number;
  at: number;
}

export interface Connection {
  id: string;
  kind: ConnectionKind;
  name: string;
  /** Required for ollama and openai-compatible. Hosted providers use fixed endpoints. */
  baseURL?: string;
  keyStorage: KeyStorage;
  billing?: BillingStatus;
  quota?: QuotaSnapshot;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What the server needs to reach a connection for one request. Never persisted. */
export interface ConnectionTarget {
  kind: ConnectionKind;
  baseURL?: string;
  apiKey?: string;
}

/** A model selection: always a connection plus a model ID, never inferred from the name. */
export interface ModelRef {
  connectionId: string;
  modelId: string;
}

/** `null` means the source did not report it. */
export type Capability = boolean | null;

export type PricingClass = 'local' | 'zero-price' | 'free-tier' | 'paid' | 'unknown';

export interface ModelDescriptor {
  id: string;
  displayName: string;
  capabilities: { tools: Capability; vision: Capability; temperature?: Capability };
  contextLength?: number;
  maxOutputTokens?: number;
  /** Download size reported by a local runtime. Not a guarantee the model fits in memory. */
  sizeBytes?: number;
  /** Runtime-reported details, e.g. parameter size and quantization. */
  details?: string;
  /** Currently loaded in memory (Ollama only). */
  loaded?: boolean;
  pricing: PricingClass;
  /** USD per million tokens, only when the provider's catalog reports it. */
  price?: { input: number; output: number };
  /** The provider has announced this model's retirement (ISO date). */
  expiresAt?: string;
  source: 'discovered' | 'manual';
}

export type DiscoveryErrorCategory =
  | 'offline'
  | 'auth'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'invalid-response'
  | 'invalid-destination'
  | 'unknown';

export interface DiscoveryError {
  category: DiscoveryErrorCategory;
  message: string;
}

export interface HostInfo {
  platform: string;
  arch: string;
  memory: number;
  cpus: number;
}

export type DiscoveryResult =
  | { ok: true; execution: ExecutionLocation; models: ModelDescriptor[]; host?: HostInfo; checkedAt: number }
  | { ok: false; error: DiscoveryError; checkedAt: number };
