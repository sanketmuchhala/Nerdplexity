import { useEffect, useMemo, useState } from "react";
import { getEvents } from "./logger";
// import { summarize } from "./kpis";
import { Table } from "./components/Cards";
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

export default function PromptAnalyticsDashboard() {
  const [rows, setRows] = useState<any[]>([]);
  // const [sum, setSum] = useState<any | null>(null);
  const [activeView, setActiveView] = useState<'dashboard' | 'events'>('dashboard');

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
      // setSum(summarize(r));
    })();
  }, []);

  const mainKpis = useMemo(() => {
    if (!rows.length) return [];
    
    const latencies = rows.map(e => Number(e?.timing?.latency_ms || 0)).filter(l => l > 0);
    // const ttfts = rows.map(e => Number(e?.timing?.ttft_ms || 0)).filter(t => t > 0);
    
    return [
      { label: "Total Calls", value: rows.length, unit: '' },
      { label: "Helpful Rate", value: Math.round(helpfulRate(rows) * 100), unit: '%' },
      { label: "Refusal Rate", value: Math.round(refusalRate(rows) * 100), unit: '%' },
      { label: "Error Rate", value: Math.round(errorRate(rows) * 100), unit: '%' },
      { label: "p50 Latency", value: Math.round(p50(latencies)), unit: 'ms' },
      { label: "p95 Latency", value: Math.round(p95(latencies)), unit: 'ms' },
      { label: "p99 Latency", value: Math.round(p99(latencies)), unit: 'ms' },
      { label: "Avg TTFT", value: Math.round(avgTTFT(rows)), unit: 'ms' },
      { label: "Avg Total Tokens", value: Math.round(avgTotalTokens(rows)), unit: '' },
      { label: "Context Bloat", value: Math.round(contextBloat(rows) * 100), unit: '%' },
      { label: "Cost/100 Chats", value: avgCostPer100(rows).toFixed(2), unit: '$' },
      { label: "Groundedness", value: Math.round(groundedness(rows) * 100), unit: '%' },
      { label: "SLA Breaches", value: slaBreaches(rows, 5000), unit: '' }
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

  const riskBands = useMemo(() => {
      const low = rows.filter(e => (e as any)._riskBand === "Low").length;
      const med = rows.filter(e => (e as any)._riskBand === "Medium").length;
      const high = rows.filter(e => (e as any)._riskBand === "High").length;
      return { low, med, high, total: rows.length };
  }, [rows]);

  const modelCompareData = useMemo(() => modelRollup(rows), [rows]);

  return (
    <div className="mx-auto max-w-screen-2xl p-6 bg-neutral-950 text-neutral-200 font-sans">
      <AnalyticsNav title="Legacy Analytics View" />

      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-nerdplexity-600 nerdplexity-glow-strong flex items-center justify-center">
            <span className="text-white font-bold text-lg">LEGACY</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Legacy Analytics View</h1>
        </div>
        <p className="text-neutral-400">Original combined dashboard and events view</p>

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setActiveView('dashboard')}
            className={`px-4 py-2 rounded-lg transition-all text-sm font-medium ${
              activeView === 'dashboard'
                ? 'bg-nerdplexity-600 text-white nerdplexity-glow-strong'
                : 'text-neutral-300 hover:text-nerdplexity-300 hover:bg-neutral-800 hover:border-nerdplexity-600'
            }`}
          >
            Legacy Dashboard
          </button>
          <button
            onClick={() => setActiveView('events')}
            className={`px-4 py-2 rounded-lg transition-all text-sm font-medium ${
              activeView === 'events'
                ? 'bg-nerdplexity-600 text-white nerdplexity-glow-strong'
                : 'text-neutral-300 hover:text-nerdplexity-300 hover:bg-neutral-800 hover:border-nerdplexity-600'
            }`}
          >
            Legacy Events
          </button>
        </div>
      </header>

      {activeView === 'dashboard' ? (
        <div className="h-full overflow-y-auto">
          {/* Compact Analytics Grid - No Scroll */}
          <div className="grid grid-cols-6 grid-rows-5 gap-3 h-full">
            
            {/* Top Rows: Enhanced KPIs */}
            <div className="col-span-6 row-span-2">
              <div className="grid grid-cols-7 gap-2 h-full">
                {mainKpis.map(kpi => (
                  <div key={kpi.label} className="bg-neutral-900 border border-neutral-700 rounded-xl p-2 flex flex-col justify-center">
                    <div className="text-lg font-bold text-neutral-100">{kpi.value}{kpi.unit}</div>
                    <div className="text-xs text-neutral-400">{kpi.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Analytics Row: Charts */}
            <div className="col-span-6 row-span-1">
              <div className="grid grid-cols-6 gap-3 h-full">
                
                <div className="col-span-2">
                  <div className="bg-neutral-900 rounded-xl p-3 h-full">
                    <h3 className="text-sm font-semibold mb-2 text-neutral-100">Event Latency Timeline</h3>
                    <div style={{ height: 'calc(100% - 2rem)' }}>
                      <EventLatency rows={rows} />
                    </div>
                  </div>
                </div>

                <div className="col-span-1">
                  <BandBars rows={rows} />
                </div>

                <div className="col-span-2">
                  <SplitBars rows={rows} />
                </div>

                <div className="col-span-1">
                  <div className="bg-neutral-900 rounded-xl p-3 h-full">
                    <h3 className="text-sm font-semibold mb-2 text-neutral-100">Outcome Mix</h3>
                    <div style={{ height: 'calc(100% - 2rem)' }}>
                      <DoughnutChart labels={outcomes.labels} values={outcomes.values} />
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Performance & Context Row */}
            <div className="col-span-3 row-span-1">
              <div className="bg-neutral-900 rounded-xl p-3 h-full">
                <h3 className="text-sm font-semibold mb-2 text-neutral-100">Model Performance (Quality vs. Cost)</h3>
                <div style={{ height: 'calc(100% - 2rem)' }}>
                  <ScatterChart points={modelCompareData.map(r => ({ x: r.avg_cost, y: r.avg_pqs, r: Math.log(r.N + 1) * 4, label: r.model, series: r.model }))} seriesKey="series" />
                </div>
              </div>
            </div>

            <div className="col-span-2 row-span-1">
              <div className="bg-neutral-900 rounded-xl p-3 h-full">
                <h3 className="text-sm font-semibold mb-2 text-neutral-100">Context Bloat Trend</h3>
                <div style={{ height: 'calc(100% - 2rem)' }}>
                  <ContextBloat rows={rows} />
                </div>
              </div>
            </div>

            <div className="col-span-1 row-span-1">
              <div className="bg-neutral-900 rounded-xl p-3 h-full">
                <h3 className="text-sm font-semibold mb-2 text-neutral-100">Risk Bands</h3>
                <div className="grid grid-rows-3 gap-1 h-[calc(100%-2rem)] text-center">
                  <div className="flex flex-col justify-center">
                    <div className="text-lg font-bold text-green-400">{riskBands.low}</div>
                    <div className="text-xs text-neutral-400">Low</div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div className="text-lg font-bold text-yellow-400">{riskBands.med}</div>
                    <div className="text-xs text-neutral-400">Med</div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div className="text-lg font-bold text-red-400">{riskBands.high}</div>
                    <div className="text-xs text-neutral-400">High</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Row: System Metrics & Trends */}
            <div className="col-span-3 row-span-1">
              <div style={{ height: '100%' }}>
                <SystemMetrics />
              </div>
            </div>

            <div className="col-span-3 row-span-1">
              <div className="grid grid-cols-2 gap-3 h-full">
                <div className="bg-neutral-900 rounded-xl p-3">
                  <h3 className="text-sm font-semibold mb-2 text-neutral-100">Latency Trend</h3>
                  <div style={{ height: 'calc(100% - 2rem)' }}>
                    <LineChart labels={latSeries.labels} series={[{ label: "p50", data: latSeries.p50 }, { label: "p95", data: latSeries.p95 }]} />
                  </div>
                </div>
                <div className="bg-neutral-900 rounded-xl p-3">
                  <h3 className="text-sm font-semibold mb-2 text-neutral-100">Tokens by Day</h3>
                  <div style={{ height: 'calc(100% - 2rem)' }}>
                    <BarStack labels={tokenSeries.labels} stacks={[{ label: "Prompt", data: tokenSeries.prompt }, { label: "Output", data: tokenSeries.output }]} />
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : (
        /* Events View */
        <div className="p-4 bg-neutral-900 rounded-xl">
          <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
            <Table
              rows={rows}
              cols={[
                { key: "ts", label: "Time" },
                { key: "provider", label: "Provider" },
                { key: "model", label: "Model" },
                { key: "status", label: "Status", fmt: (_, r) => String(r?.result?.status || "ok") },
                { key: "latency", label: "Latency (ms)", fmt: (_, r) => String(r?.timing?.latency_ms || "") },
                { key: "tokens", label: "Tokens", fmt: (_, r) => String(r?.usage?.total_tokens || "") },
                { key: "risk", label: "Risk", fmt: (_, r) => String(r?._riskBand || "") },
                { key: "pqs", label: "PQS", fmt: (_, r) => r._pqs.toFixed(2) },
                { key: "cost", label: "Cost ($)", fmt: (_, r) => r._cost_est ? r._cost_est.toFixed(4) : '' },
                { key: "prompt_chars", label: "Prompt Chars", fmt: (_, r) => r.prompt?.prompt_chars || '' },
                { key: "user_rating", label: "User Rating", fmt: (_, r) => r.quality?.user_rating ? `${r.quality.user_rating}/5` : '-' },
                { key: "judge_score", label: "Judge Score", fmt: (_, r) => r.quality?.judge_score ? r.quality.judge_score.toFixed(2) : '-' },
                { key: "guard_triggered", label: "Guard Triggered", fmt: (_, r) => r.safety?.guard_triggered !== undefined ? (r.safety.guard_triggered ? 'Yes' : 'No') : '-' },
                { key: "pii_blocked", label: "PII Blocked", fmt: (_, r) => r.safety?.pii_blocked ? 'Yes' : '-' },
                { key: "task", label: "Task", fmt: (_, r) => r.business?.task || '-' },
                { key: "ttft_ms", label: "TTFT (ms)", fmt: (_, r) => r.timing?.ttft_ms ? String(r.timing.ttft_ms) : '-' },
                { key: "tokens_per_s", label: "Tokens/s", fmt: (_, r) => r.runtime?.tokens_per_s ? r.runtime.tokens_per_s.toFixed(1) : '-' },
                { key: "vram_mb_peak", label: "VRAM (MB)", fmt: (_, r) => r.hardware?.vram_mb_peak ? String(r.hardware.vram_mb_peak) : '-' },
                { key: "gpu_util_pct", label: "GPU Util (%)", fmt: (_, r) => r.hardware?.gpu_util_pct ? `${r.hardware.gpu_util_pct}%` : '-' },
              ]}
            />
          </div>
        </div>
      )}

      
    </div>
  );
}
