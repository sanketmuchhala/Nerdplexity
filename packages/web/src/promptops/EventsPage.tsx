import { useEffect, useState } from "react";
import { getEvents } from "./logger";
import { Table } from "./components/Cards";
import { hallucinationRisk } from "./hallucination";
import { estimateCost } from "./pricing";
import AnalyticsNav from "./components/AnalyticsNav";

export default function EventsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
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
      setLoading(false);
    })();
  }, []);

  const columns = [
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
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-screen-2xl p-6 bg-neutral-950 text-neutral-200 font-sans">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-nerdplexity-400 nerdplexity-glow"></div>
          <span className="ml-3 text-neutral-400">Loading events...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl p-6 bg-neutral-950 text-neutral-200 font-sans">
      {/* Navigation */}
      <AnalyticsNav title="All Events" />

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">All Events</h1>
        <p className="text-neutral-400 text-lg">Detailed log of all LLM interactions and their metrics</p>

        {/* Summary Stats */}
        <div className="flex gap-6 mt-4">
          <div className="text-sm">
            <span className="text-neutral-400">Total Events:</span>{' '}
            <span className="text-nerdplexity-300 font-semibold">{rows.length}</span>
          </div>
          <div className="text-sm">
            <span className="text-neutral-400">Success Rate:</span>{' '}
            <span className="text-nerdplexity-300 font-semibold">
              {rows.length ? Math.round(((rows.filter(e => e.result?.status !== "error").length) / rows.length) * 100) : 0}%
            </span>
          </div>
          <div className="text-sm">
            <span className="text-neutral-400">Avg Latency:</span>{' '}
            <span className="text-nerdplexity-300 font-semibold">
              {rows.length ? Math.round(rows.reduce((sum, e) => sum + (Number(e.timing?.latency_ms) || 0), 0) / rows.length) : 0}ms
            </span>
          </div>
        </div>
      </header>

      {/* Events Table */}
      <div className="bg-neutral-900 rounded-xl border border-neutral-700 nerdplexity-border overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-nerdplexity-300">Event Details</h2>
            <div className="text-sm text-neutral-400">
              Showing all {rows.length} events
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="text-center py-12">
              <h3 className="text-lg font-medium text-neutral-300 mb-2">No Events Found</h3>
              <p className="text-neutral-500">
                Start using your AI assistant to see analytics data here.
              </p>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-300px)] overflow-y-auto border border-neutral-800 rounded-lg">
              <Table rows={rows} cols={columns} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}