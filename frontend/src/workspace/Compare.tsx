import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, GitCompare, Play, Square, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { ModelDescriptor, ModelRef, RunEnvelope, TerminalPayload } from '@app/types';
import useChat from '../state/chatStore';
import useConnections, { latestResult, modelKey, requiresKey, targetFor } from '../state/connections';
import { hasKey } from '../lib/credentials';
import { legacyProvider, type ComparisonRecord, type ComparisonSide, type Message, type RunRecord } from '../lib/db';
import * as store from '../lib/store';
import { buildContext, workbenchSettings } from '../lib/workbench';
import { cancelRun, followRun, startRun } from './runClient';
import { exportText } from './api';
import { policyBlock, runCostPolicy } from './useRun';
import { costStatus } from '../lib/cost';

type Choice = { ref: ModelRef; label: string; descriptor: ModelDescriptor };

const formatMs = (ms?: number) => ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const active = (side: ComparisonSide) => side.status === 'running' || side.status === 'queued';
/** Time the model itself took; local runs share one queue, so the second side's total includes waiting for the first. */
const runTime = (side: ComparisonSide) => side.durationMs === undefined ? undefined : side.durationMs - (side.queuedMs ?? 0);
const settingsLabel = ({ temperature, maxTokens, numCtx }: ComparisonRecord['input']['settings']) => [
  `Temperature ${temperature ?? 'model default'}`,
  `max output ${maxTokens?.toLocaleString() ?? 'provider default'}`,
  ...(numCtx ? [`context window ${numCtx.toLocaleString()}`] : []),
].join(' · ');

export function Compare({ onChat }: { onChat: () => void }) {
  const chat = useChat();
  const connectionState = useConnections();
  const [records, setRecords] = useState<ComparisonRecord[]>([]);
  const [prompt, setPrompt] = useState('');
  const [chosen, setChosen] = useState<[string, string]>(['', '']);
  const [current, setCurrent] = useState<ComparisonRecord | null>(null);
  const [error, setError] = useState('');
  const controllers = useRef<AbortController[]>([]);
  const activeConversation = chat.activeConversation();
  const choices = useMemo<Choice[]>(() => connectionState.connections.flatMap(connection => {
    const result = latestResult(connectionState.catalog[connection.id]);
    if (!result?.ok) return [];
    return result.models.map(descriptor => ({ ref: { connectionId: connection.id, modelId: descriptor.id }, descriptor, label: `${descriptor.displayName} · ${connection.name}` }));
  }), [connectionState.connections, connectionState.catalog]);

  const refresh = async () => setRecords(await store.comparisons.list().catch(() => []));
  useEffect(() => { void refresh(); return () => controllers.current.forEach(controller => controller.abort()); }, []);
  useEffect(() => {
    if (chosen[0] || choices.length < 2) return;
    setChosen([modelKey(choices[0].ref.connectionId, choices[0].ref.modelId), modelKey(choices[1].ref.connectionId, choices[1].ref.modelId)]);
  }, [choices, chosen]);

  const choiceFor = (key: string) => choices.find(choice => modelKey(choice.ref.connectionId, choice.ref.modelId) === key);
  const persist = async (record: ComparisonRecord) => { record.updatedAt = Date.now(); await store.comparisons.put(structuredClone(record)); };
  const show = (record: ComparisonRecord) => { setCurrent(structuredClone(record)); };

  const runSide = async (comparison: ComparisonRecord, index: 0 | 1) => {
    const side = comparison.sides[index];
    const connection = connectionState.connections.find(item => item.id === side.connectionId)!;
    const discovery = latestResult(connectionState.catalog[connection.id]);
    const descriptor = discovery?.ok ? discovery.models.find(item => item.id === side.modelId) : undefined;
    const effectiveCost = costStatus(connection, descriptor, discovery?.ok ? discovery.execution : undefined);
    const controller = new AbortController();
    controllers.current.push(controller);
    const record: RunRecord = {
      id: uuidv4(), conversationId: comparison.sourceConversationId ?? `comparison:${comparison.id}`, connectionId: side.connectionId,
      provider: connection.name, model: side.modelId, prompt: comparison.prompt, startedAt: Date.now(), durationMs: 0,
      status: 'running', mode: 'chat', output: '', reasoning: '', tools: [], input: structuredClone(comparison.input), notices: [], idempotencyKey: uuidv4(), lastSeq: 0,
      ...(discovery?.ok ? { pricing: { execution: discovery.execution, classification: discovery.execution === 'local' ? 'local' as const : effectiveCost.cls === 'no-billing' ? 'free-tier' as const : descriptor?.pricing ?? 'unknown' as const, ...(descriptor?.price ? { inputPerMillion: descriptor.price.input, outputPerMillion: descriptor.price.output } : {}), catalogCheckedAt: discovery.checkedAt } } : {}),
    };
    side.runRecordId = record.id;
    await store.runs.put(record);
    try {
      const started = await startRun({ idempotencyKey: record.idempotencyKey!, costPolicy: runCostPolicy(comparison.sourceConversationId), target: targetFor(connection), model: side.modelId, messages: comparison.input.messages, settings: comparison.input.settings }, controller.signal);
      side.runId = started.runId; record.runId = started.runId; await store.runs.patch(record.id, { runId: started.runId });
      const terminal = await followRun(started.runId, 0, (envelope: RunEnvelope) => {
        record.lastSeq = envelope.seq;
        if (envelope.event.type === 'queued' && envelope.event.position > 0) side.status = 'queued';
        if (envelope.event.type === 'started') side.status = 'running';
        if (envelope.event.type === 'delta') { side.output += envelope.event.text; record.output = side.output; }
        if (envelope.event.type === 'reasoning') { side.reasoning = (side.reasoning ?? '') + envelope.event.text; record.reasoning = side.reasoning; }
        if (envelope.event.type === 'quota') connectionState.setQuota(connection.id, envelope.event.quota);
        show(comparison);
      }, controller.signal);
      finishSide(side, record, terminal);
    } catch (reason) {
      side.status = controller.signal.aborted ? 'canceled' : 'failed'; side.error = controller.signal.aborted ? 'Stopped.' : (reason as Error).message;
      record.status = side.status; record.error = side.error; record.durationMs = Date.now() - record.startedAt;
    }
    await store.runs.put(record); await persist(comparison); show(comparison);
  };

  const finishSide = (side: ComparisonSide, record: RunRecord, terminal: TerminalPayload) => {
    side.status = terminal.type; side.durationMs = terminal.timing.durationMs; side.queuedMs = terminal.timing.queuedMs; side.ttftMs = terminal.timing.ttftMs;
    record.status = terminal.type; record.durationMs = terminal.timing.durationMs; record.ttftMs = terminal.timing.ttftMs; record.queuedMs = terminal.timing.queuedMs;
    if (terminal.type === 'completed') { side.usage = terminal.usage; side.loadMs = terminal.loadMs; record.usage = terminal.usage; record.loadMs = terminal.loadMs; record.finishReason = terminal.finishReason; }
    if (terminal.type === 'failed') { side.error = terminal.error.message; record.error = terminal.error.message; record.errorCategory = terminal.error.category; }
  };

  const start = async () => {
    setError('');
    const first = choiceFor(chosen[0]);
    const second = choiceFor(chosen[1]);
    if (!prompt.trim()) { setError('Enter one prompt to compare.'); return; }
    if (!first || !second || chosen[0] === chosen[1]) { setError('Choose two different models.'); return; }
    const selected = [first, second] as const;
    for (const choice of selected) {
      const connection = connectionState.connections.find(c => c.id === choice.ref.connectionId)!;
      if (requiresKey(connection.kind) && !hasKey(connection.id)) { setError(`Add the API key for ${connection.name} first.`); return; }
      const blocked = policyBlock(choice.ref, activeConversation?.id);
      if (blocked) { setError(`${choice.descriptor.displayName}: ${blocked}`); return; }
    }
    // Comparisons run without tools; the snapshot records that, whatever the source thread enables.
    const configured = { ...workbenchSettings(activeConversation, chat.settings), tools: [] };
    const contextLimit = Math.min(...selected.map(choice => choice.descriptor.contextLength ?? Infinity));
    const sharedDescriptor = { ...selected[0].descriptor, contextLength: Number.isFinite(contextLimit) ? contextLimit : undefined };
    const context = buildContext(activeConversation?.messages ?? [], prompt.trim(), configured, sharedDescriptor, undefined, activeConversation?.attachments);
    if (context.warnings.length) { setError(context.warnings[0]); return; }
    const now = Date.now();
    const comparison: ComparisonRecord = {
      id: uuidv4(), prompt: prompt.trim(), createdAt: now, updatedAt: now, sourceConversationId: activeConversation?.id,
      input: { messages: context.messages, settings: context.effective, configured, context: { estimatedTokens: context.estimatedTokens, budget: context.budget, omittedMessages: context.omittedMessages, limitKnown: context.limitKnown, notices: context.notices }, documents: [], attachments: (activeConversation?.attachments ?? []).map(({ id, name, mimeType, size, content, kind }) => ({ id, name, mimeType, size, content, kind })) },
      sides: selected.map(choice => ({ connectionId: choice.ref.connectionId, modelId: choice.ref.modelId, status: 'running', output: '' })) as [ComparisonSide, ComparisonSide],
    };
    await persist(comparison); show(comparison); setRecords(items => [structuredClone(comparison), ...items]);
    await Promise.all([runSide(comparison, 0), runSide(comparison, 1)]);
    await refresh(); window.dispatchEvent(new Event('nerdplexity:runs'));
  };

  const stop = () => { for (const side of current?.sides ?? []) if (side.runId && active(side)) void cancelRun(side.runId); for (const controller of controllers.current) controller.abort(); };
  const continueFrom = async (comparison: ComparisonRecord, side: ComparisonSide) => {
    const source = chat.conversations.find(c => c.id === comparison.sourceConversationId);
    const connection = connectionState.connections.find(c => c.id === side.connectionId);
    if (!connection || !side.output) return;
    const messages: Message[] = [...(source?.messages ?? []), { id: uuidv4(), role: 'user', content: comparison.prompt, createdAt: Date.now() }, { id: uuidv4(), role: 'assistant', content: side.output, createdAt: Date.now(), provenance: { connectionId: side.connectionId, modelId: side.modelId }, ...(side.reasoning ? { metadata: { reasoning: side.reasoning } } : {}) }];
    await chat.newConversation({ title: `${comparison.prompt.slice(0, 60)}${comparison.prompt.length > 60 ? '…' : ''}`, provider: legacyProvider(connection.kind), connectionId: connection.id, model: side.modelId, messages, attachments: structuredClone(source?.attachments ?? []), workbench: structuredClone(comparison.input.configured), allowCharges: false });
    onChat();
  };
  const exported = (comparison: ComparisonRecord) => JSON.stringify({ format: 'nerdplexity-comparison', version: 1, prompt: comparison.prompt, createdAt: comparison.createdAt, input: { messages: comparison.input.messages, settings: comparison.input.settings, context: comparison.input.context, attachments: comparison.input.attachments }, sides: comparison.sides.map(({ modelId, status, output, reasoning, durationMs, queuedMs, ttftMs, loadMs, usage, error }) => ({ modelId, status, output, reasoning, durationMs, queuedMs, ttftMs, loadMs, usage, error })) }, null, 2);

  return <div className="np-page np-compare-page">
    <div className="np-page-heading"><div><span className="np-eyebrow">COMPARE</span><h1>Same question. Two models.</h1><p>Both runs receive one frozen input snapshot, including the same thread history and attached files.</p></div><GitCompare size={24} /></div>
    <section className="np-panel np-compare-setup">
      <div className="np-compare-pickers">{([0, 1] as const).map(index => <label className="np-field" key={index}><span>Model {index === 0 ? 'A' : 'B'}</span><select aria-label={`Comparison model ${index === 0 ? 'A' : 'B'}`} value={chosen[index]} onChange={event => setChosen(index === 0 ? [event.target.value, chosen[1]] : [chosen[0], event.target.value])}><option value="">Choose…</option>{choices.map(choice => <option value={modelKey(choice.ref.connectionId, choice.ref.modelId)} key={modelKey(choice.ref.connectionId, choice.ref.modelId)}>{choice.label}</option>)}</select></label>)}</div>
      <label className="np-field"><span>Shared prompt</span><textarea rows={5} maxLength={100_000} aria-label="Comparison prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Ask one question…" /></label>
      {activeConversation && <p className="np-conn-hint">Source context: “{activeConversation.title}” · {activeConversation.messages.length} messages · {activeConversation.attachments?.length ?? 0} attached files</p>}
      {error && <p className="np-error" role="alert">{error}</p>}
      <div className="np-conn-actions">{current?.sides.some(active) && <button className="np-button ghost" onClick={stop}><Square size={13} /> Stop both</button>}<button className="np-button primary" disabled={current?.sides.some(active)} onClick={() => void start()}><Play size={13} /> Run comparison</button></div>
    </section>
    {current && <p className="np-conn-hint np-compare-settings">Shared settings: {settingsLabel(current.input.settings)}.{current.sides.every(side => { const result = latestResult(connectionState.catalog[side.connectionId]); return result?.ok && result.execution === 'local'; }) && ' Both models run on this machine, so they run one at a time and do not compete for memory. Run time excludes the wait.'}</p>}
    {current && <section className="np-compare-results" aria-label="Comparison results">{current.sides.map((side, index) => <article className="np-panel np-compare-side" key={index}><header><div><span className="np-eyebrow">MODEL {index === 0 ? 'A' : 'B'}</span><h2>{side.modelId}</h2></div><span className={`np-label ${side.status === 'failed' ? 'error' : ''}`}>{side.status}</span></header><div className="np-compare-metrics"><span>Measured run time <strong>{formatMs(runTime(side))}</strong></span><span>Measured first text <strong>{formatMs(side.ttftMs)}</strong></span><span>Provider-reported tokens <strong>{side.usage?.total_tokens?.toLocaleString() ?? '—'}</strong></span><span>Estimated shared input <strong>~{current.input.context.estimatedTokens.toLocaleString()}</strong></span><span>Runtime-reported model load <strong>{side.loadMs === undefined ? 'Not reported' : formatMs(side.loadMs)}</strong></span><span>Waited in local queue <strong>{formatMs(side.queuedMs)}</strong></span></div>{side.reasoning && <details><summary>Reasoning</summary><pre>{side.reasoning}</pre></details>}<div className="np-compare-output">{side.output || (side.error ? <span className="np-error">{side.error}</span> : side.status === 'queued' ? 'Waiting for the other local model to finish…' : 'Waiting for output…')}</div>{side.output && <button className="np-button small" onClick={() => void continueFrom(current, side)}>Continue in chat</button>}</article>)}</section>}
    <section className="np-compare-history"><div className="np-section-title"><div><h2>Saved comparisons</h2><p>Results are saved with your threads until you remove them.</p></div></div>{records.map(record => <article className="np-run-row" key={record.id}><GitCompare size={15} /><button onClick={() => show(record)}><strong>{record.prompt}</strong><small>{record.sides.map(side => side.modelId).join(' vs ')}</small></button><span className="np-label">{new Date(record.createdAt).toLocaleDateString()}</span><button className="np-icon-button" aria-label="Export comparison" onClick={() => exportText('nerdplexity-comparison.json', exported(record), 'application/json')}><Download size={13} /></button><button className="np-icon-button" aria-label="Delete comparison" onClick={async () => { await store.comparisons.remove(record.id); if (current?.id === record.id) setCurrent(null); await refresh(); }}><Trash2 size={13} /></button></article>)}</section>
  </div>;
}
