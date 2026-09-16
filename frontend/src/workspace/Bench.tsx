import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Play, Square, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { BenchCategory, BenchResult, BenchResults, BenchStartResponse, BenchSuiteInfo, ConnectionKind, SpecialistEntry, TaskKind } from '@app/types';
import { api } from '../lib/api';
import useConnections, { currentRouterPool, modelKey } from '../state/connections';
import { cancelRun, followRun } from './runClient';

const CATEGORY_LABEL: Record<BenchCategory, string> = { code: 'Code', math: 'Math', instructions: 'Instructions', tools: 'Tools', facts: 'Facts' };
const CATEGORIES = Object.keys(CATEGORY_LABEL) as BenchCategory[];
/** Free requests per day where the provider documents a daily cap for free accounts. */
const DAILY_LIMIT: Partial<Record<ConnectionKind, { requests: number; note: string }>> = {
  openrouter: { requests: 50, note: 'free accounts allow 50 free-model requests a day (1,000 after buying $10 of credit)' },
  sambanova: { requests: 20, note: 'the free tier allows 20 requests a day' },
};

const KIND_LABEL: Record<TaskKind, string> = { code: 'Code', math: 'Math', reasoning: 'Reasoning', writing: 'Writing', extraction: 'Structured output', general: 'General' };

type Job = { runId: string; total: number; done: number; skipped: number; status: string; running: boolean; outcome?: string };

const percent = (passed: number, graded: number) => graded ? Math.round(passed / graded * 100) : undefined;
const formatMs = (ms?: number) => ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

export function Bench() {
  const { connections, catalog } = useConnections();
  useConnections(state => state.keyVersion);
  const pool = currentRouterPool(connections, catalog);
  const [suite, setSuite] = useState<BenchSuiteInfo | null>(null);
  const [results, setResults] = useState<BenchResults | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Set<BenchCategory>>(new Set(CATEGORIES));
  const [perCategory, setPerCategory] = useState(3);
  const [job, setJob] = useState<Job | null>(null);
  const [live, setLive] = useState<BenchResult[]>([]);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const [specialists, setSpecialists] = useState<Record<TaskKind, SpecialistEntry[]> | null>(null);

  const loadResults = () => api<BenchResults>('/v1/bench/results').then(setResults, (reason: Error) => setError(`Unable to read Bench results. ${reason.message}`));
  useEffect(() => {
    api<BenchSuiteInfo>('/v1/bench/suite').then(setSuite, (reason: Error) => setError(`Unable to read the Bench suite. ${reason.message}`));
    void loadResults();
    return () => controller.current?.abort();
  }, []);

  const models = pool.route?.models ?? [];
  // Who the Free Agent would ask for each kind of task, refreshed when results or models change.
  const poolKey = models.map(m => `${m.connectionId}\n${m.model}`).join('|');
  useEffect(() => {
    if (!pool.route) { setSpecialists(null); return; }
    let current = true;
    api<{ specialists: Record<TaskKind, SpecialistEntry[]> }>('/v1/agent/specialists', { body: { route: pool.route } })
      .then(data => { if (current) setSpecialists(data.specialists); }, () => { if (current) setSpecialists(null); });
    return () => { current = false; };
  }, [poolKey, results]);
  const nameOf = (connectionId: string) => connections.find(c => c.id === connectionId)?.name ?? connectionId;
  const kindOf = (connectionId: string) => connections.find(c => c.id === connectionId)?.kind;
  const chosen = models.filter(m => selected.has(modelKey(m.connectionId, m.model)));
  const perModel = categories.size * perCategory;
  // Requests per connection, and the ones that exceed a documented daily cap.
  const counts = new Map<string, number>();
  for (const m of chosen) counts.set(m.connectionId, (counts.get(m.connectionId) ?? 0) + perModel);
  const plan = [...counts].map(([id, requests]) => ({ id, requests, limit: DAILY_LIMIT[kindOf(id)!] }));

  const toggle = (key: string) => setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleCategory = (category: BenchCategory) => setCategories(current => { const next = new Set(current); if (next.has(category)) next.delete(category); else next.add(category); return next; });

  const start = async () => {
    if (!pool.route || !chosen.length || !categories.size) return;
    setError(''); setLive([]);
    const used = new Set(chosen.map(m => m.connectionId));
    let state: Job | undefined;
    try {
      const started = await api<BenchStartResponse>('/v1/bench', { body: {
        idempotencyKey: uuidv4(), perCategory, categories: CATEGORIES.filter(c => categories.has(c)),
        connections: pool.route.connections.filter(c => used.has(c.id)),
        models: chosen.map(({ connectionId, model }) => ({ connectionId, model })),
      } });
      const job: Job = { runId: started.runId, total: started.total, done: 0, skipped: 0, status: 'Starting', running: true };
      state = job;
      setJob(job);
      const abort = new AbortController();
      controller.current = abort;
      const terminal = await followRun(started.runId, 0, ({ event }) => {
        if (event.type === 'bench') {
          job.done = event.done; job.skipped += event.skipped ?? 0;
          if (event.result) { const result = event.result; setLive(current => [result, ...current]); }
          setJob({ ...job, status: event.result ? `${event.result.model}: ${event.result.status}` : job.status });
        } else if (event.type === 'status') {
          job.status = event.message;
          setJob({ ...job });
        }
      }, abort.signal);
      setJob({ ...job, running: false, outcome: terminal.type === 'completed' ? 'Finished.' : terminal.type === 'canceled' ? 'Stopped. Results so far are saved.' : terminal.error.message });
    } catch (reason) {
      if (state) setJob({ ...state, running: false, outcome: (reason as Error).message });
      else setError((reason as Error).message);
    } finally {
      controller.current = null;
      void loadResults();
    }
  };

  const clear = async () => {
    try { await api('/v1/bench/results', { method: 'DELETE' }); await loadResults(); setLive([]); }
    catch (reason) { setError((reason as Error).message); }
  };

  // One row per model: pass counts per category, overall, and mean time.
  const rows = useMemo(() => {
    const byModel = new Map<string, { connectionId: string; model: string; cells: Partial<Record<BenchCategory, { passed: number; graded: number; errors: number }>>; passed: number; graded: number; latency: number[] }>();
    for (const score of results?.scores ?? []) {
      const key = modelKey(score.connectionId, score.model);
      const row = byModel.get(key) ?? { connectionId: score.connectionId, model: score.model, cells: {}, passed: 0, graded: 0, latency: [] };
      const graded = score.passed + score.failed;
      row.cells[score.category] = { passed: score.passed, graded, errors: score.errors };
      row.passed += score.passed; row.graded += graded;
      if (score.latencyMs !== undefined) row.latency.push(score.latencyMs);
      byModel.set(key, row);
    }
    return [...byModel.values()].sort((a, b) => (percent(b.passed, b.graded) ?? -1) - (percent(a.passed, a.graded) ?? -1));
  }, [results]);

  const running = !!job?.running;
  return <div className="np-page">
    <div className="np-page-heading">
      <div>
        <span className="np-eyebrow">BENCH</span>
        <h1>Measure your free models.</h1>
        <p>Graded questions from published datasets, sent to the models you choose. The Free Router uses these results to pick the best model for each kind of message.</p>
      </div>
      <button className="np-button ghost" disabled={running || !rows.length} onClick={() => void clear()}><Trash2 size={14} />Clear results</button>
    </div>
    {error && <p className="np-error" role="alert">{error}</p>}

    <section className="np-panel np-bench-setup" aria-label="Bench setup">
      <div className="np-section-title"><div><h2>Models</h2><p>Only local, listed-at-$0, or confirmed free-plan account models are offered, so Bench stays inside the Free only policy.</p></div>
        {models.length > 0 && <button className="np-button small ghost" disabled={running} onClick={() => setSelected(selected.size === models.length ? new Set() : new Set(models.map(m => modelKey(m.connectionId, m.model))))}>{selected.size === models.length ? 'Select none' : 'Select all'}</button>}
      </div>
      {models.length ? <div className="np-bench-models">{models.map(m => {
        const key = modelKey(m.connectionId, m.model);
        return <label key={key} className="np-check"><input type="checkbox" disabled={running} checked={selected.has(key)} onChange={() => toggle(key)} /><span><strong>{m.displayName ?? m.model}</strong>{nameOf(m.connectionId)}</span></label>;
      })}</div> : <p className="np-bench-note">No free models yet. Connect a provider with a free-plan key, OpenRouter with a $0 model, or a model on this machine, then refresh its catalog in Models.</p>}

      <div className="np-section-title np-bench-subtitle"><div><h2>Questions</h2><p>{suite ? `Suite from ${suite.generatedAt}; every answer is checked automatically, never by another model.` : 'Loading the suite.'}</p></div></div>
      <div className="np-bench-categories">{CATEGORIES.map(category => {
        const info = suite?.categories.find(c => c.category === category);
        return <label key={category} className="np-check"><input type="checkbox" disabled={running} checked={categories.has(category)} onChange={() => toggleCategory(category)} />
          <span><strong>{CATEGORY_LABEL[category]}</strong>{info ? <a href={info.url} target="_blank" rel="noopener noreferrer">{info.dataset}</a> : ''}{info ? ` · ${info.license}` : ''}</span></label>;
      })}</div>
      <label className="np-field np-bench-count"><span>Questions per category</span>
        <select aria-label="Questions per category" disabled={running} value={perCategory} onChange={e => setPerCategory(Number(e.target.value))}>{[1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}</select>
      </label>

      <div className="np-bench-plan" role="status">
        <span>{chosen.length ? `${(chosen.length * perModel).toLocaleString()} request${chosen.length * perModel === 1 ? '' : 's'}: ${perModel} per model.` : 'Choose at least one model.'}</span>
        {plan.map(({ id, requests, limit }) => <span key={id} className={limit && requests > limit.requests ? 'np-bench-warning' : undefined}>{nameOf(id)}: {requests} request{requests === 1 ? '' : 's'}{limit ? `; ${limit.note}${requests > limit.requests ? '. Bench stops that account when the limit is reached; lower the count or choose fewer models' : ''}` : ''}.</span>)}
        <span>Requests are spaced to stay under each provider's per-minute limit, so larger runs take a while. Keep this page open until it finishes.</span>
      </div>
      <div className="np-bench-actions">
        {running
          ? <button className="np-button" onClick={() => job && void cancelRun(job.runId)}><Square size={13} />Stop</button>
          : <button className="np-button primary" disabled={!chosen.length || !categories.size || !pool.route} onClick={() => void start()}><Play size={13} />Run Bench</button>}
      </div>
      {job && <div className="np-bench-progress" aria-label="Bench progress">
        <div className="np-bench-bar"><i style={{ width: `${job.total ? Math.round(job.done / job.total * 100) : 0}%` }} /></div>
        <p>{job.done} of {job.total}{job.skipped ? ` · ${job.skipped} skipped` : ''} · {job.running ? job.status : job.outcome}</p>
      </div>}
    </section>

    <section className="np-panel np-bench-results" aria-label="Bench results">
      <div className="np-section-title"><div><h2>Results</h2><p>Passed out of graded answers. Failed requests (outages, time-outs) are shown separately and never count against a model; rate-limited requests are skipped.</p></div></div>
      {rows.length ? <div className="np-bench-table-wrap"><table className="np-bench-table">
        <thead><tr><th scope="col">Model</th>{CATEGORIES.map(c => <th scope="col" key={c}>{CATEGORY_LABEL[c]}</th>)}<th scope="col">Overall</th><th scope="col">Mean time</th></tr></thead>
        <tbody>{rows.map(row => <tr key={modelKey(row.connectionId, row.model)}>
          <th scope="row"><strong>{row.model}</strong><small>{nameOf(row.connectionId)}</small></th>
          {CATEGORIES.map(c => { const cell = row.cells[c]; const rate = cell ? percent(cell.passed, cell.graded) : undefined;
            return <td key={c} className={rate === undefined ? 'np-bench-empty' : rate >= 70 ? 'np-bench-good' : rate < 40 ? 'np-bench-poor' : undefined}>
              {cell ? <>{cell.passed}/{cell.graded}{cell.errors ? <small>{cell.errors} failed</small> : null}</> : '—'}</td>; })}
          <td>{percent(row.passed, row.graded) !== undefined ? `${percent(row.passed, row.graded)}%` : '—'}</td>
          <td>{formatMs(row.latency.length ? Math.round(row.latency.reduce((a, b) => a + b, 0) / row.latency.length) : undefined)}</td>
        </tr>)}</tbody>
      </table></div> : <div className="np-empty-panel"><FlaskConical size={26} /><h3>No results yet.</h3><p>Run Bench on a few free models. Three questions per category is enough to start; the router trusts results more as they add up.</p></div>}
      {live.length > 0 && <details className="np-tool-detail"><summary>This run's answers ({live.length})</summary><ol className="np-bench-live">{live.map((r, i) => <li key={`${r.at}-${i}`} className={`np-bench-${r.status}`}><strong>{r.model}</strong> · {CATEGORY_LABEL[r.category]} · {r.itemId} · {r.status}{r.detail ? `: ${r.detail}` : ''}</li>)}</ol></details>}
    </section>

    {specialists && <section className="np-panel np-bench-results" aria-label="Specialists">
      <div className="np-section-title"><div><h2>Specialists</h2><p>Who the Free Agent and Free Router ask first for each kind of task, from your Bench results, model size, and recent reliability. More Bench results make this more accurate.</p></div></div>
      <div className="np-bench-table-wrap"><table className="np-bench-table np-specialists">
        <thead><tr><th scope="col">Task</th><th scope="col">First choice</th><th scope="col">Why</th><th scope="col">Next</th></tr></thead>
        <tbody>{(Object.keys(KIND_LABEL) as TaskKind[]).map(kind => { const [first, ...rest] = specialists[kind] ?? [];
          return <tr key={kind}>
            <th scope="row">{KIND_LABEL[kind]}</th>
            <td>{first ? <><strong>{first.displayName ?? first.model}</strong><small>{nameOf(first.connectionId)}</small></> : '—'}</td>
            <td className="np-specialist-why">{first?.why.length ? first.why.join(', ') : '—'}</td>
            <td>{rest.length ? rest.map(entry => entry.displayName ?? entry.model).join(', ') : '—'}</td>
          </tr>; })}</tbody>
      </table></div>
    </section>}
  </div>;
}
