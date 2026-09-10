import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock, Download, FileText, XCircle } from 'lucide-react';
import { db, RunRecord } from '../lib/db';
import { exportText } from './api';

export function Runs({ openConversation }: { openConversation: (id: string) => void }) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selected, setSelected] = useState<RunRecord | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () => { void db.runs.orderBy('startedAt').reverse().limit(100).toArray().then(setRuns).catch(() => setError('Unable to read run history.')); };
    load(); window.addEventListener('nerdplexity:runs', load);
    return () => window.removeEventListener('nerdplexity:runs', load);
  }, []);
  const complete = runs.filter(run => run.status === 'completed');
  const measured = runs.filter(run => run.usage);
  return <div className="np-page">
    <div className="np-page-heading"><div><span className="np-eyebrow">RUN HISTORY</span><h1>See what actually happened.</h1><p>Real timings, reported token usage, and every document tool call.</p></div><button className="np-button" disabled={!runs.length} onClick={() => exportText('nerdplexity-runs.json', JSON.stringify(runs, null, 2), 'application/json')}><Download size={14}/>Export runs</button></div>
    {error && <p className="np-error" role="alert">{error}</p>}
    <div className="np-stats"><div><span>Saved runs</span><strong>{runs.length}</strong><small>Most recent 100</small></div><div><span>Completed</span><strong>{complete.length}</strong><small>{runs.length - complete.length} stopped or failed</small></div><div><span>Reported tokens</span><strong>{measured.reduce((sum, run) => sum + (run.usage?.total_tokens || 0), 0).toLocaleString()}</strong><small>{measured.length} runs with usage data</small></div></div>
    {!runs.length && <div className="np-empty-panel np-empty-tall"><Clock size={30}/><h3>Your first run is a starting point.</h3><p>Send a message or run a document agent. Its timing and results will appear here.</p></div>}
    <div className="np-run-list">{runs.map(run => <button key={run.id} className={`np-run-row ${selected?.id === run.id ? 'selected' : ''}`} onClick={() => setSelected(selected?.id === run.id ? null : run)}>
      {run.status === 'completed' ? <CheckCircle2 size={18} className="np-green"/> : run.status === 'failed' ? <XCircle size={18} className="np-red"/> : <Clock size={18}/>}
      <div><strong>{run.prompt}</strong><span>{run.model} · {run.mode === 'agent' ? 'Document agent' : 'Chat'} · {new Date(run.startedAt).toLocaleString()}</span></div><span className="np-run-duration">{(run.durationMs / 1000).toFixed(1)}s</span><span className={`np-label ${run.status === 'failed' ? 'error' : ''}`}>{run.status}</span>
    </button>)}</div>
    {selected && <section className="np-panel np-run-detail"><div className="np-section-title"><h2>Run details</h2><button className="np-button small" onClick={() => openConversation(selected.conversationId)}>Open thread<ArrowUpRight size={13}/></button></div><dl><div><dt>Runtime</dt><dd>{selected.provider}</dd></div><div><dt>First token</dt><dd>{selected.ttftMs === undefined ? 'Not reported' : `${(selected.ttftMs / 1000).toFixed(2)}s`}</dd></div><div><dt>Input / output tokens</dt><dd>{selected.usage ? `${selected.usage.prompt_tokens} / ${selected.usage.completion_tokens}` : 'Not reported'}</dd></div></dl>
      {selected.error && <p className="np-error">{selected.error}</p>}
      {selected.tools.map((tool, index) => <details className="np-tool-detail" key={index}><summary><FileText size={14}/>{tool.name.replaceAll('_', ' ')}<span>Step {tool.step}</span></summary><pre>{JSON.stringify({ input: tool.input, output: tool.output }, null, 2)}</pre></details>)}
      <details className="np-tool-detail"><summary>Saved output</summary><pre>{selected.output || 'No answer was generated.'}</pre></details>
    </section>}
  </div>;
}
