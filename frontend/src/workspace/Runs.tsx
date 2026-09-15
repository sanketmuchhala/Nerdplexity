import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock, Download, XCircle } from 'lucide-react';
import type { RunRecord, RunStatus } from '../lib/db';
import * as store from '../lib/store';
import useChat from '../state/chatStore';
import { exportRuns, measurementFor } from '../lib/runMetrics';
import { exportText } from './api';
import { ToolActivity } from './ToolActivity';
import { RouteActivity } from './RouteActivity';
import { AgentActivity } from './AgentActivity';

const STATUS_LABEL: Record<RunStatus, string> = { running: 'running', completed: 'completed', failed: 'failed', canceled: 'stopped', stopped: 'stopped', interrupted: 'interrupted' };
const seconds = (ms?: number) => ms === undefined ? 'Not reported' : `${(ms / 1000).toFixed(2)}s`;
const percent = (value?: number) => value === undefined ? 'Not available' : `${(value * 100).toFixed(1)}%`;
const money = (value?: number) => value === undefined ? 'Not available' : value === 0 ? '$0' : value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;
/** How often to refresh while a run is still in progress. */
const LIVE_MS = 3000;

export function Runs({ openConversation }: { openConversation: (id: string) => void }) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selected, setSelected] = useState<RunRecord | null>(null);
  const [error, setError] = useState('');
  const conversations = useChat(state => state.conversations);
  const conversationIds = useMemo(() => new Set(conversations.map(c => c.id)), [conversations]);
  const running = runs.some(run => run.status === 'running');
  useEffect(() => {
    let disposed = false;
    const refresh = () => store.runs.list({ limit: 100 }).then(value => {
      if (disposed) return;
      setRuns(value);
      setSelected(current => current ? value.find(run => run.id === current.id) ?? null : null);
      setError('');
    }, (reason: Error) => { if (!disposed) setError(`Unable to read run history. ${reason.message}`); });
    void refresh();
    // Finished runs announce themselves; runs still in progress are refreshed periodically.
    window.addEventListener('nerdplexity:runs', refresh);
    const timer = running ? setInterval(refresh, LIVE_MS) : undefined;
    return () => { disposed = true; window.removeEventListener('nerdplexity:runs', refresh); clearInterval(timer); };
  }, [running]);
  const complete = runs.filter(run => run.status === 'completed');
  const measured = runs.filter(run => run.usage);
  const selectedMetric = selected ? measurementFor(selected) : undefined;
  return <div className="np-page">
    <div className="np-page-heading"><div><span className="np-eyebrow">RUN HISTORY</span><h1>See what actually happened.</h1><p>Canonical saved outcomes, real timings, provider-reported usage, and every tool call.</p></div><button className="np-button" disabled={!runs.length} onClick={() => exportText('nerdplexity-runs.json', exportRuns(runs), 'application/json')}><Download size={14}/>Export runs</button></div>
    {error && <p className="np-error" role="alert">{error}</p>}
    <div className="np-stats"><div><span>Saved runs</span><strong>{runs.length}</strong><small>Most recent 100</small></div><div><span>Completed</span><strong>{complete.length}</strong><small>{runs.length - complete.length} running, stopped, or failed</small></div><div><span>Provider-reported tokens</span><strong>{measured.reduce((sum, run) => sum + (run.usage?.total_tokens || 0), 0).toLocaleString()}</strong><small>{measured.length} runs with usage data</small></div></div>
    {!runs.length && <div className="np-empty-panel np-empty-tall"><Clock size={30}/><h3>Your first run is a starting point.</h3><p>Send a message. Its timing, usage, and any tool calls will appear here.</p></div>}
    <div className="np-run-list">{runs.map(run => <button key={run.id} className={`np-run-row ${selected?.id === run.id ? 'selected' : ''}`} onClick={() => setSelected(selected?.id === run.id ? null : run)}>
      {run.status === 'completed' ? <CheckCircle2 size={18} className="np-green"/> : run.status === 'failed' || run.status === 'interrupted' ? <XCircle size={18} className="np-red"/> : <Clock size={18}/>}<div><strong>{run.prompt}</strong><span>{run.agentOutcome ? `${run.agentOutcome.writer.model} via ${run.provider} · ${run.agentOutcome.calls} requests` : run.routedTo ? `${run.routedTo.model} via ${run.provider}` : `${run.model} · ${run.provider}`} · {run.pricing?.execution === 'local' ? 'On this machine' : run.pricing?.execution === 'remote' ? 'Online' : 'Origin unknown'} · {run.mode === 'agent' ? 'With tools' : 'Chat'} · {new Date(run.startedAt).toLocaleString()}</span></div><span className="np-run-duration">{seconds(measurementFor(run).providerMs)}</span><span className={`np-label ${run.status === 'failed' || run.status === 'interrupted' ? 'error' : ''}`}>{STATUS_LABEL[run.status] ?? run.status}</span>
    </button>)}</div>
    {selected && selectedMetric && <section className="np-panel np-run-detail"><div className="np-section-title"><div><h2>Run details</h2><p>Measured values remain blank when the provider did not report enough data.</p></div>{conversationIds.has(selected.conversationId) && <button className="np-button small" onClick={() => openConversation(selected.conversationId)}>Open thread<ArrowUpRight size={13}/></button>}</div><dl><div><dt>Connection</dt><dd>{selected.provider}</dd></div><div><dt>Origin</dt><dd>{selected.pricing?.execution === 'local' ? 'On this machine' : selected.pricing?.execution === 'remote' ? 'Online provider' : 'Not captured'}</dd></div><div><dt>State</dt><dd>{STATUS_LABEL[selected.status]}</dd></div><div><dt>Model time</dt><dd>{seconds(selectedMetric.providerMs)}</dd></div><div><dt>Queued</dt><dd>{seconds(selected.queuedMs)}</dd></div><div><dt>First text</dt><dd>{seconds(selected.ttftMs)}</dd></div><div><dt>Total</dt><dd>{seconds(selected.durationMs)}</dd></div><div><dt>Model load</dt><dd>{seconds(selected.loadMs)}</dd></div><div><dt>Generation rate</dt><dd>{selectedMetric.tokensPerSecond === undefined ? 'Not available' : `${selectedMetric.tokensPerSecond.toFixed(1)} tokens/s`}</dd></div><div><dt>Context used</dt><dd>{percent(selectedMetric.contextUtilization)}</dd></div><div><dt>Input / output tokens</dt><dd>{selected.usage ? `${selected.usage.prompt_tokens.toLocaleString()} / ${selected.usage.completion_tokens.toLocaleString()} · provider reported` : 'Not reported'}</dd></div><div><dt>Estimated hosted cost</dt><dd>{money(selectedMetric.estimatedCostUsd)} · {selectedMetric.costProvenance === 'catalog-snapshot' ? 'catalog price captured before run' : selectedMetric.costProvenance === 'zero-price-snapshot' ? 'catalog listed $0 before run' : 'no validated price snapshot'}</dd></div>{selected.finishReason && <div><dt>Finish reason</dt><dd>{selected.finishReason}</dd></div>}{selected.retryOf && <div><dt>Attempt</dt><dd>Retry</dd></div>}</dl>
      {selected.error && <p className="np-error">{selected.errorCategory ? `${selected.errorCategory}: ` : ''}{selected.error}</p>}
      {!!selected.route?.length && <RouteActivity steps={selected.route} task={selected.routedTo?.task} nameOf={id => id} />}
      {!!selected.agent?.length && <AgentActivity steps={selected.agent} calls={selected.agentOutcome?.calls} nameOf={id => id} />}
      <ToolActivity tools={selected.tools ?? []} activities={selected.activities} />
      {selected.input && <details className="np-tool-detail"><summary>Input and settings sent</summary><pre>{JSON.stringify(selected.input, null, 2)}</pre></details>}
      {!!selected.notices?.length && <details className="np-tool-detail"><summary>Provider adjustments and status</summary><pre>{selected.notices.join('\n')}</pre></details>}
      {selected.reasoning && <details className="np-tool-detail"><summary>Reasoning reported by the model</summary><pre>{selected.reasoning}</pre></details>}
      <details className="np-tool-detail"><summary>Saved output</summary><pre>{selected.output || 'No answer was generated.'}</pre></details>
    </section>}
  </div>;
}
