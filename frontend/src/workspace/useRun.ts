import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryResult, ModelRef, ProviderErrorCategory, RunMessage, TerminalPayload, ToolName, ToolTrace } from '@app/types';
import useChat from '../state/chatStore';
import type { RunRecord, WorkspaceDocument } from '../lib/db';
import * as store from '../lib/store';
import { costStatus, freeAlternatives } from '../lib/cost';
import useConnections, { isLocal, latestResult, targetFor } from '../state/connections';
import { buildContext, toolNamesFor, usesDocumentTools, workbenchSettings, type InputSnapshot } from '../lib/workbench';
import { cancelRun, followRun, RunUnavailable, startRun } from './runClient';
import { hasSearchKey, searchKey } from '../lib/searchKey';

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

/** Why Free only blocks this model in this thread, or null when it may run. */
export function policyBlock(ref: ModelRef, conversationId?: string): string | null {
  const chat = useChat.getState();
  if (chat.settings?.costPolicy !== 'free-only') return null;
  if (conversationId && chat.conversations.find(c => c.id === conversationId)?.allowCharges) return null;
  const status = costOf(ref);
  return status.free ? null : `Free only is on. ${status.detail}`;
}

const historyOf = (conversationId: string): RunMessage[] =>
  (useChat.getState().conversations.find(c => c.id === conversationId)?.messages ?? []).map(({ role, content }) => ({ role, content }));

export function useRun() {
  const [running, setRunning] = useState(false);
  const [partial, setPartial] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<RunError | null>(null);
  const [tools, setTools] = useState<ToolTrace[]>([]);
  const [runConversationId, setRunConversationId] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  /** Server run shown in the live bubble; the saved message for it replaces the bubble. */
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const active = useRef<{ record: RunRecord; controller: AbortController; cancelRequested: boolean } | null>(null);
  const lastAttempt = useRef<(Attempt & { recordId: string }) | null>(null);

  const showRunning = (record: RunRecord, phaseText: string) => {
    setRunning(true); setPartial(record.output); setReasoning(record.reasoning || ''); setTools(record.tools);
    setError(null); setCanRetry(false); setPhase(phaseText); setRunConversationId(record.conversationId);
  };

  /** Record the outcome exactly once, even if another tab follows the same run. */
  const finalize = async (record: RunRecord, outcome: TerminalPayload | LocalOutcome) => {
    const status = outcome.type === 'local' ? outcome.status : outcome.type;
    const timing = outcome.type === 'local' ? undefined : outcome.timing;
    const final: RunRecord = {
      ...record,
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
        const metadata = { ...(record.reasoning ? { reasoning: record.reasoning } : {}), ...(record.tools.length ? { tools: record.tools } : {}) };
        await chat.addMessage('assistant', record.output, Object.keys(metadata).length ? metadata : undefined, record.conversationId, {
          ...(record.connectionId ? { provenance: { connectionId: record.connectionId, modelId: record.model } } : {}),
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
    setRunning(false); setPartial(''); setReasoning('');
    setPhase(status === 'canceled' ? 'Stopped' : '');
    if (outcome.type === 'failed') {
      const ref = { connectionId: record.connectionId || '', modelId: record.model };
      // When a free route runs out of quota, offer other free routes rather than switching silently.
      const suggestions = outcome.error.category === 'quota' && costOf(ref).free
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
      void store.runs.patch(record.id, { output: record.output, reasoning: record.reasoning, lastSeq: record.lastSeq, tools: record.tools, notices: record.notices }).catch(() => undefined);
    }, PERSIST_MS);
    try {
      const terminal = await followRun(record.runId!, record.lastSeq ?? 0, ({ seq, event }) => {
        record.lastSeq = seq;
        dirty = true;
        switch (event.type) {
          case 'queued': setPhase(event.position > 0 ? `Queued behind ${event.position} local run${event.position === 1 ? '' : 's'}` : 'Queued'); break;
          case 'started': setPhase('Waiting for the model'); break;
          case 'status': record.notices = [...new Set([...(record.notices || []), event.message])]; setPhase(event.message); break;
          case 'reasoning': record.reasoning = (record.reasoning || '') + event.text; setPhase('Reasoning'); break;
          case 'delta': record.output += event.text; setPhase('Generating'); break;
          case 'tool': {
            const { type: _type, ...trace } = event;
            const index = trace.id ? record.tools.findIndex(t => t.id === trace.id && t.step === trace.step) : -1;
            record.tools = index >= 0 ? record.tools.map((t, i) => i === index ? trace : t) : [...record.tools, trace];
            setTools(record.tools);
            setPhase(trace.status === 'running' ? `Running ${trace.name.replaceAll('_', ' ')}` : 'Waiting for the model');
            break;
          }
          case 'quota': record.quota = event.quota; if (record.connectionId) useConnections.getState().setQuota(record.connectionId, event.quota); break;
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
    const connection = useConnections.getState().connections.find(c => c.id === attempt.connectionId);
    if (!connection) { setError({ message: 'This thread’s connection was removed. Choose another model in Models.', retryable: false }); return; }
    const discovery = latestResult(useConnections.getState().catalog[connection.id]);
    const descriptor = discovery?.ok ? discovery.models.find(item => item.id === attempt.model) : undefined;
    const pricing = discovery?.ok ? {
      execution: discovery.execution,
      classification: discovery.execution === 'local' ? 'local' as const : descriptor?.pricing ?? 'unknown' as const,
      ...(descriptor?.price ? { inputPerMillion: descriptor.price.input, outputPerMillion: descriptor.price.output } : {}),
      catalogCheckedAt: discovery.checkedAt,
    } : undefined;
    const controller = new AbortController();
    const record: RunRecord = {
      id: uuidv4(), conversationId: attempt.conversationId, connectionId: connection.id, provider: connection.name, model: attempt.model,
      prompt: attempt.prompt, startedAt: Date.now(), durationMs: 0, status: 'running', mode: attempt.tools.length ? 'agent' : 'chat',
      input: structuredClone(attempt.input), notices: [],
      output: '', reasoning: '', tools: [], idempotencyKey: uuidv4(), lastSeq: 0, ...(retryOf ? { retryOf } : {}),
      ...(pricing ? { pricing } : {}),
    };
    active.current = { record, controller, cancelRequested: false };
    lastAttempt.current = { ...attempt, recordId: record.id };
    showRunning(record, 'Starting');
    try {
      // Durable before contacting the model, so a reload can find this run.
      await store.runs.put(record);
      const { runId } = await startRun({
        idempotencyKey: record.idempotencyKey!, target: targetFor(connection), model: attempt.model, messages: attempt.messages,
        settings: attempt.input.settings,
        ...(attempt.tools.length ? { tools: attempt.tools } : {}),
        documents: usesDocumentTools(attempt.tools) ? attempt.documents : [],
        // Read at send time so the key never enters the saved run snapshot.
        ...(attempt.tools.includes('web_search') ? { search: { provider: 'exa' as const, apiKey: searchKey() } } : {}),
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
    const connection = useConnections.getState().connections.find(c => c.id === conversation.connectionId);
    if (!conversation.model || !conversation.connectionId) { setError({ message: 'Choose a model in Models first.', retryable: false }); return; }
    if (!connection) { setError({ message: 'This thread’s connection was removed. Choose another model in Models.', retryable: false }); return; }
    const blocked = policyBlock({ connectionId: connection.id, modelId: conversation.model }, conversation.id);
    if (blocked) { setError({ message: blocked, retryable: false, policy: true }); return; }
    const result = latestResult(useConnections.getState().catalog[connection.id]);
    const descriptor = result?.ok ? result.models.find(m => m.id === conversation.model) : undefined;
    const configured = workbenchSettings(conversation, state.settings);
    const tools = toolNamesFor(configured.tools);
    const documentTools = usesDocumentTools(tools);
    // Enabled tools are never dropped silently; the user turns them off or changes model.
    const toolProblem = tools.length && descriptor?.capabilities.tools === false ? 'This model does not support tools. Turn off tools or choose another model.'
      : documentTools && !isLocal(connection) ? 'Document tools run only on models on this machine, so documents are never sent online. Turn off Documents or choose a local model.'
      : documentTools && !documents.length ? 'Add a document in Workspace, or turn off Documents.'
      : tools.includes('web_search') && !hasSearchKey() ? 'Web search needs an Exa API key. Add it in Connections, or turn off Web.'
      : null;
    const context = buildContext(conversation.messages, prompt, configured, descriptor, connection, conversation.attachments);
    if (context.warnings.length || toolProblem) {
      setError({ message: context.warnings[0] || toolProblem!, retryable: false }); return;
    }
    const input: InputSnapshot = { messages: context.messages, settings: context.effective, configured,
      context: { estimatedTokens: context.estimatedTokens, budget: context.budget, omittedMessages: context.omittedMessages, limitKnown: context.limitKnown },
      documents: documentTools ? documents.map(({ id, title, content }) => ({ id, title, content })) : [],
      tools,
      attachments: (conversation.attachments ?? []).map(({ id, name, mimeType, size, content, kind }) => ({ id, name, mimeType, size, content, kind })),
    };
    try { await state.addMessage('user', prompt, undefined, conversation.id); }
    catch (err) { setError({ message: (err as Error).message || 'Unable to save your message.', retryable: false }); return; }
    await execute({
      conversationId: conversation.id, connectionId: connection.id, model: conversation.model, prompt, tools, documents: input.documents,
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
    send, retry, stop, running, partial, reasoning, phase, error, tools, runConversationId, streamRunId,
    canRetry: canRetry && !!lastAttempt.current && !running,
    clearError: () => setError(null),
  };
}
