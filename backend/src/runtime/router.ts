import { createHash } from 'crypto';
import type { AgentConfig, ConnectionKind, ExecutionLocation, ResearchDepth, BenchCategory, BenchScore, ProviderError, ProviderErrorCategory, RouteModel, RouteOutcome, RunMessage, TaskKind, ToolName } from '@app/types';
import { AdapterEvent, ModelMessage, ModelRequest, ProviderFailure, streamModel } from './adapters.js';
import { ResolvedTarget } from './destinations.js';
import { runWithTools } from './toolLoop.js';
import { WorkspaceDocument } from './tools.js';
import { enqueueLocal } from '../queue/localQueue.js';
import { withWebResults } from './autoSearch.js';
import type { ProgressPayload, RunContext, RunExecutor } from './runs.js';

type FetchFn = typeof fetch;

/** A candidate after the destination policy accepted its connection. */
export interface RouteCandidate extends RouteModel {
  target: ResolvedTarget;
}

/** What the router needs to know about a request to choose a model. */
export interface TaskProfile {
  kind: TaskKind;
  vision: boolean;
  tools: boolean;
  /** Prompt plus the reserved answer, estimated at four characters per token. */
  estimatedTokens: number;
}

/** Models sent the request at most this many times per run. */
export const MAX_ATTEMPTS = 4;

/**
 * Output reserved when checking whether a request fits a model. A larger request is not refused:
 * it is trimmed to what the model can take (`fitOutput`), so asking for a long answer does not
 * leave every smaller model out.
 */
export const RESERVED_OUTPUT = 4096;

/** Failures that happen before the model answers and may not happen on another model. A refusal is the model's decision and is never routed around. */
const FALLBACK = new Set<ProviderErrorCategory>(['quota', 'unavailable', 'transport', 'timeout', 'missing-model', 'invalid-request', 'context', 'auth']);

const CODE = /```|\b(function|class|def|const|compile[sd]?|stack ?trace|exception|bug|debug|refactor|regex|sql|typescript|javascript|python|rust|golang|java|c\+\+|html|css|endpoint|unit tests?|script|snippet|code)\b/i;
// A minus sign counts only with spaces ("12 - 7"), so dates, phone numbers, and IDs ("2026-09-14") are not math.
const MATH = /\b(solve|equation|integral|derivative|probability|prove|proof|theorem|calculate|compute|percent(age)?|matrix|algebra|geometry|arithmetic)\b|\d\s*[+*/^×÷=]\s*\d|\d\s+-\s+\d|\d\s*%\s*of\b/i;
const EXTRACTION = /\b(json|yaml|csv|table|extract|parse|classify|categori[sz]e|schema|fill in|bullet list)\b/i;
const WRITING = /\b(write|draft|rewrite|rephrase|proofread|essay|e-?mail|letter|story|poem|blog|tweet|summar(y|i[sz]e)|translate|tone|cover letter)\b/i;
const REASONING = /\b(why|explain|reason(ing)?|compare|trade-?offs?|pros and cons|step by step|analy[sz]e|plan|design|puzzle|riddle|logic)\b/i;

const textOf = (content: RunMessage['content']) => typeof content === 'string' ? content : content.map(part => part.type === 'text' ? part.text : '').join('\n');

/** Classify the latest request from its wording, and what any model must support to take it. */
export function profileTask(messages: RunMessage[], tools: ToolName[], maxTokens = 2048): TaskProfile {
  const last = [...messages].reverse().find(message => message.role === 'user');
  const text = last ? textOf(last.content) : '';
  const kind: TaskKind = CODE.test(text) ? 'code'
    : MATH.test(text) ? 'math'
      : EXTRACTION.test(text) ? 'extraction'
        : WRITING.test(text) ? 'writing'
          : REASONING.test(text) ? 'reasoning'
            : 'general';
  let characters = 0;
  let images = 0;
  for (const message of messages) {
    characters += textOf(message.content).length;
    if (Array.isArray(message.content)) images += message.content.filter(part => part.type === 'image').length;
  }
  return { kind, vision: images > 0, tools: tools.length > 0, estimatedTokens: Math.ceil(characters / 4) + images * 1000 + Math.min(maxTokens, RESERVED_OUTPUT) };
}

/** The prompt's size in tokens, estimated at four characters per token plus 1,000 an image. */
export function promptTokens(messages: RunMessage[]): number {
  let characters = 0;
  let images = 0;
  for (const message of messages) {
    characters += textOf(message.content).length;
    if (Array.isArray(message.content)) images += message.content.filter(part => part.type === 'image').length;
  }
  return Math.ceil(characters / 4) + images * 1000;
}

/**
 * The output limit to send this model: what was asked, capped by what the provider allows and by
 * what is left of the model's context after the prompt. Undefined when the request fits as it is.
 */
export function fitOutput(asked: number | undefined, candidate: RouteCandidate, messages: RunMessage[]): number | undefined {
  if (!asked) return undefined;
  const room = candidate.contextLength ? candidate.contextLength - promptTokens(messages) - 256 : Infinity;
  const fitted = Math.min(asked, candidate.maxOutputTokens ?? Infinity, room);
  return fitted < asked ? Math.max(256, Math.floor(fitted)) : undefined;
}

/** Total parameters in billions from a model ID ("llama-3.3-70b", "mixtral-8x7b"). "a12b" is an active count and is ignored. */
export function parameterBillions(id: string): number | undefined {
  const name = id.toLowerCase();
  const experts = /(\d+)x(\d+(?:\.\d+)?)b\b/.exec(name);
  if (experts) return Number(experts[1]) * Number(experts[2]);
  const sizes = [...name.matchAll(/(?<![a-z0-9.])(\d+(?:\.\d+)?)b\b/g)].map(match => Number(match[1])).filter(n => n > 0 && n < 5000);
  return sizes.length ? Math.max(...sizes) : undefined;
}

/** Routers that pick a model themselves; kept as the last resort because their choice cannot be ranked. */
export const isMetaRouter = (id: string) => /^openrouter\/(free|auto)$/.test(id);

// ---------------------------------------------------------------------------
// Health: what recent runs on this server showed about each model and account.

interface ModelHealth {
  successes: number;
  failures: number;
  /** Exponentially weighted first-text latency. */
  ttftMs?: number;
  cooldownUntil?: number;
  /** Why it is cooling, so the "none left" message can name the cause instead of guessing. */
  cooldownCategory?: ProviderErrorCategory;
  lastFailureAt?: number;
}

const MAX_TRACKED = 2000;
// A model the provider cannot serve at all is set aside for hours, not seconds: without that it is
// re-ranked first on every step of every run (a free 550B model with a 1M context tops the ranking),
// and each step wastes its first attempt discovering the same thing again.
const COOLDOWN: Partial<Record<ProviderErrorCategory, number>> = { quota: 60_000, unavailable: 30_000, transport: 20_000, timeout: 30_000, auth: 10 * 60_000, 'missing-model': 6 * 60 * 60_000 };
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

/** An account is its provider, address, and key, so changing a key starts fresh. Keys are hashed, never kept. */
export function accountOf(owner: string, target: ResolvedTarget): string {
  return createHash('sha256').update(`${owner}\n${target.kind}\n${target.baseURL}\n${target.apiKey ?? ''}`).digest('hex').slice(0, 24);
}

export class RouterHealth {
  private models = new Map<string, ModelHealth>();
  private accounts = new Map<string, { until: number; category: ProviderErrorCategory }>();

  constructor(readonly now: () => number = Date.now) {}

  private entry(account: string, model: string): ModelHealth {
    const key = `${account}\n${model}`;
    let entry = this.models.get(key);
    if (!entry) {
      if (this.models.size >= MAX_TRACKED) this.models.delete(this.models.keys().next().value!);
      entry = { successes: 0, failures: 0 };
      this.models.set(key, entry);
    }
    return entry;
  }

  peek(account: string, model: string): Readonly<ModelHealth> | undefined {
    return this.models.get(`${account}\n${model}`);
  }

  /** When this model can be tried again, or undefined when it can be tried now. */
  coolingUntil(account: string, model: string): number | undefined {
    const now = this.now();
    const until = Math.max(this.accounts.get(account)?.until ?? 0, this.peek(account, model)?.cooldownUntil ?? 0);
    return until > now ? until : undefined;
  }

  /** Why this model is cooling: the account's reason first, since it covers every model on it. */
  coolingCause(account: string, model: string): ProviderErrorCategory | undefined {
    const now = this.now();
    const account_ = this.accounts.get(account);
    if (account_ && account_.until > now) return account_.category;
    const entry = this.peek(account, model);
    return entry?.cooldownUntil && entry.cooldownUntil > now ? entry.cooldownCategory : undefined;
  }

  success(account: string, model: string, ttftMs?: number) {
    const entry = this.entry(account, model);
    entry.successes++;
    entry.cooldownUntil = undefined;
    // A completed authenticated request proves this account is usable, including when another
    // parallel request incorrectly reported an account-wide authorization failure.
    this.accounts.delete(account);
    if (ttftMs !== undefined) entry.ttftMs = entry.ttftMs === undefined ? ttftMs : Math.round(entry.ttftMs * 0.7 + ttftMs * 0.3);
  }

  failure(account: string, model: string, error: ProviderError) {
    const entry = this.entry(account, model);
    const now = this.now();
    entry.failures++;
    entry.lastFailureAt = now;
    const base = COOLDOWN[error.category];
    if (base === undefined) return;
    const until = now + Math.min(Math.max(error.retryAfterMs ?? base, 1000), MAX_COOLDOWN_MS);
    if (error.scope === 'account') this.accounts.set(account, { until, category: error.category });
    else { entry.cooldownUntil = until; entry.cooldownCategory = error.category; }
  }
}

/**
 * Requests a free account allows in a minute, as the providers publish them. Used to space requests
 * out, not to count them: the aim is to stay under the limit rather than discover it by being
 * refused, because one refusal on a shared free-model limit cools every model on the account.
 */
const PER_MINUTE: Partial<Record<ConnectionKind, number>> = {
  openrouter: 20, groq: 30, cerebras: 5, gemini: 15, mistral: 60, sambanova: 20, huggingface: 30, deepseek: 60, openai: 60, anthropic: 60,
};
const DEFAULT_PER_MINUTE = 20;
/** Share of the published per-minute limit to aim for, leaving room for retries and other clients. */
const HEADROOM = 0.8;

export const sleepUntil = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Canceled')); };
  signal.addEventListener('abort', stop, { once: true });
});

/**
 * Spaces requests to one account, so parallel steps (drafts, research readers) do not arrive as a
 * burst that the provider rate limits. Models on this machine are not spaced; they queue instead.
 */
export class AccountPacer {
  private nextAt = new Map<string, number>();

  constructor(private now: () => number = Date.now, private sleep = sleepUntil) {}

  /**
   * The gap this provider's free limit implies between two requests. We aim at a fraction of the
   * published limit: spacing exactly at the limit leaves no room for a retry, a second tab, or a
   * slow clock, and one refusal on a shared free-model limit cools every model on the account.
   */
  gap(kind: ConnectionKind, execution: ExecutionLocation): number {
    return execution === 'local' ? 0 : Math.ceil(60_000 / ((PER_MINUTE[kind] ?? DEFAULT_PER_MINUTE) * HEADROOM));
  }

  /** Waits until this account's next slot, and books it. */
  async take(account: string, kind: ConnectionKind, execution: ExecutionLocation, signal: AbortSignal): Promise<void> {
    const gap = this.gap(kind, execution);
    if (!gap) return;
    const now = this.now();
    const at = Math.max(now, this.nextAt.get(account) ?? 0);
    this.nextAt.set(account, at + gap);
    if (at > now) await this.sleep(at - now, signal);
  }
}

// ---------------------------------------------------------------------------
// Ranking

export interface RankedCandidate {
  candidate: RouteCandidate;
  score: number;
  /** Short phrases explaining the choice. */
  why: string[];
}

export interface Ranking {
  ranked: RankedCandidate[];
  /** Why candidates were left out, by reason, for the message when none remain. */
  excluded: Record<string, number>;
  /** What most of the cooling-down candidates are cooling from, so the message can say so. */
  coolingCause?: ProviderErrorCategory;
  /** Soonest time a cooling-down candidate becomes available. */
  nextAvailableAt?: number;
}

/** Bench results per model ("connectionId\nmodel") and category. */
export type BenchIndex = Map<string, Partial<Record<BenchCategory, { passed: number; failed: number }>>>;

export function benchIndex(scores: BenchScore[]): BenchIndex {
  const index: BenchIndex = new Map();
  for (const score of scores) {
    const key = `${score.connectionId}\n${score.model}`;
    index.set(key, { ...index.get(key), [score.category]: { passed: score.passed, failed: score.failed } });
  }
  return index;
}

/** The Bench categories that measure what each kind of request needs. */
const TASK_BENCH: Record<TaskKind, BenchCategory[]> = {
  code: ['code'], math: ['math'], reasoning: ['math', 'facts'], writing: ['instructions'], extraction: ['instructions'], general: ['facts', 'instructions'],
};
const BENCH_LABEL: Record<BenchCategory, string> = { code: 'code', math: 'math', instructions: 'instruction', tools: 'tool', facts: 'reading' };
/** Graded answers needed before Bench counts at all. */
const BENCH_MIN = 3;

const CODE_MODEL = /coder|codestral|devstral|\bcode/i;
const REASONING_MODEL = /(^|[-/_.])r1\b|reason|think|qwq|magistral|math/i;

export function rankCandidates(candidates: RouteCandidate[], task: TaskProfile, health: RouterHealth, owner: string, bench?: BenchIndex): Ranking {
  const excluded: Record<string, number> = {};
  const causes: Partial<Record<ProviderErrorCategory, number>> = {};
  const exclude = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  let nextAvailableAt: number | undefined;
  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const { model, capabilities, contextLength, target } = candidate;
    if (task.vision && capabilities?.vision === false) { exclude('cannot read images'); continue; }
    if (task.tools && capabilities?.tools === false) { exclude('cannot use tools'); continue; }
    if (contextLength && task.estimatedTokens > contextLength) { exclude('context too small'); continue; }
    const account = accountOf(owner, target);
    const cooling = health.coolingUntil(account, model);
    if (cooling) {
      exclude('cooling down after a failure');
      const cause = health.coolingCause(account, model);
      if (cause) causes[cause] = (causes[cause] ?? 0) + 1;
      nextAvailableAt = Math.min(nextAvailableAt ?? cooling, cooling);
      continue;
    }

    const why: string[] = [];
    const size = parameterBillions(model);
    // log scale: 1B → 0, 10B → 0.33, 100B → 0.67, 1T → 1. Unknown size is neutral.
    let score = size ? Math.min(1, Math.max(0, Math.log10(size) / 3)) : 0.5;
    if (size) why.push(`${size >= 10 ? Math.round(size) : size}B parameters`);

    const coder = CODE_MODEL.test(model);
    const reasoner = REASONING_MODEL.test(model);
    if (task.kind === 'code' && coder) { score += 0.25; why.push('coding model'); }
    if ((task.kind === 'math' || task.kind === 'reasoning') && reasoner) { score += 0.2; why.push('reasoning model'); }
    if ((task.kind === 'writing' || task.kind === 'general') && coder) score -= 0.15;
    if ((task.kind === 'writing' || task.kind === 'general' || task.kind === 'extraction') && reasoner) score -= 0.05;

    if (task.tools) {
      if (capabilities?.tools === true) { score += 0.05; why.push('supports tools'); }
      else score -= 0.25;
    }
    if (task.vision) {
      if (capabilities?.vision === true) why.push('reads images');
      else score -= 0.3;
    }
    if (!contextLength) score -= 0.05;
    else if (task.estimatedTokens > 16_000 && contextLength >= task.estimatedTokens * 4) { score += 0.1; why.push('large context'); }
    if (target.execution === 'local') { score -= 0.1; why.push('on this machine'); }

    // Measured answers outweigh guesses from the name: a model that passes Bench moves up, one that fails moves down.
    const measured = bench?.get(`${candidate.connectionId}\n${model}`);
    if (measured) {
      const categories = [...TASK_BENCH[task.kind], ...(task.tools ? ['tools' as const] : [])];
      let passed = 0;
      let graded = 0;
      for (const category of categories) {
        passed += measured[category]?.passed ?? 0;
        graded += (measured[category]?.passed ?? 0) + (measured[category]?.failed ?? 0);
      }
      if (graded >= BENCH_MIN) {
        // A smoothed pass rate (one pass and one fail assumed), trusted more with each graded answer:
        // 3 answers count half, 10 about three quarters. Enough to outweigh a size guess once results disagree.
        const rate = (passed + 1) / (graded + 2);
        score += graded / (graded + 3) * 1.2 * (rate - 0.5);
        why.push(`passed ${passed} of ${graded} Bench ${categories.map(c => BENCH_LABEL[c]).join(' and ')} tests`);
      }
    }

    const seen = health.peek(account, model);
    if (seen) {
      const total = seen.successes + seen.failures;
      if (total >= 2) {
        score += 0.25 * (seen.successes / total - 0.75);
        why.push(`answered ${seen.successes} of ${total} recent requests`);
      }
      if (seen.ttftMs !== undefined && seen.ttftMs > 8000) score -= 0.1;
      if (seen.lastFailureAt !== undefined && health.now() - seen.lastFailureAt < 120_000) score -= 0.1;
    }
    if (isMetaRouter(model)) { score -= 10; why.splice(0, why.length, "OpenRouter's own free router, as a last resort"); }
    ranked.push({ candidate, score, why });
  }
  ranked.sort((a, b) => b.score - a.score || a.candidate.model.localeCompare(b.candidate.model) || a.candidate.connectionId.localeCompare(b.candidate.connectionId));
  // The cause most of the cooling models share, so "none left" can name it rather than guess.
  const coolingCause = (Object.entries(causes) as [ProviderErrorCategory, number][])
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return { ranked, excluded, ...(coolingCause ? { coolingCause } : {}), ...(nextAvailableAt !== undefined ? { nextAvailableAt } : {}) };
}

// ---------------------------------------------------------------------------
// Execution

export interface RoutedRun {
  owner: string;
  candidates: RouteCandidate[];
  /** Everything about the request except the model. */
  request: Omit<ModelRequest, 'target' | 'model' | 'messages'>;
  messages: RunMessage[];
  tools: ToolName[];
  documents: WorkspaceDocument[];
  /** auto: search the web once before the first attempt when the message needs it. */
  search?: { apiKey: string; auto?: boolean };
  /** The user's Free Agent settings, already checked against the candidates. */
  agent?: AgentConfig;
  /** Deep Research depth, already checked. */
  research?: { depth: ResearchDepth };
}

export interface RouterDeps {
  health: RouterHealth;
  /** Spaces requests to each account, shared by every run on this server. */
  pacer?: AccountPacer;
  /** This user's Bench results, when any. */
  bench?: BenchIndex;
  fetchImpl?: FetchFn;
  /** Serializes models on this machine; the run itself is not queued because most candidates are remote. */
  enqueue?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Waits out a short cooldown. Replaced in tests so a wait does not take a real minute. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const TASK_LABEL: Record<TaskKind, string> = {
  code: 'coding', math: 'math', reasoning: 'reasoning', writing: 'writing', extraction: 'structured output', general: 'general questions',
};

function seconds(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

/**
 * What to tell the user when every model is set aside. The reason matters: a rejected key is fixed
 * in seconds by pasting a new one, a used-up daily allowance is not fixed by waiting a minute, and a
 * model the provider never serves is not the user's problem at all. Saying "per-minute limits" for
 * all three sent the owner chasing the wrong thing twice.
 */
function coolingAdvice(cause: ProviderErrorCategory | undefined): string {
  if (cause === 'auth') return 'The provider rejected the API key, so every model on that account is set aside. Check the key under Connections; saving a working key clears this at once, because a new key counts as a new account.';
  if (cause === 'missing-model') return 'The provider lists these models but has no working endpoint for them. They are set aside for a few hours; this is the provider\'s catalog, not your key.';
  if (cause === 'quota') return 'Free models have per-account limits: OpenRouter allows 20 requests a minute and 50 a day, or 1,000 a day once an account has bought $10 of credit. Deep Research uses 10 to 25 requests per run. Connecting another provider (Groq, Cerebras, Gemini) spreads the load.';
  return 'Free models have per-minute and daily limits on each account; connecting another provider (Groq, Cerebras, Gemini) spreads the load.';
}

export function noneLeft(ranking: Ranking, tried: number, now: number, last?: ProviderError): ProviderFailure {
  const reasons = Object.entries(ranking.excluded).map(([reason, count]) => `${count} ${reason}`);
  const wait = ranking.nextAvailableAt !== undefined ? ranking.nextAvailableAt - now : undefined;
  const cooling = Object.keys(ranking.excluded).length === 1 && ranking.excluded['cooling down after a failure'] > 0;
  const parts = [
    tried ? `${tried} free model${tried === 1 ? '' : 's'} failed${last ? ` (last: ${last.message})` : ''}.` : 'No free model can take this request.',
    reasons.length ? `Left out: ${reasons.join(', ')}.` : '',
    wait !== undefined ? `The next one is available in ${seconds(wait)}.` : '',
    // Free models share their provider's limits, so one account can run out all at once.
    cooling ? coolingAdvice(ranking.coolingCause ?? last?.category) : '',
  ];
  return new ProviderFailure({
    category: last?.category ?? (wait !== undefined ? 'quota' : 'invalid-request'),
    message: parts.filter(Boolean).join(' '),
    retryable: wait !== undefined || !!last?.retryable,
    ...(wait !== undefined ? { retryAfterMs: Math.max(0, wait) } : {}),
  });
}

export type DoneEvent = Extract<AdapterEvent, { type: 'done' }>;

/** What one "best model, then the next" step needs. The Free Router and every Free Agent step use it. */
export interface AttemptContext {
  owner: string;
  health: RouterHealth;
  request: Omit<ModelRequest, 'target' | 'model' | 'messages'>;
  messages: RunMessage[];
  tools: ToolName[];
  documents: WorkspaceDocument[];
  search?: { apiKey: string; auto?: boolean };
  signal: AbortSignal;
  fetchImpl: FetchFn;
  enqueue: <T>(fn: () => Promise<T>) => Promise<T>;
  maxAttempts: number;
  /** Accounts found unusable earlier in this run (a bad key, an account-wide limit), shared between steps. */
  blockedAccounts: Set<string>;
  /** Accounts that already completed a request in this run. Shared by multi-step agents. */
  successfulAccounts?: Set<string>;
  /** Spaces requests to one account; without it they are sent as fast as they are made. */
  pacer?: AccountPacer;
}

export interface AttemptHooks {
  /** A model is about to be sent the request. `previous` names the model that just failed. */
  trying?: (candidate: RankedCandidate, attempt: number, previous?: string) => void;
  /** It failed before answering; the next model will be tried. */
  failed?: (candidate: RankedCandidate, attempt: number, error: ProviderError) => void;
  /** Every stream event except the final one. Quota events carry the connection ID. */
  event?: (event: ProgressPayload, candidate: RouteCandidate) => void;
}

export type AttemptResult =
  | { ok: true; ranked: RankedCandidate; done: DoneEvent; text: string; attempts: number }
  | { ok: false; attempts: number; last?: ProviderError };

/**
 * Send a request to the ranked models in order until one answers. A model that fails before any
 * output (text, reasoning, activity, or a tool call) is left for the next; after output, or on a
 * refusal, the failure is thrown, because switching models would splice two answers together or
 * shop for a model that complies. Returns the answer text as well as streaming it through hooks.
 */
/** The vendor that actually runs a model ("nvidia/nemotron-3-ultra-550b-a55b:free" -> "nvidia"). */
const vendorOf = (candidate: RouteCandidate) =>
  (candidate.model.includes('/') ? candidate.model.split('/', 1)[0] : candidate.connectionId).toLowerCase();

/**
 * The ranking, reordered so consecutive attempts prefer different vendors while each vendor keeps
 * its own order. Ranking by size puts one vendor's family at the top together (OpenRouter's two
 * largest free models are both NVIDIA), so a vendor-wide outage could use up a two-attempt step
 * before any other vendor was asked. The best model is still tried first; only the fallbacks move.
 */
export function spreadByVendor(ranked: RankedCandidate[]): RankedCandidate[] {
  const groups = new Map<string, RankedCandidate[]>();
  for (const entry of ranked) {
    const vendor = vendorOf(entry.candidate);
    const group = groups.get(vendor);
    if (group) group.push(entry);
    else groups.set(vendor, [entry]);
  }
  if (groups.size < 2) return ranked;
  const queues = [...groups.values()];
  const spread: RankedCandidate[] = [];
  for (let round = 0; spread.length < ranked.length; round++) {
    for (const queue of queues) if (queue[round]) spread.push(queue[round]);
  }
  return spread;
}

export async function tryInOrder(list: RankedCandidate[], ctx: AttemptContext, hooks: AttemptHooks = {}): Promise<AttemptResult> {
  const ranked = spreadByVendor(list);
  let attempts = 0;
  let last: ProviderError | undefined;
  let previous: string | undefined;
  for (const entry of ranked) {
    if (attempts >= ctx.maxAttempts) break;
    const { candidate } = entry;
    const account = accountOf(ctx.owner, candidate.target);
    if (ctx.blockedAccounts.has(account) || ctx.health.coolingUntil(account, candidate.model)) continue;
    attempts++;
    hooks.trying?.(entry, attempts, previous);
    // Wait for this account's next slot, so parallel steps do not arrive as a burst.
    await ctx.pacer?.take(account, candidate.target.kind, candidate.target.execution, ctx.signal);
    // Ask for no more output than this model can give, so a long answer is trimmed, not refused.
    const fitted = fitOutput(ctx.request.maxTokens, candidate, ctx.messages);
    const request: ModelRequest = {
      ...ctx.request, ...(fitted !== undefined ? { maxTokens: fitted } : {}),
      target: candidate.target, model: candidate.model, messages: ctx.messages as ModelMessage[], waitOnRateLimit: false, freeOnly: true,
    };
    const sentAt = Date.now();
    let answeredAt: number | undefined;
    let text = '';
    const attempt = async () => {
      const events = ctx.tools.length
        ? runWithTools(request, ctx.tools, ctx.documents, ctx.signal, ctx.fetchImpl, ctx.search)
        : streamModel(request, ctx.signal, ctx.fetchImpl);
      for await (const event of events) {
        if (event.type === 'done') return event;
        if (event.type === 'quota') { hooks.event?.({ ...event, connectionId: candidate.connectionId }, candidate); continue; }
        if (event.type === 'delta' || event.type === 'reasoning' || event.type === 'activity' || event.type === 'tool') answeredAt ??= Date.now();
        if (event.type === 'delta') text += event.text;
        hooks.event?.(event, candidate);
      }
      throw new Error('The model stream ended without a result.');
    };
    try {
      const done = candidate.target.execution === 'local' ? await ctx.enqueue(attempt) : await attempt();
      ctx.health.success(account, candidate.model, answeredAt !== undefined ? answeredAt - sentAt : undefined);
      ctx.successfulAccounts?.add(account);
      ctx.blockedAccounts.delete(account);
      return { ok: true, ranked: entry, done, text, attempts };
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      if (!(error instanceof ProviderFailure)) throw error;
      // A key that worked earlier in this run is not globally invalid. OpenRouter can surface an
      // upstream route's 401/403 as if the account key failed; treat that as a model-route outage.
      const alreadyWorked = candidate.target.kind === 'openrouter' && ctx.successfulAccounts?.has(account)
        && error.error.category === 'auth' && error.error.scope === 'account';
      const failure: ProviderError = alreadyWorked
        ? { category: 'unavailable', message: 'This model route rejected the request, but the provider account is working. Trying another free model may work.', retryable: true }
        : error.error;
      ctx.health.failure(account, candidate.model, failure);
      if (answeredAt !== undefined || !FALLBACK.has(failure.category)) throw (alreadyWorked ? new ProviderFailure(failure) : error);
      if (failure.scope === 'account') ctx.blockedAccounts.add(account);
      last = failure;
      previous = candidate.displayName || candidate.model;
      hooks.failed?.(entry, attempts, failure);
    }
  }
  return { ok: false, attempts, ...(last ? { last } : {}) };
}

/**
 * Run a request on the best free model, trying the next one when a model fails before answering.
 * Once any answer text, reasoning, or tool call has been shown, the run stays on that model: a
 * partial answer is never silently continued by a different model. Every attempt is reported.
 */
export function routedExecutor(run: RoutedRun, deps: RouterDeps): RunExecutor {
  const { health, bench, fetchImpl = fetch, enqueue = enqueueLocal } = deps;
  return async ({ signal, emit }: RunContext) => {
    // One search serves every attempt; its results count toward each model's context.
    const messages = run.search?.auto ? await withWebResults(run.messages, run.search.apiKey, signal, emit, fetchImpl) : run.messages;
    const task = profileTask(messages, run.tools, run.request.maxTokens);
    const ranking = rankCandidates(run.candidates, task, health, run.owner, bench);
    const result = await tryInOrder(ranking.ranked, {
      owner: run.owner, health, request: run.request, messages, tools: run.tools, documents: run.documents, search: run.search,
      signal, fetchImpl, enqueue, maxAttempts: MAX_ATTEMPTS, blockedAccounts: new Set(), successfulAccounts: new Set(), ...(deps.pacer ? { pacer: deps.pacer } : {}),
    }, {
      trying: ({ candidate, why }, attempt, previous) => {
        const lead = attempt === 1 ? `Best free match for ${TASK_LABEL[task.kind]}` : `Trying the next model after ${previous} failed`;
        emit({ type: 'route', attempt, connectionId: candidate.connectionId, model: candidate.model, status: 'trying', reason: why.length ? `${lead}: ${why.join(', ')}.` : `${lead}.` });
      },
      failed: ({ candidate }, attempt, error) => {
        emit({ type: 'route', attempt, connectionId: candidate.connectionId, model: candidate.model, status: 'failed', reason: error.message, category: error.category });
      },
      event: event => emit(event),
    });
    if (!result.ok) throw noneLeft(ranking, result.attempts, health.now(), result.last);
    const { candidate } = result.ranked;
    const route: RouteOutcome = { connectionId: candidate.connectionId, model: candidate.model, task: task.kind, attempts: result.attempts };
    return { usage: result.done.usage, finishReason: result.done.finishReason, ...(result.done.loadMs !== undefined ? { loadMs: result.done.loadMs } : {}), route };
  };
}
