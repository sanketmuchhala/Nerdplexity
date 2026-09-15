import type { AgentBehavior, AgentConfig, AgentMode, AgentOutcome, AgentStep, ModelChoice, ProviderError, RunMessage, TaskKind, Usage } from '@app/types';
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
//   direct    one model answers (tools on, only one model available, or the Quick setting)
//   ensemble  specialists draft independently (one for a simple message, two by default otherwise);
//             another, the strongest, checks them and writes
//   plan      a planner splits a multi-part message; a specialist answers each part; the
//             strongest model checks the parts and writes one reply
//
// Every step uses the Free Router's fallback rules (tryInOrder), each with its own limit on
// attempts, and the user's settings (AgentConfig) can pick the behavior and the model for each role.

export const AGENT_LIMITS = {
  /** Default drafts in an ensemble; users can choose 1 to maxDrafts. */
  drafters: 2,
  maxDrafts: 3,
  parts: 3,
  /** Models tried per step before it gives up (a model that fails before answering is replaced). */
  attempts: { planner: 2, drafter: 2, specialist: 2, writer: 4 },
  /** Output reserved for a draft or a part answer. */
  draftTokens: 1500,
  plannerTokens: 400,
  /** A draft is shortened to this before the writer reads it, and before it is shown. */
  draftChars: 6000,
  /** Live output of a step is sent in pieces at most this often, not per token. */
  outputFlushMs: 150,
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

/**
 * How to handle a message. The Free Agent always uses at least two models when it can: a simple
 * message gets one draft and a check by a second model; harder ones get more drafts, or parts for
 * specialists. One model answers alone only with tools, with a single usable model, or on Quick.
 */
export function chooseStrategy(text: string, task: TaskProfile, usable: number, behavior: AgentBehavior = 'auto'): { mode: AgentMode; reason: string; drafts?: number } {
  if (task.tools) return { mode: 'direct', reason: 'Tools are on, so one model runs them and answers.' };
  if (usable < 2) return { mode: 'direct', reason: 'Only one free model can take this message, so it answers directly.' };
  if (behavior === 'quick') return { mode: 'direct', reason: 'Quick, from your agent settings: the best model answers directly.' };
  const multiPart = !task.vision && looksMultiPart(text);
  if (behavior === 'thorough') {
    return multiPart
      ? { mode: 'plan', reason: 'Thorough, from your agent settings: the message is split into parts for specialists.' }
      : { mode: 'ensemble', reason: 'Thorough, from your agent settings: specialists draft independently, then the strongest model checks them and writes the answer.' };
  }
  if (multiPart) return { mode: 'plan', reason: 'The message asks for several things, so it is split into parts for specialists.' };
  if (ENSEMBLE_KINDS.has(task.kind) || text.length > 600 || (task.kind === 'writing' && text.length > 200)) {
    return { mode: 'ensemble', reason: `A ${TASK_LABEL[task.kind]} task: specialists draft independently, then the strongest model checks them and writes the answer.` };
  }
  return { mode: 'ensemble', drafts: 1, reason: 'A simple message: one model drafts, and a second, stronger model checks it and writes the answer.' };
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

const sameModel = (a: { connectionId: string; model: string }, b: { connectionId: string; model: string }) => a.connectionId === b.connectionId && a.model === b.model;
const isEntry = (entry: RankedCandidate, other: RankedCandidate) => sameModel(entry.candidate, other.candidate);

const BEHAVIORS: readonly AgentBehavior[] = ['auto', 'quick', 'thorough'];

/**
 * The user's agent settings, kept only where they are well formed and name a model in the free
 * pool. Anything else is dropped rather than rejected, so a removed model never blocks a message.
 */
export function agentSettings(raw: unknown, candidates: { connectionId: string; model: string }[]): AgentConfig {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, any>;
  const inPool = (choice: any): ModelChoice | undefined =>
    choice && typeof choice.connectionId === 'string' && typeof choice.model === 'string' && candidates.some(c => sameModel(c, choice))
      ? { connectionId: choice.connectionId, model: choice.model } : undefined;
  const config: AgentConfig = {};
  if (BEHAVIORS.includes(input.behavior)) config.behavior = input.behavior;
  if (Number.isInteger(input.drafts) && input.drafts >= 1 && input.drafts <= AGENT_LIMITS.maxDrafts) config.drafts = input.drafts;
  const writer = inPool(input.writer);
  if (writer) config.writer = writer;
  const planner = inPool(input.planner);
  if (planner) config.planner = planner;
  if (Array.isArray(input.drafters)) {
    const drafters = input.drafters.map(inPool).filter((choice: ModelChoice | undefined): choice is ModelChoice => !!choice).slice(0, AGENT_LIMITS.maxDrafts);
    if (drafters.length) config.drafters = drafters;
  }
  if (input.specialists && typeof input.specialists === 'object') {
    const chosen = Object.fromEntries(TASK_KINDS.flatMap(kind => { const choice = inPool(input.specialists[kind]); return choice ? [[kind, choice]] : []; }));
    if (Object.keys(chosen).length) config.specialists = chosen;
  }
  return config;
}

/**
 * Put the user's choice first in a ranked list. When the chosen model cannot take this message
 * (cooling down, or missing something the message needs), the ranking stands and the note says why.
 */
function withChoice(list: RankedCandidate[], choice: ModelChoice | undefined, role: string): { list: RankedCandidate[]; note?: string } {
  if (!choice) return { list };
  const entry = list.find(item => sameModel(item.candidate, choice));
  if (!entry) return { list, note: `Your ${role}, ${choice.model}, cannot take this message right now, so the ranking chose instead.` };
  return { list: [{ ...entry, why: ['your choice', ...entry.why] }, ...list.filter(item => item !== entry)] };
}

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

    const config = run.agent ?? {};
    const notes: string[] = [];
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
      // The model's output and reasoning stream to the user as it writes, in pieces, not per token.
      let reasoning = '';
      const pending: Record<'text' | 'reasoning', string> = { text: '', reasoning: '' };
      let timer: NodeJS.Timeout | undefined;
      const flush = () => {
        clearTimeout(timer);
        timer = undefined;
        for (const channel of ['reasoning', 'text'] as const) {
          if (pending[channel]) { emit({ type: 'agent_output', id, channel, text: pending[channel] }); pending[channel] = ''; }
        }
      };
      const live = (channel: 'text' | 'reasoning', piece: string) => {
        pending[channel] += piece;
        timer ??= setTimeout(flush, AGENT_LIMITS.outputFlushMs);
      };
      try {
        const result = await tryInOrder(list, context(overrides), {
          trying: (entry, attempt, previous) => step({ id, role, status: 'running', connectionId: entry.candidate.connectionId, model: entry.candidate.model, reason: attempt === 1 ? describe(entry) : `After ${previous} failed: ${describe(entry)}`, ...extra }),
          failed: (entry, _attempt, error) => step({ id, role, status: 'failed', connectionId: entry.candidate.connectionId, model: entry.candidate.model, reason: error.message, ...extra }),
          event: event => {
            if (event.type === 'quota') emit(event);
            else if (event.type === 'delta') live('text', event.text);
            else if (event.type === 'reasoning') { reasoning += event.text; live('reasoning', event.text); }
          },
        });
        flush();
        calls += result.attempts;
        if (!result.ok) {
          step({ id, role, status: 'failed', reason: result.last ? `No model could do this step (last: ${result.last.message})` : 'No model was available for this step.', ...extra });
          return undefined;
        }
        usages.push(result.done.usage);
        const { candidate } = result.ranked;
        step({ id, role, status: 'done', connectionId: candidate.connectionId, model: candidate.model, reason: describe(result.ranked), text: clip(result.text), ...(reasoning ? { reasoning: clip(reasoning) } : {}), durationMs: Date.now() - started, ...extra });
        return { entry: result.ranked, text: result.text, ...(extra.task ? { task: extra.task } : {}) };
      } catch (error) {
        flush();
        if (signal.aborted) throw error;
        // A failure after output, or a refusal: the step is lost, the run goes on.
        step({ id, role, status: 'failed', reason: error instanceof ProviderFailure ? error.error.message : 'The step failed.', ...extra });
        return undefined;
      }
    };
    const strategyStep = () => step({ id: 'strategy', role: 'strategy', status: 'done', mode, reason: [reason, ...notes].join(' ') });

    const decision = chooseStrategy(text, task, own.length, config.behavior);
    let { mode, reason } = decision;
    // The writer the drafts are built around: the user's choice, or the top model for this kind of task.
    const writerChoice = withChoice(own, config.writer, 'writer');
    if (writerChoice.note) notes.push(writerChoice.note);
    const writer = writerChoice.list[0] ?? all[0];
    let drafts: Draft[] = [];

    if (mode === 'plan') {
      const planners = withChoice(ranked(table.extraction), config.planner, 'planner');
      if (planners.note) notes.push(planners.note);
      const planner = planners.list[0] ?? writer;
      strategyStep();
      const plan = await runStep('planner', 'planner', [planner, ...planners.list.filter(entry => !isEntry(entry, planner))], {
        messages: [{ role: 'system', content: PLANNER_PROMPT }, { role: 'user', content: text }],
        request: { ...run.request, maxTokens: AGENT_LIMITS.plannerTokens, temperature: 0 },
        maxAttempts: AGENT_LIMITS.attempts.planner,
      });
      const parts = plan ? parsePlan(plan.text) : undefined;
      if (parts && parts.length >= 2) {
        const used = new Set<string>();
        const assigned = parts.map(part => {
          const ranking = ranked(table[part.kind]).length ? ranked(table[part.kind]) : own;
          const chosen = withChoice(ranking, config.specialists?.[part.kind], `${part.kind} specialist`);
          if (chosen.note) notes.push(chosen.note);
          // Without a choice, parts spread across models, so one model is not asked for everything.
          const pick = (config.specialists?.[part.kind] && !chosen.note ? chosen.list[0] : undefined)
            ?? chosen.list.find(entry => !used.has(`${entry.candidate.connectionId}\n${entry.candidate.model}`)) ?? chosen.list[0];
          used.add(`${pick.candidate.connectionId}\n${pick.candidate.model}`);
          return { part, list: [pick, ...chosen.list.filter(entry => !isEntry(entry, pick))] };
        });
        const answers = await Promise.all(assigned.map(({ part, list }, i) => runStep(`part-${i + 1}`, 'specialist', list, {
          messages: forPart(messages, part.task), request: { ...run.request, maxTokens: AGENT_LIMITS.draftTokens }, maxAttempts: AGENT_LIMITS.attempts.specialist,
        }, { task: part.task, kind: part.kind })));
        // A part whose specialist failed goes to the writer marked as unanswered.
        drafts = assigned.map(({ part }, i) => answers[i] ?? { entry: writer, text: '', task: part.task });
      } else {
        mode = 'ensemble';
        reason = 'The planner found a single task, so specialists draft it and the strongest model checks them.';
      }
    }

    if (mode === 'ensemble') {
      strategyStep();
      const count = config.drafts ?? decision.drafts ?? AGENT_LIMITS.drafters;
      // The user's drafters first, in their order, then the ranking fills any remaining places.
      const chosen = (config.drafters ?? []).map(choice => own.find(entry => sameModel(entry.candidate, choice)))
        .filter((entry): entry is RankedCandidate => !!entry && !isEntry(entry, writer)).slice(0, count);
      if (config.drafters?.length && chosen.length < Math.min(count, config.drafters.length)) notes.push('Some of your drafters cannot take this message right now, so the ranking filled their places.');
      const picks = [...chosen, ...pickDrafters(own.filter(entry => !chosen.some(pick => isEntry(pick, entry))), writer, count - chosen.length)]
        .map(entry => chosen.some(pick => isEntry(pick, entry)) ? { ...entry, why: ['your choice', ...entry.why] } : entry);
      const spares = own.filter(entry => !isEntry(entry, writer) && !picks.some(pick => isEntry(pick, entry)));
      // Each drafter starts its spares at a different place, so two failed drafters do not both move to the same model.
      const sparesFor = (i: number) => [...spares.slice(i % (spares.length || 1)), ...spares.slice(0, i % (spares.length || 1))];
      const answers = await Promise.all(picks.map((pick, i) => runStep(`draft-${i + 1}`, 'drafter', [pick, ...sparesFor(i)],
        { maxAttempts: AGENT_LIMITS.attempts.drafter, request: { ...run.request, maxTokens: AGENT_LIMITS.draftTokens } })));
      drafts = answers.filter((answer): answer is Draft => !!answer);
    }

    if (mode === 'direct') strategyStep();

    // The writer: the strongest model streams the final answer, with the drafts or part answers as input.
    const note = mode === 'plan'
      ? `${WRITER_PLAN}\n\n${drafts.map((draft, i) => `Part ${i + 1}: ${draft.task}\nAnswer:\n${draft.text ? clip(draft.text) : '(no answer; answer this part yourself)'}`).join('\n\n')}`
      : mode === 'ensemble' && drafts.length
        ? `${WRITER_ENSEMBLE}\n\n${drafts.map((draft, i) => `Draft ${i + 1}:\n${clip(draft.text)}`).join('\n\n')}`
        : undefined;
    const writerMessages = note ? withNote(messages, note) : messages;
    const writerTask = profileTask(writerMessages, run.tools, run.request.maxTokens);
    // Drafts count toward context, so rank again for the longer request; the strongest fitting model writes.
    const writers = withChoice(rankCandidates(run.candidates, { ...writerTask, kind: task.kind }, health, run.owner, bench).ranked, config.writer, 'writer').list;
    const started = Date.now();
    let answered = false;
    const result = await tryInOrder(writers, context({
      messages: writerMessages, tools: run.tools, maxAttempts: AGENT_LIMITS.attempts.writer,
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
      // The draft's own step names the model that wrote it.
      emit({ type: 'status', message: 'No model could check and rewrite the drafts, so this is one unchecked draft.' });
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
