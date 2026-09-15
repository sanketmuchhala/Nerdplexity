import type { AgentMode, AgentOutcome, AgentStep, ProviderError, RunMessage, TaskKind, Usage } from '@app/types';
import { ProviderFailure } from './adapters.js';
import { withWebResults } from './autoSearch.js';
import { enqueueLocal } from '../queue/localQueue.js';
import type { RunContext, RunExecutor } from './runs.js';
import {
  AttemptContext, BenchIndex, isMetaRouter, noneLeft, profileTask, rankCandidates, RankedCandidate, RouteCandidate, RoutedRun,
  RouterDeps, RouterHealth, TASK_LABEL, TaskProfile, tryInOrder,
} from './router.js';

// The Free Agent: for each message it chooses a strategy, asks the free models that are best at
// what the message needs, and has the strongest one check their work and write the answer.
//
//   direct    one model answers (simple messages, tools on, or only one model available)
//   ensemble  two specialists draft independently; the strongest model checks them and writes
//   plan      a planner splits a multi-part message; a specialist answers each part; the
//             strongest model checks the parts and writes one reply
//
// Every step uses the Free Router's fallback rules (tryInOrder), and a whole message is limited
// to AGENT_LIMITS.calls model requests so free quotas last.

export const AGENT_LIMITS = {
  /** Model requests per message, counting failed attempts. */
  calls: 5,
  drafters: 2,
  parts: 3,
  /** Output reserved for a draft or a part answer. */
  draftTokens: 1500,
  plannerTokens: 400,
  /** A draft is shortened to this before the writer reads it, and before it is shown. */
  draftChars: 6000,
} as const;

const TASK_KINDS: readonly TaskKind[] = ['code', 'math', 'reasoning', 'writing', 'extraction', 'general'];

const textOf = (content: RunMessage['content']) => typeof content === 'string' ? content : content.map(part => part.type === 'text' ? part.text : '').join('\n');
const lastUserText = (messages: RunMessage[]) => {
  const last = [...messages].reverse().find(message => message.role === 'user');
  return last ? textOf(last.content) : '';
};
const clip = (text: string, max = AGENT_LIMITS.draftChars) => text.length <= max ? text : `${text.slice(0, max)}\n[… shortened]`;

// ---------------------------------------------------------------------------
// Specialists: which model is best at what.

/**
 * The ranked models for every kind of task, for a request with the given needs (images, tools,
 * size). Bench results, name-based priors, and recent health decide the order, as for the Free
 * Router; here each kind gets its own ranking.
 */
export function specialists(candidates: RouteCandidate[], base: TaskProfile, health: RouterHealth, owner: string, bench?: BenchIndex): Record<TaskKind, RankedCandidate[]> {
  return Object.fromEntries(TASK_KINDS.map(kind => [kind, rankCandidates(candidates, { ...base, kind }, health, owner, bench).ranked])) as Record<TaskKind, RankedCandidate[]>;
}

/** The model family, so drafts come from different makers where possible ("meta-llama/llama-3.3" → "meta-llama"). */
export function family(model: string): string {
  const id = model.toLowerCase().replace(/^~/, '');
  return id.includes('/') ? id.split('/')[0] : id.split(/[-_:.\d]/)[0] || id;
}

/** Up to `count` drafters after the writer, from different families than the writer and each other when possible. */
export function pickDrafters(ranked: RankedCandidate[], writer: RankedCandidate, count: number): RankedCandidate[] {
  const others = ranked.filter(entry => entry !== writer && !(entry.candidate.connectionId === writer.candidate.connectionId && entry.candidate.model === writer.candidate.model));
  const picked: RankedCandidate[] = [];
  const families = new Set([family(writer.candidate.model)]);
  for (const entry of others) {
    if (picked.length >= count) break;
    if (families.has(family(entry.candidate.model))) continue;
    picked.push(entry);
    families.add(family(entry.candidate.model));
  }
  for (const entry of others) {
    if (picked.length >= count) break;
    if (!picked.includes(entry)) picked.push(entry);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Strategy

const LIST_ITEM = /^\s*(\d+[.)]|[-*•])\s+\S/gm;
const SENTENCE = /[^.?!\n]+[.?!]?/g;

/**
 * Whether a message asks for several different things: two or more questions, a numbered or
 * bulleted list of requests, or sentences that need different kinds of work (code and writing).
 */
export function looksMultiPart(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 40 || /```/.test(trimmed)) return false;
  const listItems = trimmed.match(LIST_ITEM)?.length ?? 0;
  if (listItems >= 2 && /\?|\b(write|explain|give|list|make|create|find|compare|calculate|solve|summari[sz]e)\b/i.test(trimmed)) return true;
  const sentences = (trimmed.match(SENTENCE) ?? []).map(s => s.trim()).filter(s => s.length >= 12);
  if (sentences.filter(s => s.endsWith('?')).length >= 2) return true;
  const kinds = new Set(sentences.map(s => profileTask([{ role: 'user', content: s }], []).kind).filter(kind => kind !== 'general'));
  return kinds.size >= 2;
}

const ENSEMBLE_KINDS = new Set<TaskKind>(['code', 'math', 'reasoning', 'extraction']);

export function chooseStrategy(text: string, task: TaskProfile, usable: number): { mode: AgentMode; reason: string } {
  if (task.tools) return { mode: 'direct', reason: 'Tools are on, so one model runs them and answers.' };
  if (usable < 2) return { mode: 'direct', reason: 'Only one free model can take this message, so it answers directly.' };
  if (!task.vision && looksMultiPart(text)) return { mode: 'plan', reason: 'The message asks for several things, so it is split into parts for specialists.' };
  if (ENSEMBLE_KINDS.has(task.kind) || text.length > 600 || (task.kind === 'writing' && text.length > 200)) {
    return { mode: 'ensemble', reason: `A ${TASK_LABEL[task.kind]} task: two specialists draft independently, then the strongest model checks them and writes the answer.` };
  }
  return { mode: 'direct', reason: 'A simple message: the best model answers directly.' };
}

// ---------------------------------------------------------------------------
// Prompts

const PLANNER_PROMPT = [
  `Split the user's message into at most ${AGENT_LIMITS.parts} independent parts that can be answered separately.`,
  'Each part must be self-contained: include every detail from the message that answering it needs.',
  `Reply with JSON only, no other text: {"parts":[{"task":"...","kind":"code|math|reasoning|writing|extraction|general"}]}`,
  'If the message is really one task, reply with a single part.',
].join('\n');

const WRITER_ENSEMBLE = [
  "You are the final writer for Nerdplexity's Free Agent. Other AI models wrote independent drafts answering the user's latest message; they are below, and they can be wrong.",
  '- Work out the correct answer yourself, using the drafts as input: check facts, math, and code, and where the drafts disagree, decide which is right.',
  '- Keep what is correct and useful, fix mistakes, and fill gaps.',
  '- Write one complete answer to the user in your own words, in the format their message asks for.',
  '- Do not mention the drafts, other models, or this process.',
].join('\n');

const WRITER_PLAN = [
  "You are the final writer for Nerdplexity's Free Agent. The user's latest message has several parts. Specialist models answered each part; their answers are below, and they can be wrong.",
  '- Check each part and fix mistakes. If a part has no answer below, answer it yourself.',
  '- Combine everything into one complete, well-organized reply that covers every part, in the order the user asked.',
  '- Do not mention the specialists, other models, or this process.',
].join('\n');

/** Add a system note after any leading system messages, where every provider accepts it. */
function withNote(messages: RunMessage[], note: string): RunMessage[] {
  const firstTurn = messages.findIndex(message => message.role !== 'system');
  const at = firstTurn === -1 ? messages.length : firstTurn;
  return [...messages.slice(0, at), { role: 'system', content: note }, ...messages.slice(at)];
}

/** The conversation with the latest user message replaced by one part of it, and the whole message kept as context. */
function forPart(messages: RunMessage[], task: string): RunMessage[] {
  const index = messages.map(message => message.role).lastIndexOf('user');
  const original = index >= 0 ? textOf(messages[index].content) : '';
  const rest = index >= 0 ? [...messages.slice(0, index), ...messages.slice(index + 1)] : messages;
  const note = `The user's message has several parts; another model will combine the answers. Answer only this part, completely: ${task}\n\nThe user's full message, for context:\n${original}`;
  return [...withNote(rest, note), { role: 'user', content: task }];
}

/** Parts from the planner's reply, or undefined when it is not usable JSON. */
export function parsePlan(reply: string): { task: string; kind: TaskKind }[] | undefined {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  if (!json) return undefined;
  let data: any;
  try { data = JSON.parse(json); } catch { return undefined; }
  if (!Array.isArray(data?.parts)) return undefined;
  const parts = data.parts
    .filter((part: any) => typeof part?.task === 'string' && part.task.trim())
    .slice(0, AGENT_LIMITS.parts)
    .map((part: any) => ({ task: part.task.trim().slice(0, 1000), kind: TASK_KINDS.includes(part.kind) ? part.kind as TaskKind : 'general' as TaskKind }));
  return parts.length ? parts : undefined;
}

// ---------------------------------------------------------------------------
// Execution

const sumUsage = (usages: (Usage | undefined)[]): Usage | undefined => {
  if (!usages.length || usages.some(usage => !usage)) return undefined;
  return usages.reduce<Usage>((total, usage) => ({
    prompt_tokens: total.prompt_tokens + usage!.prompt_tokens,
    completion_tokens: total.completion_tokens + usage!.completion_tokens,
    total_tokens: total.total_tokens + usage!.total_tokens,
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
};

const describe = (entry: RankedCandidate) => entry.why.length ? entry.why.join(', ') : 'next in the ranking';

/**
 * The models the agent assigns work to: the Free Router's ranking without provider-side routers
 * (openrouter/free, openrouter/auto), whose actual model is unknown and cannot be ranked. They stay
 * in the writer's list, last, as the Free Router's final fallback.
 */
const ranked = (list: RankedCandidate[]) => list.filter(entry => !isMetaRouter(entry.candidate.model));

interface Draft { entry: RankedCandidate; text: string; task?: string }

export function agentExecutor(run: RoutedRun, deps: RouterDeps): RunExecutor {
  const { health, bench, fetchImpl = fetch, enqueue = enqueueLocal } = deps;
  return async ({ signal, emit }: RunContext) => {
    const step = (value: AgentStep) => emit({ type: 'agent', ...value });
    const messages = run.search?.auto ? await withWebResults(run.messages, run.search.apiKey, signal, emit, fetchImpl) : run.messages;
    const task = profileTask(messages, run.tools, run.request.maxTokens);
    const text = lastUserText(messages);
    const table = specialists(run.candidates, task, health, run.owner, bench);
    const all = table[task.kind];
    if (!all.length) throw noneLeft(rankCandidates(run.candidates, task, health, run.owner, bench), 0, health.now());
    const own = ranked(all);

    let calls = 0;
    const usages: (Usage | undefined)[] = [];
    const blockedAccounts = new Set<string>();
    const context = (overrides: Partial<AttemptContext>): AttemptContext => ({
      owner: run.owner, health, request: run.request, messages, tools: [], documents: run.documents, search: run.search,
      signal, fetchImpl, enqueue, maxAttempts: 1, blockedAccounts, ...overrides,
    });
    /** One step, reported as it starts, switches model, and ends. Returns the answer, or undefined when it failed. */
    const runStep = async (
      id: string, role: AgentStep['role'], list: RankedCandidate[], overrides: Partial<AttemptContext>, extra: Partial<AgentStep> = {},
    ): Promise<Draft | undefined> => {
      const started = Date.now();
      try {
        const result = await tryInOrder(list, context(overrides), {
          trying: (entry, attempt, previous) => step({ id, role, status: 'running', connectionId: entry.candidate.connectionId, model: entry.candidate.model, reason: attempt === 1 ? describe(entry) : `After ${previous} failed: ${describe(entry)}`, ...extra }),
          failed: (entry, _attempt, error) => step({ id, role, status: 'failed', connectionId: entry.candidate.connectionId, model: entry.candidate.model, reason: error.message, ...extra }),
          event: event => { if (event.type === 'quota') emit(event); },
        });
        calls += result.attempts;
        if (!result.ok) {
          step({ id, role, status: 'failed', reason: result.last ? `No model could do this step (last: ${result.last.message})` : 'No model was available for this step.', ...extra });
          return undefined;
        }
        usages.push(result.done.usage);
        const { candidate } = result.ranked;
        step({ id, role, status: 'done', connectionId: candidate.connectionId, model: candidate.model, reason: describe(result.ranked), text: clip(result.text), durationMs: Date.now() - started, ...extra });
        return { entry: result.ranked, text: result.text, ...(extra.task ? { task: extra.task } : {}) };
      } catch (error) {
        if (signal.aborted) throw error;
        // A failure after output, or a refusal: the step is lost, the run goes on.
        step({ id, role, status: 'failed', reason: error instanceof ProviderFailure ? error.error.message : 'The step failed.', ...extra });
        return undefined;
      }
    };

    let { mode, reason } = chooseStrategy(text, task, own.length);
    const writer = own[0] ?? all[0];
    let drafts: Draft[] = [];

    if (mode === 'plan') {
      const planners = ranked(table.extraction);
      const planner = planners[0] ?? writer;
      step({ id: 'strategy', role: 'strategy', status: 'done', mode, reason });
      const plan = await runStep('planner', 'planner', [planner, ...planners.filter(entry => entry !== planner)], {
        messages: [{ role: 'system', content: PLANNER_PROMPT }, { role: 'user', content: text }],
        request: { ...run.request, maxTokens: AGENT_LIMITS.plannerTokens, temperature: 0 },
      });
      const parts = plan ? parsePlan(plan.text) : undefined;
      if (parts && parts.length >= 2) {
        const budget = Math.max(0, AGENT_LIMITS.calls - calls - 1);
        const used = new Set<string>();
        const assigned = parts.slice(0, Math.max(1, budget)).map(part => {
          const list = ranked(table[part.kind]).length ? ranked(table[part.kind]) : own;
          const pick = list.find(entry => !used.has(`${entry.candidate.connectionId}\n${entry.candidate.model}`)) ?? list[0];
          used.add(`${pick.candidate.connectionId}\n${pick.candidate.model}`);
          return { part, list: [pick, ...list.filter(entry => entry !== pick)] };
        });
        const answers = await Promise.all(assigned.map(({ part, list }, i) => runStep(`part-${i + 1}`, 'specialist', list, {
          messages: forPart(messages, part.task), request: { ...run.request, maxTokens: AGENT_LIMITS.draftTokens },
        }, { task: part.task, kind: part.kind })));
        drafts = answers.filter((answer): answer is Draft => !!answer);
        // Parts beyond the budget are left for the writer, who is told to answer any missing part.
        for (const { task: missing } of parts.slice(assigned.length)) drafts.push({ entry: writer, text: '', task: missing });
      } else {
        mode = 'ensemble';
        reason = 'The planner found a single task, so two specialists draft it and the strongest model checks them.';
      }
    }

    if (mode === 'ensemble') {
      step({ id: 'strategy', role: 'strategy', status: 'done', mode, reason });
      const picks = pickDrafters(own, writer, AGENT_LIMITS.drafters);
      const spare = Math.max(1, AGENT_LIMITS.calls - calls - 1 - picks.length);
      const answers = await Promise.all(picks.map((pick, i) => runStep(`draft-${i + 1}`, 'drafter',
        [pick, ...own.filter(entry => entry !== writer && !picks.includes(entry))],
        { maxAttempts: i === 0 ? spare : 1, request: { ...run.request, maxTokens: AGENT_LIMITS.draftTokens } })));
      drafts = answers.filter((answer): answer is Draft => !!answer);
    }

    if (mode === 'direct') step({ id: 'strategy', role: 'strategy', status: 'done', mode, reason });

    // The writer: the strongest model streams the final answer, with the drafts or part answers as input.
    const note = mode === 'plan'
      ? `${WRITER_PLAN}\n\n${drafts.map((draft, i) => `Part ${i + 1}: ${draft.task}\nAnswer:\n${draft.text ? clip(draft.text) : '(no answer; answer this part yourself)'}`).join('\n\n')}`
      : mode === 'ensemble' && drafts.length
        ? `${WRITER_ENSEMBLE}\n\n${drafts.map((draft, i) => `Draft ${i + 1}:\n${clip(draft.text)}`).join('\n\n')}`
        : undefined;
    const writerMessages = note ? withNote(messages, note) : messages;
    const writerTask = profileTask(writerMessages, run.tools, run.request.maxTokens);
    // Drafts count toward context, so rank again for the longer request; the strongest fitting model writes.
    const writers = rankCandidates(run.candidates, { ...writerTask, kind: task.kind }, health, run.owner, bench).ranked;
    const started = Date.now();
    let answered = false;
    const result = await tryInOrder(writers, context({
      messages: writerMessages, tools: run.tools, maxAttempts: Math.max(1, AGENT_LIMITS.calls - calls),
    }), {
      trying: (entry, attempt, previous) => step({ id: 'writer', role: 'writer', status: 'running', connectionId: entry.candidate.connectionId, model: entry.candidate.model, reason: attempt === 1 ? (note ? `Strongest for ${TASK_LABEL[task.kind]}: ${describe(entry)}` : describe(entry)) : `After ${previous} failed: ${describe(entry)}` }),
      failed: (entry, _attempt, error) => step({ id: 'writer', role: 'writer', status: 'failed', connectionId: entry.candidate.connectionId, model: entry.candidate.model, reason: error.message }),
      event: event => { if (event.type === 'delta') answered = true; emit(event); },
    });
    calls += result.attempts;

    if (!result.ok) {
      // No writer could answer. A draft is still an answer: show the first one rather than nothing.
      const fallback = drafts.find(draft => draft.text.trim());
      if (!fallback || answered) throw noneLeft({ ranked: writers, excluded: {} }, result.attempts, health.now(), result.last as ProviderError | undefined);
      emit({ type: 'status', message: `No model could write the final answer, so this is the draft from ${fallback.entry.candidate.model}.` });
      emit({ type: 'delta', text: fallback.text });
      const outcome: AgentOutcome = { mode, task: task.kind, calls, writer: { connectionId: fallback.entry.candidate.connectionId, model: fallback.entry.candidate.model } };
      return { ...(sumUsage(usages) ? { usage: sumUsage(usages) } : {}), agent: outcome };
    }
    usages.push(result.done.usage);
    const { candidate } = result.ranked;
    step({ id: 'writer', role: 'writer', status: 'done', connectionId: candidate.connectionId, model: candidate.model, reason: note ? 'Checked the drafts and wrote the answer.' : describe(result.ranked), durationMs: Date.now() - started });
    const outcome: AgentOutcome = { mode, task: task.kind, calls, writer: { connectionId: candidate.connectionId, model: candidate.model } };
    const usage = sumUsage(usages);
    return { ...(usage ? { usage } : {}), finishReason: result.done.finishReason, ...(result.done.loadMs !== undefined ? { loadMs: result.done.loadMs } : {}), agent: outcome };
  };
}
