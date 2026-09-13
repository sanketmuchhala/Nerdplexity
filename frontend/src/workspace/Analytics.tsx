import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { Activity, BarChart3, Clock3, MessageSquare, Wrench } from 'lucide-react';
import { db, type Conversation, type RunRecord } from '../lib/db';
import { deriveRunAnalytics } from '../lib/runAnalytics';

const duration = (ms?: number) => ms === undefined ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
const percent = (value?: number) => value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
const money = (value: number) => value === 0 ? '$0' : value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;
const dayLabel = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function Analytics() {
  const [data, setData] = useState<{ runs: RunRecord[]; conversations: Conversation[] }>({ runs: [], conversations: [] });
  const [error, setError] = useState('');
  useEffect(() => {
    const subscription = liveQuery(async () => ({ runs: await db.runs.toArray(), conversations: await db.conversations.toArray() })).subscribe({
      next: value => { setData(value); setError(''); },
      error: () => setError('Unable to calculate analytics. Check browser storage.'),
    });
    return () => subscription.unsubscribe();
  }, []);
  const analytics = useMemo(() => deriveRunAnalytics(data.runs, data.conversations), [data]);
  const maxDaily = Math.max(1, ...analytics.days.map(day => day.runs));
  return <div className="np-page np-analytics-page">
    <div className="np-page-heading"><div><span className="np-eyebrow">ANALYTICS</span><h1>Your model workbench, measured.</h1><p>Derived locally from saved run outcomes. Missing provider data stays missing.</p></div><BarChart3 size={25}/></div>
    {error && <p className="np-error" role="alert">{error}</p>}
    <section className="np-analytics-cards" aria-label="Run summary">
      <article><Activity size={16}/><span>Runs</span><strong>{analytics.total}</strong><small>{analytics.completed} completed · {analytics.failed} failed · {analytics.stopped} stopped</small></article>
      <article><Clock3 size={16}/><span>Median model time</span><strong>{duration(analytics.p50ProviderMs)}</strong><small>P95 {duration(analytics.p95ProviderMs)} · queue excluded</small></article>
      <article><MessageSquare size={16}/><span>Median first text</span><strong>{duration(analytics.p50TtftMs)}</strong><small>{analytics.tokensPerSecond === undefined ? 'Generation rate unavailable' : `${analytics.tokensPerSecond.toFixed(1)} tokens/s average on valid plain runs`}</small></article>
      <article><Wrench size={16}/><span>Tool runs</span><strong>{analytics.toolRuns}</strong><small>{percent(analytics.completionRate)} terminal completion rate</small></article>
    </section>
    {!analytics.total ? <div className="np-empty-panel np-empty-tall"><BarChart3 size={30}/><h3>No run data yet.</h3><p>Analytics will update as soon as a run is saved.</p></div> : <>
      <section className="np-analytics-grid">
        <article className="np-panel"><div className="np-section-title"><div><h2>Recent volume</h2><p>Saved runs by day and terminal outcome.</p></div></div><div className="np-day-chart">{analytics.days.slice(-14).map(day => <div className="np-day-row" key={day.day}><time dateTime={day.day}>{dayLabel(day.day)}</time><div><i style={{ width: `${(day.runs / maxDaily) * 100}%` }}/></div><strong>{day.runs}</strong><small>{day.completed} done · {day.failed} failed · {day.stopped} stopped</small></div>)}</div></article>
        <article className="np-panel"><div className="np-section-title"><div><h2>Measured coverage</h2><p>The denominator is shown so gaps stay visible.</p></div></div><dl className="np-coverage"><div><dt>Provider-reported usage</dt><dd>{percent(analytics.usageCoverage)}</dd></div><div><dt>Catalog-price coverage</dt><dd>{percent(analytics.costCoverage)}</dd></div><div><dt>Reported tokens</dt><dd>{analytics.reportedTokens.toLocaleString()}</dd></div><div><dt>Estimated hosted cost</dt><dd>{analytics.costCoverage > 0 ? money(analytics.estimatedCostUsd) : '—'}</dd></div><div><dt>Average context utilization</dt><dd>{percent(analytics.contextUtilization)}</dd></div></dl><p className="np-metric-note">Cost is an estimate from the immutable catalog price captured before each run. It excludes provider discounts, caching, request fees, taxes, and runs without a validated price snapshot.</p></article>
      </section>
      <section className="np-panel np-analytics-models"><div className="np-section-title"><div><h2>Models</h2><p>Usage and outcomes from canonical run records.</p></div></div><div className="np-metric-table" role="table" aria-label="Model run metrics"><div className="header" role="row"><span>Model</span><span>Runs</span><span>Complete</span><span>Reported tokens</span><span>Estimated cost</span></div>{analytics.models.map(model => <div role="row" key={model.key}><span><strong>{model.model}</strong><small>{model.provider}</small></span><span>{model.runs}</span><span>{model.completed}</span><span>{model.reportedTokens.toLocaleString()}</span><span>{model.pricedRuns ? money(model.estimatedCostUsd) : '—'}</span></div>)}</div></section>
      <section className="np-panel np-feedback-panel"><div className="np-section-title"><div><h2>Explicit feedback</h2><p>Only ratings you selected on assistant answers. Nerdplexity does not invent a quality score.</p></div></div><div><span><strong>{analytics.feedback.helpful}</strong> Helpful</span><span><strong>{analytics.feedback.unhelpful}</strong> Unhelpful</span><span><strong>{analytics.feedback.unrated}</strong> Unrated completed runs</span></div></section>
    </>}
  </div>;
}
