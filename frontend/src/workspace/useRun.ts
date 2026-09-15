import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ActivityTrace, AgentStep, DiscoveryResult, ModelRef, ProviderErrorCategory, RouteStep, RunMessage, TerminalPayload, ToolName, ToolTrace } from '@app/types';
import useChat from '../state/chatStore';
import type { RunRecord, WorkspaceDocument } from '../lib/db';
import * as store from '../lib/store';
import { costStatus, freeAlternatives } from '../lib/cost';
import useConnections, { currentRouterPool, isLocal, latestResult, targetFor } from '../state/connections';
import { isRouter, routerName, routeStrategy } from '../lib/router';
import { buildContext, toolNamesFor, usesDocumentTools, workbenchSettings, type InputSnapshot } from '../lib/workbench';
import { cancelRun, followRun, RunUnavailable, startRun } from './runClient';
import { autoWebSearch, searchKey } from '../lib/searchKey';
import { formatModelName } from './ModelLogo';

export interface RunError {
  message: string;
  category?: ProviderErrorCategory;
  retryAfterMs?: number;
  retryable: boolean;
  /** Blocked by the Free only setting; nothing was sent. */
  policy?: boolean;
  /** Free models the user may choose instead. Never used automatically. */
  suggestions?: ModelRef[];
}

interface Attempt {
  conversationId: string;
  connectionId: string;
  model: string;
  prompt: string;
  messages: RunMessage[];
  tools: ToolName[];
  documents: InputSnapshot['documents'];
  input: InputSnapshot;
}

type LocalOutcome = { type: 'local'; status: 'failed' | 'canceled' | 'interrupted'; message?: string };

/** Runs older than this are not reattached after a reload. */
const RESUME_WINDOW_MS = 15 * 60_000;
const PERSIST_MS = 1000;
const CANCEL_GRACE_MS = 3000;

function costOf(ref: ModelRef) {
  const { connections, catalog } = useConnections.getState();
  const result = latestResult(catalog[ref.connectionId]);
  return costStatus(connections.find(c => c.id === ref.connectionId), result?.ok ? result.models.find(m => m.id === ref.modelId) : undefined, result?.ok ? result.execution : undefined);
}

/** Read permission at dispatch time, including retries and explicit per-thread permission. */
export function runCostPolicy(conversationId?: string): 'free-only' | 'any' {
  const chat = useChat.getState();
  return chat.settings?.costPolicy === 'any' || (conversationId && chat.conversations.find(c => c.id === conversationId)?.allowCharges) ? 'any' : 'free-only';
}

/** Why Free only blocks this model in this thread, or null when it may run. */
export function policyBlock(ref: ModelRef, conversationId?: string): string | null {
  // The Free Router only ever uses models verified as free.
  if (isRouter(ref)) return null;
  if (runCostPolicy(conversationId) === 'any') return null;
  const status = costOf(ref);
  return status.free ? null : `Free only is on. ${status.detail}`;
}

const NO_FREE_MODELS = 'The Free Router has no free models to use. Connect OpenRouter with a free key, or a model on this machine, then refresh its catalog in Models.';

/** The Free Agent's writer, the model behind any partial answer of an agent run. */
const lastWriter = (steps: AgentStep[] | undefined) => {
  const writer = [...(steps ?? [])].reverse().find(step => step.role === 'writer' && step.model && step.connectionId);
  return writer ? { connectionId: writer.connectionId!, model: writer.model! } : undefined;
};

const modelName = (model?: string) => model ? formatModelName(undefined, model) : 'A model';
const both = (names: string[]) => names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ');

/** The status line while the Free Agent works: which models are doing what right now. */
function agentPhase(steps: AgentStep[]) {
  const running = steps.filter(step => step.status === 'running');
  const writer = running.find(step => step.role === 'writer');
  if (writer) return `${modelName(writer.model)} is checking and writing the answer`;
  if (!running.length) return 'Choosing how to answer';
  const names = both(running.map(step => modelName(step.model)));
  const are = running.length > 1 ? 'are' : 'is';
  const role = running[0].role;
  return role === 'planner' ? `${names} is planning the parts` : role === 'specialist' ? `${names} ${are} answering the parts` : `${names} ${are} drafting`;
}

/** Which model a routed run was last sent to: the one behind any partial answer. */
const lastTried = (steps: RouteStep[] | undefined) => [...(steps ?? [])].reverse().find(step => step.status === 'trying');

const historyOf = (conversationId: string): RunMessage[] =>
  (useChat.getState().conversations.find(c => c.id === conversationId)?.messages ?? []).map(({ role, content }) => ({ role, content }));

export function useRun() {
  const [running, setRunning] = useState(false);
  const [partial, setPartial] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>();
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<RunError | null>(null);
  const [tools, setTools] = useState<ToolTrace[]>([]);
  const [activities, setActivities] = useState<ActivityTrace[]>([]);
  const [route, setRoute] = useState<RouteStep[]>([]);
  const [agent, setAgent] = useState<AgentStep[]>([]);
  const [runConversationId, setRunConversationId] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  /** Server run shown in the live bubble; the saved message for it replaces the bubble. */
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const active = useRef<{ record: RunRecord; controller: AbortController; cancelRequested: boolean } | null>(null);
  const lastAttempt = useRef<(Attempt & { recordId: string }) | null>(null);

  const showRunning = (record: RunRecord, phaseText: string) => {
    setRunning(true); setPartial(record.output); setReasoning(record.reasoning || ''); setTools(record.tools); setActivities(record.activities ?? []); setRoute(record.route ?? []); setAgent(record.agent ?? []);
    setSelectedModel(record.routedModel); setSelectedProvider(record.routedProvider);
    setError(null); setCanRetry(false); setPhase(phaseText); setRunConversationId(record.conversationId);
  };

  /** Record the outcome exactly once, even if another tab follows the same run. */
  const finalize = async (record: RunRecord, outcome: TerminalPayload | LocalOutcome) => {
    const status = outcome.type === 'local' ? outcome.status : outcome.type;
    const timing = outcome.type === 'local' ? undefined : outcome.timing;
    const routedTo = outcome.type === 'completed' ? outcome.route : undefined;
    const agentOutcome = outcome.type === 'completed' ? outcome.agent : undefined;
    const final: RunRecord = {
      ...record,
      ...(routedTo ? { routedTo } : {}),
      ...(agentOutcome ? { agentOutcome } : {}),
      status,
      durationMs: timing?.durationMs ?? Date.now() - record.startedAt,
      ...(timing ? { queuedMs: timing.queuedMs, ttftMs: timing.ttftMs } : {}),
      ...(outcome.type === 'completed' ? { usage: outcome.usage, finishReason: outcome.finishReason, loadMs: outcome.loadMs } : {}),
      ...(outcome.type === 'failed' ? { error: outcome.error.message, errorCategory: outcome.error.category, retryAfterMs: outcome.error.retryAfterMs } : {}),
      ...(outcome.type === 'local' && outcome.message ? { error: outcome.message } : {}),
    };
    let claimed = false;
    try {
      ({ claimed } = await store.runs.finish(final));
      const chat = useChat.getState();
      if (claimed && (record.output || record.reasoning)) {
        // A routed answer is attributed to the model that wrote it, not to a router: the Free Router's
        // choice, and within it the concrete model OpenRouter's own router picked, when reported.
        const answered = agentOutcome?.writer ?? routedTo ?? lastTried(record.route) ?? lastWriter(record.agent);
        const metadata = {
          ...(record.reasoning ? { reasoning: record.reasoning } : {}), ...(record.activities?.length ? { activities: record.activities } : {}), ...(record.tools.length ? { tools: record.tools } : {}),
          ...(record.route?.length ? { route: { steps: record.route, ...(routedTo ? { task: routedTo.task } : {}) } } : {}),
          ...(record.agent?.length ? { agent: { steps: record.agent, ...(agentOutcome ? { mode: agentOutcome.mode, calls: agentOutcome.calls, task: agentOutcome.task } : {}) } } : {}),
        };
        const provenance = answered ? { connectionId: answered.connectionId, modelId: record.routedModel || answered.model }
          : record.connectionId && !isRouter(record) ? { connectionId: record.connectionId, modelId: record.routedModel || record.model } : undefined;
        await chat.addMessage('assistant', record.output, Object.keys(metadata).length ? metadata : undefined, record.conversationId, {
          ...(provenance ? { provenance } : {}),
          ...(record.runId ? { runId: record.runId } : {}),
          ...(status !== 'completed' ? { runStatus: status as 'canceled' | 'failed' | 'interrupted' } : {}),
          ...(final.finishReason ? { finishReason: final.finishReason } : {}),
        });
      } else if (!claimed) {
        await chat.loadConversations();
      }
    } catch {
      setError({ message: 'The answer could not be saved to the server. Copy the visible answer before leaving.', retryable: false });
    }
    if (active.current?.record.id === record.id) active.current = null;
    setRunning(false); setPartial(''); setReasoning(''); setActivities([]); setSelectedModel(undefined); setSelectedProvider(undefined);
    setPhase(status === 'canceled' ? 'Stopped' : '');
    if (outcome.type === 'failed') {
      const ref = { connectionId: record.connectionId || '', modelId: record.model };
      // When a free route runs out of quota, offer other free routes rather than switching silently.
      // The Free Router has already tried the alternatives.
      const suggestions = outcome.error.category === 'quota' && !isRouter(record) && costOf(ref).free
        ? freeAlternatives(useConnections.getState().connections, Object.fromEntries(Object.entries(useConnections.getState().catalog).map(([id, state]) => [id, latestResult(state)])) as Record<string, DiscoveryResult | undefined>, ref)
        : undefined;
      setError({ message: outcome.error.message, category: outcome.error.category, retryAfterMs: outcome.error.retryAfterMs, retryable: outcome.error.retryable, ...(suggestions?.length ? { suggestions } : {}) });
    } else if (status === 'interrupted') {
      setError({ message: `${outcome.type === 'local' && outcome.message ? outcome.message : 'The run was interrupted.'}${record.output ? ' The partial answer was kept.' : ''}`, retryable: true });
    } else if (outcome.type === 'local' && outcome.status === 'failed') {
      setError({ message: outcome.message || 'The run could not start.', retryable: true });
    } else if (status === 'completed' && !record.output) {
      setError({ message: 'The model finished without an answer.', retryable: true });
    }
    setCanRetry(status !== 'completed' || !record.output);
    window.dispatchEvent(new Event('nerdplexity:runs'));
  };

  const follow = async (record: RunRecord, controller: AbortController) => {
    let frame = 0;
    let dirty = false;
    // Batch rendering to animation frames and storage writes to intervals, not per token.
    const render = () => { frame = 0; setPartial(record.output); setReasoning(record.reasoning || ''); };
    const persist = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      void store.runs.patch(record.id, { output: record.output, reasoning: record.reasoning, activities: record.activities, agent: record.agent, routedModel: record.routedModel, routedProvider: record.routedProvider, lastSeq: record.lastSeq, tools: record.tools, notices: record.notices }).catch(() => undefined);
    }, PERSIST_MS);
    try {
      const terminal = await followRun(record.runId!, record.lastSeq ?? 0, ({ seq, event }) => {
        record.lastSeq = seq;
        dirty = true;
        switch (event.type) {
          case 'queued': setPhase(event.position > 0 ? `Queued behind ${event.position} local run${event.position === 1 ? '' : 's'}` : 'Queued'); break;
          case 'started': setPhase('Waiting for the model'); break;
          case 'status': record.notices = [...new Set([...(record.notices || []), event.message])]; setPhase(event.message); break;
          case 'model': record.routedModel = event.model; record.routedProvider = event.provider; setSelectedModel(event.model); setSelectedProvider(event.provider); if (!isRouter(record)) setPhase(`Using ${event.model}`); break;
          case 'reasoning': record.reasoning = (record.reasoning || '') + event.text; setPhase('Reasoning'); break;
          case 'activity': {
            const { type: _type, ...activity } = event;
            record.activities = [...(record.activities ?? []), activity];
            setActivities(record.activities);
            setPhase('Using tools');
            break;
          }
          case 'delta': record.output += event.text; setPhase('Generating'); break;
          case 'tool': {
            const { type: _type, ...trace } = event;
            const index = trace.id ? record.tools.findIndex(t => t.id === trace.id && t.step === trace.step) : -1;
            record.tools = index >= 0 ? record.tools.map((t, i) => i === index ? trace : t) : [...record.tools, trace];
            setTools(record.tools);
            setPhase(trace.status === 'running' ? `Running ${trace.name.replaceAll('_', ' ')}` : 'Waiting for the model');
            break;
          }
          case 'quota': {
            record.quota = event.quota;
            const owner = event.connectionId ?? record.connectionId;
            if (owner && !isRouter({ connectionId: owner })) useConnections.getState().setQuota(owner, event.quota);
            break;
          }
          case 'agent': {
            const { type: _type, ...step } = event;
            const steps = record.agent ?? [];
            const index = steps.findIndex(existing => existing.id === step.id);
            record.agent = index >= 0 ? steps.map((existing, i) => i === index ? step : existing) : [...steps, step];
            setAgent(record.agent);
            setPhase(agentPhase(record.agent));
            break;
          }
          case 'agent_output': {
            // A step's draft or reasoning as the model writes it; the finished step replaces it.
            const { id, channel, text } = event;
            record.agent = (record.agent ?? []).map(step => step.id === id ? { ...step, [channel]: (step[channel] ?? '') + text } : step);
            setAgent(record.agent);
            break;
          }
          case 'route': {
            const { type: _type, ...step } = event;
            record.route = [...(record.route ?? []), step];
            setRoute(record.route);
            // A new attempt forgets the concrete model a failed attempt reported.
            if (step.status === 'trying') { record.routedModel = undefined; record.routedProvider = undefined; setSelectedModel(undefined); setSelectedProvider(undefined); }
            setPhase(step.status === 'trying' ? (step.attempt === 1 ? 'Asking the best free model' : 'Asking another free model') : 'A model was busy; choosing another free model');
            break;
          }
        }
        if ((event.type === 'delta' || event.type === 'reasoning') && !frame) frame = requestAnimationFrame(render);
      }, controller.signal);
      await finalize(record, terminal);
    } catch (err) {
      if (err instanceof RunUnavailable) await finalize(record, { type: 'local', status: 'interrupted', message: err.message });
      else if (!controller.signal.aborted) await finalize(record, { type: 'local', status: 'interrupted', message: (err as Error).message });
      else if (active.current?.record.id === record.id && active.current.cancelRequested) await finalize(record, { type: 'local', status: 'canceled' });
      // Otherwise the page is unmounting; the record stays 'running' so a reload can reattach.
    } finally {
      clearInterval(persist);
      if (frame) cancelAnimationFrame(frame);
    }
  };

  const execute = async (attempt: Attempt, retryOf?: string) => {
    const routed = isRouter(attempt);
    const connection = routed ? undefined : useConnections.getState().connections.find(c => c.id === attempt.connectionId);
    if (!routed && !connection) { setError({ message: 'This thread’s connection was removed. Choose another model in Models.', retryable: false }); return; }
    // Read the pool at send time, so current keys and catalogs are used and never saved with the run.
    const pool = routed ? currentRouterPool(useConnections.getState().connections, useConnections.getState().catalog) : undefined;
    if (pool && !pool.route) { setError({ message: NO_FREE_MODELS, retryable: false }); return; }
    const discovery = connection ? latestResult(useConnections.getState().catalog[connection.id]) : undefined;
    const descriptor = discovery?.ok ? discovery.models.find(item => item.id === attempt.model) : undefined;
    const pricing = discovery?.ok ? {
      execution: discovery.execution,
      classification: discovery.execution === 'local' ? 'local' as const : descriptor?.pricing ?? 'unknown' as const,
      ...(descriptor?.price ? { inputPerMillion: descriptor.price.input, outputPerMillion: descriptor.price.output } : {}),
      catalogCheckedAt: discovery.checkedAt,
    } : undefined;
    const controller = new AbortController();
    const record: RunRecord = {
      id: uuidv4(), conversationId: attempt.conversationId, connectionId: attempt.connectionId, provider: connection?.name ?? routerName(attempt), model: attempt.model,
      prompt: attempt.prompt, startedAt: Date.now(), durationMs: 0, status: 'running', mode: attempt.tools.length ? 'agent' : 'chat',
      input: structuredClone(attempt.input), notices: [...(attempt.input.context.notices ?? [])],
      output: '', reasoning: '', activities: [], tools: [], idempotencyKey: uuidv4(), lastSeq: 0, ...(retryOf ? { retryOf } : {}),
      ...(pricing ? { pricing } : {}),
    };
    active.current = { record, controller, cancelRequested: false };
    lastAttempt.current = { ...attempt, recordId: record.id };
    showRunning(record, 'Starting');
    try {
      // Durable before contacting the model, so a reload can find this run.
      await store.runs.put(record);
      const agentSettings = useChat.getState().settings?.agent;
      const choice = pool?.route
        ? { route: { ...pool.route, strategy: routeStrategy(attempt), ...(routeStrategy(attempt) === 'agent' && agentSettings ? { agent: agentSettings } : {}) } }
        : { target: targetFor(connection!), model: attempt.model };
      const { runId } = await startRun({
        idempotencyKey: record.idempotencyKey!, ...choice, messages: attempt.messages,
        costPolicy: routed ? 'free-only' : runCostPolicy(attempt.conversationId),
        settings: attempt.input.settings,
        ...(attempt.tools.length ? { tools: attempt.tools } : {}),
        documents: usesDocumentTools(attempt.tools) ? attempt.documents : [],
        // Read at send time so the key never enters the saved run snapshot.
        // With automatic web search, the server searches first when the message needs current information.
        ...(autoWebSearch(useChat.getState().settings?.webSearch) ? { search: { provider: 'exa' as const, apiKey: searchKey(), auto: true } } : {}),
      }, controller.signal);
      record.runId = runId;
      setStreamRunId(runId);
      await store.runs.patch(record.id, { runId });
    } catch (err) {
      const canceled = active.current?.cancelRequested;
      await finalize(record, { type: 'local', status: canceled ? 'canceled' : 'failed', message: canceled ? undefined : (err as Error).message });
      return;
    }
    if (active.current?.cancelRequested) void cancelRun(record.runId);
    await follow(record, controller);
  };

  const preparing = useRef(false);
  const prepareAndSend = async (prompt: string, documents: WorkspaceDocument[]) => {
    if (active.current || !prompt.trim()) return;
    let state = useChat.getState();
    try {
      if (!state.activeConversation()) { await state.newConversation(); state = useChat.getState(); }
    } catch (err) { setError({ message: (err as Error).message || 'Unable to create a thread.', retryable: false }); return; }
    const conversation = state.activeConversation();
    if (!conversation) { setError({ message: 'Unable to create a thread.', retryable: false }); return; }
    if (!conversation.model || !conversation.connectionId) { setError({ message: 'Choose a model in Models first.', retryable: false }); return; }
    const routed = isRouter(conversation);
    const connection = routed ? undefined : useConnections.getState().connections.find(c => c.id === conversation.connectionId);
    if (!routed && !connection) { setError({ message: 'This thread’s connection was removed. Choose another model in Models.', retryable: false }); return; }
    const pool = routed ? currentRouterPool(useConnections.getState().connections, useConnections.getState().catalog) : undefined;
    if (pool && !pool.route) { setError({ message: NO_FREE_MODELS, retryable: false }); return; }
    const blocked = policyBlock({ connectionId: conversation.connectionId, modelId: conversation.model }, conversation.id);
    if (blocked) { setError({ message: blocked, retryable: false, policy: true }); return; }
    const result = connection ? latestResult(useConnections.getState().catalog[connection.id]) : undefined;
    const descriptor = result?.ok ? result.models.find(m => m.id === conversation.model) : undefined;
    const configured = workbenchSettings(conversation, state.settings);
    const tools = toolNamesFor(configured.tools);
    const documentTools = usesDocumentTools(tools);
    // Enabled tools are never dropped silently; the user turns them off or changes model.
    // For the Free Router the server keeps only models that can use them.
    const toolProblem = tools.length && descriptor?.capabilities.tools === false ? 'This model does not support tools. Turn off tools or choose another model.'
      : documentTools && pool && !pool.local ? 'Document tools run only on models on this machine, and the Free Router has none. Turn off Documents or connect a local model.'
      : documentTools && connection && !isLocal(connection) ? 'Document tools run only on models on this machine, so documents are never sent online. Turn off Documents or choose a local model.'
      : documentTools && !documents.length ? 'Add a document in Workspace, or turn off Documents.'
      : null;
    const context = buildContext(conversation.messages, prompt, configured, descriptor, connection, conversation.attachments);
    if (context.warnings.length || toolProblem) {
      setError({ message: context.warnings[0] || toolProblem!, retryable: false }); return;
    }
    const input: InputSnapshot = { messages: context.messages, settings: context.effective, configured,
      context: { estimatedTokens: context.estimatedTokens, budget: context.budget, omittedMessages: context.omittedMessages, limitKnown: context.limitKnown, notices: context.notices },
      documents: documentTools ? documents.map(({ id, title, content }) => ({ id, title, content })) : [],
      tools,
      attachments: (conversation.attachments ?? []).map(({ id, name, mimeType, size, content, kind }) => ({ id, name, mimeType, size, content, kind })),
    };
    try { await state.addMessage('user', prompt, undefined, conversation.id); }
    catch (err) { setError({ message: (err as Error).message || 'Unable to save your message.', retryable: false }); return; }
    await execute({
      conversationId: conversation.id, connectionId: conversation.connectionId, model: conversation.model, prompt, tools, documents: input.documents,
      messages: context.messages, input,
    });
  };

  const send = async (prompt: string, documents: WorkspaceDocument[]) => {
    if (preparing.current) return;
    preparing.current = true;
    try { await prepareAndSend(prompt, documents); }
    finally { preparing.current = false; }
  };

  /** Try the last attempt again as a linked run, optionally on a model the user chose. The user message is not repeated. */
  const retry = async (override?: ModelRef) => {
    const attempt = lastAttempt.current;
    if (!attempt || active.current) return;
    const next = override ? { ...attempt, connectionId: override.connectionId, model: override.modelId } : attempt;
    const blocked = policyBlock({ connectionId: next.connectionId, modelId: next.model }, next.conversationId);
    if (blocked) { setError({ message: blocked, retryable: false, policy: true }); return; }
    if (override) await useChat.getState().setConversationModel(attempt.conversationId, override);
    const result = latestResult(useConnections.getState().catalog[next.connectionId]);
    const descriptor = result?.ok ? result.models.find(m => m.id === next.model) : undefined;
    const connection = useConnections.getState().connections.find(c => c.id === next.connectionId);
    const context = buildContext(next.messages, '', { ...next.input.configured, systemPrompt: '', history: 'all' }, descriptor, connection);
    if (context.warnings.length) { setError({ message: context.warnings[0], retryable: false }); return; }
    // Retry preserves the original context and settings; only the explicitly chosen route may change.
    await execute({ ...next, input: override ? { ...next.input, settings: context.effective, context: { ...next.input.context, budget: context.budget, limitKnown: context.limitKnown } } : next.input }, attempt.recordId);
  };

  const stop = () => {
    const current = active.current;
    if (!current || current.cancelRequested) return;
    current.cancelRequested = true;
    setPhase('Stopping');
    // The server confirms with a canceled event; stop following if it cannot be reached.
    if (current.record.runId) void cancelRun(current.record.runId);
    setTimeout(() => { if (active.current === current) current.controller.abort(); }, current.record.runId ? CANCEL_GRACE_MS : 0);
  };

  // Reattach to a run that was in progress when the page was reloaded.
  useEffect(() => {
    let disposed = false;
    let mine: AbortController | null = null;
    void (async () => {
      const pending = (await store.runs.list({ status: 'running' }).catch(() => [])).sort((a, b) => b.startedAt - a.startedAt);
      if (disposed) return;
      for (const record of pending) {
        if (active.current) break;
        if (!record.runId || Date.now() - record.startedAt > RESUME_WINDOW_MS) {
          await finalize(record, { type: 'local', status: 'interrupted', message: 'This run was interrupted before it finished.' });
          continue;
        }
        const controller = new AbortController();
        mine = controller;
        active.current = { record, controller, cancelRequested: false };
        lastAttempt.current = {
          conversationId: record.conversationId, connectionId: record.connectionId || '', model: record.model, prompt: record.prompt,
          messages: record.input?.messages ?? historyOf(record.conversationId), documents: record.input?.documents ?? [], recordId: record.id,
          tools: record.input?.tools ?? (record.mode === 'agent' ? ['search_documents', 'read_document'] : []),
          input: record.input ?? { messages: historyOf(record.conversationId), settings: { maxTokens: 2048 }, configured: workbenchSettings(), context: { estimatedTokens: 0, budget: 8192, omittedMessages: 0, limitKnown: false }, documents: [] },
        };
        showRunning(record, 'Reconnecting');
        setStreamRunId(record.runId);
        void follow(record, controller);
      }
    })();
    return () => {
      disposed = true;
      if (mine) { mine.abort(); if (active.current?.controller === mine) active.current = null; }
    };
  }, []);

  useEffect(() => () => { if (active.current && !active.current.cancelRequested) active.current.controller.abort(); }, []);

  return {
    send, retry, stop, running, partial, reasoning, activities, selectedModel, selectedProvider, phase, error, tools, route, agent, runConversationId, streamRunId,
    canRetry: canRetry && !!lastAttempt.current && !running,
    clearError: () => setError(null),
  };
}
