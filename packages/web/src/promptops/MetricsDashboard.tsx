import { useEffect, useMemo, useState } from "react";
import { getEvents } from "./logger";
import { LineChart, BarStack, DoughnutChart, ScatterChart } from "./components/Charts";
import { byDay, sumByDay, modelRollup } from "./analytics";
import { hallucinationRisk } from "./hallucination";
import { estimateCost } from "./pricing";
import EventLatency from "./components/EventLatency";
import SystemMetrics from "./components/SystemMetrics";
import ContextBloat from "./components/ContextBloat";
import BandBars from "./components/BandBars";
import SplitBars from "./components/SplitBars";
import AnalyticsNav from "./components/AnalyticsNav";
import {
  p50, p95, p99, groundedness, contextBloat, errorRate, refusalRate,
  helpfulRate, slaBreaches, avgCostPer100, avgTTFT, avgTotalTokens
} from "./metrics";

import React from "react";

interface KPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  subtitle?: string;
}

const trends = {
  up:      { bg: 'rgba(59,130,246,.1)', color: '#8fa5ff', label: '↑' },
  down:    { bg: 'rgba(239,68,68,.1)', color: '#fca5a5', label: '↓' },
  neutral: { bg: 'var(--s4)', color: 'var(--t3)', label: '—' },
};

const KPICard: React.FC<KPICardProps> = ({ label, value, unit = '', trend, subtitle }) => (
  <div
    className="rounded-xl p-4 transition-all duration-150"
    style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,.25)'; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--b)'; }}
  >
    <div className="flex items-center justify-between mb-2.5">
      <span className="t-label">{label}</span>
      {trend && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
          style={{ background: trends[trend].bg, color: trends[trend].color }}
        >
          {trends[trend].label}
        </span>
      )}
    </div>
    <div className="flex items-baseline gap-1">
      <span className="text-2xl font-bold leading-none" style={{ color: 'var(--blue-bright)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
        {value}
      </span>
      {unit && <span className="text-sm" style={{ color: 'var(--t3)' }}>{unit}</span>}
    </div>
    {subtitle && <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--t4)' }}>{subtitle}</p>}
  </div>
);

export default function MetricsDashboard() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const r = await getEvents();
      for (const e of r) {
        const h = hallucinationRisk(e);
        (e as any)._riskScore = h.score;
        (e as any)._riskBand = h.band;
        (e as any)._cost_est = estimateCost(e.provider || '', e.model || '', e.usage?.prompt_tokens, e.usage?.completion_tokens, e.usage?.total_tokens);
        const helpful = ((e.quality?.user_rating ?? 0) >= 4) || ((e.quality?.judge_score ?? 0) >= 0.75) ? 1 : 0;
        const refusal = e.result?.status === "refusal" ? 1 : 0;
        const p95Target = 5000;
        const lat = Number(e.timing?.latency_ms || 0);
        const latency_norm = 1 - Math.min(lat / p95Target, 1);
        const pt = Number(e.usage?.prompt_tokens || 0);
        const tt = Number(e.usage?.total_tokens || 0);
        const cost_eff = tt ? 1 - Math.min(pt / tt, 1) : 0.5;
        (e as any)._pqs = 0.35 * helpful + 0.15 * (1 - refusal) + 0.15 * latency_norm + 0.15 * cost_eff + 0.20 * (e.quality?.judge_score || 0);
      }
      setRows(r);
    })();
  }, []);

  const mainKpis = useMemo(() => {
    if (!rows.length) return [];

    const latencies = rows.map(e => Number(e?.timing?.latency_ms || 0)).filter(l => l > 0);

    return [
      {
        label: "Total Calls",
        value: rows.length,
        trend: 'up' as const,
        subtitle: "All LLM interactions"
      },
      {
        label: "Helpful Rate",
        value: Math.round(helpfulRate(rows) * 100),
        unit: '%',
        trend: 'up' as const,
        subtitle: "Quality responses"
      },
      {
        label: "Refusal Rate",
        value: Math.round(refusalRate(rows) * 100),
        unit: '%',
        trend: 'down' as const,
        subtitle: "Requests declined"
      },
      {
        label: "Error Rate",
        value: Math.round(errorRate(rows) * 100),
        unit: '%',
        trend: 'down' as const,
        subtitle: "Failed requests"
      },
      {
        label: "p50 Latency",
        value: Math.round(p50(latencies)),
        unit: 'ms',
        trend: 'neutral' as const,
        subtitle: "Median response time"
      },
      {
        label: "p95 Latency",
        value: Math.round(p95(latencies)),
        unit: 'ms',
        trend: 'neutral' as const,
        subtitle: "95th percentile"
      },
      {
        label: "p99 Latency",
        value: Math.round(p99(latencies)),
        unit: 'ms',
        trend: 'neutral' as const,
        subtitle: "99th percentile"
      },
      {
        label: "Avg TTFT",
        value: Math.round(avgTTFT(rows)),
        unit: 'ms',
        trend: 'down' as const,
        subtitle: "Time to first token"
      },
      {
        label: "Avg Total Tokens",
        value: Math.round(avgTotalTokens(rows)),
        trend: 'neutral' as const,
        subtitle: "Input + output tokens"
      },
      {
        label: "Context Bloat",
        value: Math.round(contextBloat(rows) * 100),
        unit: '%',
        trend: 'down' as const,
        subtitle: "Inefficient token usage"
      },
      {
        label: "Cost/100 Chats",
        value: avgCostPer100(rows).toFixed(2),
        unit: '$',
        trend: 'down' as const,
        subtitle: "Cost per 100 requests"
      },
      {
        label: "Groundedness",
        value: Math.round(groundedness(rows) * 100),
        unit: '%',
        trend: 'up' as const,
        subtitle: "Factual accuracy"
      },
      {
        label: "SLA Breaches",
        value: slaBreaches(rows, 5000),
        trend: 'down' as const,
        subtitle: "Responses > 5s"
      }
    ];
  }, [rows]);

  const latSeries = useMemo(() => {
    const d = byDay(rows, (e: any) => Number((e.timing?.latency_ms as string) || 0));
    return { labels: d.map(x => x.day as string), p50: d.map(x => x.p50), p95: d.map(x => x.p95) };
  }, [rows]);

  const tokenSeries = useMemo(() => {
    const dPrompt = sumByDay(rows, (e) => Number(e.usage?.prompt_tokens || 0));
    const dOut = sumByDay(rows, (e) => Number(e.usage?.completion_tokens || 0));
    const idx = Array.from(new Set([...dPrompt.map(x => x.day), ...dOut.map(x => x.day)])).sort();
    const mapP = Object.fromEntries(dPrompt.map(x => [x.day, x.total]));
    const mapO = Object.fromEntries(dOut.map(x => [x.day, x.total]));
    return { labels: idx, prompt: idx.map(day => mapP[day] || 0), output: idx.map(day => mapO[day] || 0) };
  }, [rows]);

  const outcomes = useMemo(() => {
    const ok = rows.filter(e => e.result?.status !== "error" && e.result?.status !== "refusal").length;
    const ref = rows.filter(e => e.result?.status === "refusal").length;
    const err = rows.filter(e => e.result?.status === "error").length;
    return { labels: ["OK", "Refusal", "Error"], values: [ok, ref, err] };
  }, [rows]);

  const modelCompareData = useMemo(() => modelRollup(rows), [rows]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--t1)', fontFamily: "'DM Sans', sans-serif" }}><div className="max-w-6xl mx-auto px-6 py-6">
      <AnalyticsNav title="Metrics Dashboard" />

      <header className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.025em', color: 'var(--t1)' }}>
          Analytics
        </h1>
        <p className="text-sm" style={{ color: 'var(--t3)' }}>Performance metrics and insights for your AI interactions</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {mainKpis.map((kpi, index) => (
          <KPICard
            key={index}
            label={kpi.label}
            value={kpi.value}
            unit={kpi.unit}
            trend={kpi.trend}
            subtitle={kpi.subtitle}
          />
        ))}
      </div>

      {/* Main Analytics Grid - Professional Layout */}
      <div className="space-y-8">

        {/* Hero Row - Key Performance Overview */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Primary Chart - Event Latency (spans 3 columns) */}
          <div className="xl:col-span-3">
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
              <div className="p-6 border-b border-neutral-800">
                <h3 className="text-lg font-semibold text-nerdplexity-300">Event Latency Timeline</h3>
                <p className="text-sm text-neutral-500 mt-1">Real-time performance monitoring</p>
              </div>
              <div className="p-6">
                <div className="h-[320px]">
                  <EventLatency rows={rows} />
                </div>
              </div>
            </div>
          </div>

          {/* Risk Distribution (1 column) */}
          <div className="xl:col-span-1">
            <div className="rounded-xl h-full overflow-hidden" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
              <div className="p-6 border-b border-neutral-800">
                <h3 className="text-lg font-semibold text-nerdplexity-300">Risk Distribution</h3>
                <p className="text-sm text-neutral-500 mt-1">Security assessment</p>
              </div>
              <div className="p-6">
                <div className="h-[320px]">
                  <BandBars rows={rows} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Secondary Row - Analysis & Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* Model Performance */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">Model Performance</h3>
              <p className="text-xs text-neutral-500 mt-1">Quality vs Cost analysis</p>
            </div>
            <div className="p-3">
              <div className="h-[200px] overflow-hidden">
                <ScatterChart
                  points={modelCompareData.map(r => ({
                    x: r.avg_cost,
                    y: r.avg_pqs,
                    r: Math.log(r.N + 1) * 4,
                    label: r.model,
                    series: r.model
                  }))}
                  seriesKey="series"
                />
              </div>
            </div>
          </div>

          {/* Request Outcomes */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">Request Outcomes</h3>
              <p className="text-xs text-neutral-500 mt-1">Success & failure rates</p>
            </div>
            <div className="p-3">
              <div className="h-[200px] overflow-hidden">
                <DoughnutChart labels={outcomes.labels} values={outcomes.values} />
              </div>
            </div>
          </div>

          {/* Context Efficiency */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">Context Efficiency</h3>
              <p className="text-xs text-neutral-500 mt-1">Token usage optimization</p>
            </div>
            <div className="p-3">
              <div className="h-[200px] overflow-hidden">
                <ContextBloat rows={rows} />
              </div>
            </div>
          </div>
        </div>

        {/* Tertiary Row - System Metrics & Trends */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* System Health */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">System Health</h3>
              <p className="text-xs text-neutral-500 mt-1">Resource utilization</p>
            </div>
            <div className="p-3">
              <div className="h-[200px] overflow-hidden">
                <SystemMetrics />
              </div>
            </div>
          </div>

          {/* Latency Trends */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">Latency Trends</h3>
              <p className="text-xs text-neutral-500 mt-1">Response time patterns</p>
            </div>
            <div className="p-3">
              <div className="h-[200px] overflow-hidden">
                <LineChart
                  labels={latSeries.labels}
                  series={[
                    { label: "p50", data: latSeries.p50 },
                    { label: "p95", data: latSeries.p95 }
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Token Usage */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">Token Usage</h3>
              <p className="text-xs text-neutral-500 mt-1">Daily consumption trends</p>
            </div>
            <div className="p-3">
              <div className="h-[200px] overflow-hidden">
                <BarStack
                  labels={tokenSeries.labels}
                  stacks={[
                    { label: "Prompt", data: tokenSeries.prompt },
                    { label: "Output", data: tokenSeries.output }
                  ]}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row - Performance Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Performance Split */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">Performance Breakdown</h3>
              <p className="text-xs text-neutral-500 mt-1">Detailed performance analysis</p>
            </div>
            <div className="p-3">
              <div className="h-[200px] overflow-hidden">
                <SplitBars rows={rows} />
              </div>
            </div>
          </div>

          {/* Future Insights Placeholder */}
          <div className="rounded-xl overflow-hidden max-h-[350px]" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
            <div className="p-3 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-nerdplexity-300">Advanced Analytics</h3>
              <p className="text-xs text-neutral-500 mt-1">Coming soon</p>
            </div>
            <div className="p-3 flex items-center justify-center h-[200px]">
              <div className="text-center text-neutral-500">
                <div className="w-12 h-12 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl text-nerdplexity-400 font-bold">AI</span>
                </div>
                <p className="text-base font-medium style-removed mb-1">More Insights Coming</p>
                <p className="text-xs text-neutral-600">Advanced ML-powered analytics</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
