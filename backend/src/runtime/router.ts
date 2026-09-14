import { createHash } from 'crypto';
import type { ProviderError, ProviderErrorCategory, RouteModel, RouteOutcome, RunMessage, TaskKind, ToolName } from '@app/types';
import { ModelMessage, ModelRequest, ProviderFailure, streamModel } from './adapters.js';
import { ResolvedTarget } from './destinations.js';
import { runWithTools } from './toolLoop.js';
import { WorkspaceDocument } from './tools.js';
import { enqueueLocal } from '../queue/localQueue.js';
import type { RunContext, RunExecutor } from './runs.js';

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

/** Failures that happen before the model answers and may not happen on another model. A refusal is the model's decision and is never routed around. */
const FALLBACK = new Set<ProviderErrorCategory>(['quota', 'unavailable', 'transport', 'timeout', 'invalid-request', 'context', 'auth']);

const CODE = /```|\b(function|class|def|const|compile[sd]?|stack ?trace|exception|bug|debug|refactor|regex|sql|typescript|javascript|python|rust|golang|java|c\+\+|html|css|endpoint|unit tests?|script|snippet|code)\b/i;
const MATH = /\b(solve|equation|integral|derivative|probability|prove|proof|theorem|calculate|compute|percent(age)?|matrix|algebra|geometry|arithmetic)\b|\d\s*[-+*/^×÷=]\s*\d/i;
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
  return { kind, vision: images > 0, tools: tools.length > 0, estimatedTokens: Math.ceil(characters / 4) + images * 1000 + maxTokens };
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
const isMetaRouter = (id: string) => /^openrouter\/(free|auto)$/.test(id);

// ---------------------------------------------------------------------------
// Health: what recent runs on this server showed about each model and account.

interface ModelHealth {
  successes: number;
  failures: number;
  /** Exponentially weighted first-text latency. */
  ttftMs?: number;
  cooldownUntil?: number;
  lastFailureAt?: number;
}

const MAX_TRACKED = 2000;
const COOLDOWN: Partial<Record<ProviderErrorCategory, number>> = { quota: 60_000, unavailable: 30_000, transport: 20_000, timeout: 30_000, auth: 10 * 60_000 };
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

/** An account is its provider, address, and key, so changing a key starts fresh. Keys are hashed, never kept. */
export function accountOf(owner: string, target: ResolvedTarget): string {
  return createHash('sha256').update(`${owner}\n${target.kind}\n${target.baseURL}\n${target.apiKey ?? ''}`).digest('hex').slice(0, 24);
}

export class RouterHealth {
  private models = new Map<string, ModelHealth>();
  private accounts = new Map<string, number>();

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
    const until = Math.max(this.accounts.get(account) ?? 0, this.peek(account, model)?.cooldownUntil ?? 0);
    return until > now ? until : undefined;
  }

  success(account: string, model: string, ttftMs?: number) {
    const entry = this.entry(account, model);
    entry.successes++;
    entry.cooldownUntil = undefined;
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
    if (error.scope === 'account') this.accounts.set(account, until);
    else entry.cooldownUntil = until;
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
  /** Soonest time a cooling-down candidate becomes available. */
  nextAvailableAt?: number;
}

const CODE_MODEL = /coder|codestral|devstral|\bcode/i;
const REASONING_MODEL = /(^|[-/_.])r1\b|reason|think|qwq|magistral|math/i;

export function rankCandidates(candidates: RouteCandidate[], task: TaskProfile, health: RouterHealth, owner: string): Ranking {
  const excluded: Record<string, number> = {};
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
    if (cooling) { exclude('cooling down after a failure'); nextAvailableAt = Math.min(nextAvailableAt ?? cooling, cooling); continue; }

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
  return { ranked, excluded, ...(nextAvailableAt !== undefined ? { nextAvailableAt } : {}) };
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
  search?: { apiKey: string };
}

export interface RouterDeps {
  health: RouterHealth;
  fetchImpl?: FetchFn;
  /** Serializes models on this machine; the run itself is not queued because most candidates are remote. */
  enqueue?: <T>(fn: () => Promise<T>) => Promise<T>;
}

const TASK_LABEL: Record<TaskKind, string> = {
  code: 'coding', math: 'math', reasoning: 'reasoning', writing: 'writing', extraction: 'structured output', general: 'general questions',
};

function seconds(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

function noneLeft(ranking: Ranking, tried: number, now: number, last?: ProviderError): ProviderFailure {
  const reasons = Object.entries(ranking.excluded).map(([reason, count]) => `${count} ${reason}`);
  const wait = ranking.nextAvailableAt !== undefined ? ranking.nextAvailableAt - now : undefined;
  const parts = [
    tried ? `${tried} free model${tried === 1 ? '' : 's'} failed${last ? ` (last: ${last.message})` : ''}.` : 'No free model can take this request.',
    reasons.length ? `Left out: ${reasons.join(', ')}.` : '',
    wait !== undefined ? `The next one is available in ${seconds(wait)}.` : '',
  ];
  return new ProviderFailure({
    category: last?.category ?? (wait !== undefined ? 'quota' : 'invalid-request'),
    message: parts.filter(Boolean).join(' '),
    retryable: wait !== undefined || !!last?.retryable,
    ...(wait !== undefined ? { retryAfterMs: Math.max(0, wait) } : {}),
  });
}

/**
 * Run a request on the best free model, trying the next one when a model fails before answering.
 * Once any answer text, reasoning, or tool call has been shown, the run stays on that model: a
 * partial answer is never silently continued by a different model. Every attempt is reported.
 */
export function routedExecutor(run: RoutedRun, deps: RouterDeps): RunExecutor {
  const { health, fetchImpl = fetch, enqueue = enqueueLocal } = deps;
  return async ({ signal, emit }: RunContext) => {
    const task = profileTask(run.messages, run.tools, run.request.maxTokens);
    const ranking = rankCandidates(run.candidates, task, health, run.owner);
    const blockedAccounts = new Set<string>();
    let attempts = 0;
    let last: ProviderError | undefined;
    let previous: string | undefined;

    for (const { candidate, why } of ranking.ranked) {
      if (attempts >= MAX_ATTEMPTS) break;
      const account = accountOf(run.owner, candidate.target);
      if (blockedAccounts.has(account) || health.coolingUntil(account, candidate.model)) continue;
      attempts++;
      const lead = attempts === 1 ? `Best free match for ${TASK_LABEL[task.kind]}` : `Trying the next model after ${previous} failed`;
      emit({ type: 'route', attempt: attempts, connectionId: candidate.connectionId, model: candidate.model, status: 'trying', reason: why.length ? `${lead}: ${why.join(', ')}.` : `${lead}.` });

      const request: ModelRequest = { ...run.request, target: candidate.target, model: candidate.model, messages: run.messages as ModelMessage[], waitOnRateLimit: false };
      const sentAt = Date.now();
      let answeredAt: number | undefined;
      const attempt = async () => {
        const events = run.tools.length
          ? runWithTools(request, run.tools, run.documents, signal, fetchImpl, run.search)
          : streamModel(request, signal, fetchImpl);
        for await (const event of events) {
          if (event.type === 'done') return event;
          if (event.type === 'quota') { emit({ ...event, connectionId: candidate.connectionId }); continue; }
          if (event.type === 'delta' || event.type === 'reasoning' || event.type === 'tool') answeredAt ??= Date.now();
          emit(event);
        }
        throw new Error('The model stream ended without a result.');
      };

      try {
        const done = candidate.target.execution === 'local' ? await enqueue(attempt) : await attempt();
        health.success(account, candidate.model, answeredAt !== undefined ? answeredAt - sentAt : undefined);
        const route: RouteOutcome = { connectionId: candidate.connectionId, model: candidate.model, task: task.kind, attempts };
        return { usage: done.usage, finishReason: done.finishReason, ...(done.loadMs !== undefined ? { loadMs: done.loadMs } : {}), route };
      } catch (error) {
        if (signal.aborted) throw error;
        if (!(error instanceof ProviderFailure)) throw error;
        health.failure(account, candidate.model, error.error);
        // After the user has seen part of an answer, switching models would splice two answers together.
        if (answeredAt !== undefined || !FALLBACK.has(error.error.category)) throw error;
        if (error.error.scope === 'account') blockedAccounts.add(account);
        last = error.error;
        previous = candidate.displayName || candidate.model;
        emit({ type: 'route', attempt: attempts, connectionId: candidate.connectionId, model: candidate.model, status: 'failed', reason: error.error.message, category: error.error.category });
      }
    }
    throw noneLeft(ranking, attempts, health.now(), last);
  };
}
