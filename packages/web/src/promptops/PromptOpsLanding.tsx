import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, List, Zap, ArrowRight } from 'lucide-react';

const cards = [
  {
    to: '/dashboard',
    icon: BarChart3,
    label: 'Metrics Dashboard',
    description: 'Latency percentiles, token usage, cost per 100 chats, error rates, and model performance at a glance.',
    stat1: { v: '13', l: 'KPIs tracked' },
    stat2: { v: '8', l: 'Charts' },
    cta: 'View Dashboard',
  },
  {
    to: '/events',
    icon: List,
    label: 'All Events',
    description: 'Full log of every LLM interaction — latency, tokens, risk score, cost estimate, safety flags.',
    stat1: { v: '19', l: 'Columns' },
    stat2: { v: '∞', l: 'History' },
    cta: 'Browse Events',
  },
  {
    to: '/benchmark',
    icon: Zap,
    label: 'Performance Benchmark',
    description: 'Measure TTFT and latency across your local Ollama models. p50/p95 stats, quick comparison runs.',
    stat1: { v: '3', l: 'Test prompts' },
    stat2: { v: 'p95', l: 'Percentiles' },
    cta: 'Run Benchmark',
  },
];

const PromptOpsLanding: React.FC = () => (
  <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>

    {/* Top bar */}
    <div className="px-8 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2 text-[12px] text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          <ArrowLeft size={13} />
          Back to chat
        </Link>
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: 'rgba(244,63,94,.12)', border: '1px solid rgba(244,63,94,.22)' }}
          >
            <span className="text-[9px] font-bold text-nerdplexity-400">N</span>
          </div>
          <span className="text-[12px] font-semibold text-neutral-400">PromptOps</span>
        </div>
      </div>
    </div>

    {/* Hero */}
    <div className="max-w-5xl mx-auto px-8 pt-16 pb-12">
      <div className="mb-2">
        <span
          className="inline-block text-[10px] font-semibold uppercase tracking-[.12em] px-2.5 py-1 rounded-full"
          style={{ background: 'rgba(244,63,94,.1)', color: '#fb7185', border: '1px solid rgba(244,63,94,.2)' }}
        >
          Analytics
        </span>
      </div>
      <h1
        className="text-[32px] font-bold tracking-tight mb-3 mt-3"
        style={{ letterSpacing: '-0.02em' }}
      >
        PromptOps
      </h1>
      <p className="text-[14px] text-neutral-500 max-w-lg leading-relaxed">
        Monitor, debug, and optimize every AI interaction. Full observability for your local-first setup.
      </p>
    </div>

    {/* Cards */}
    <div className="max-w-5xl mx-auto px-8 pb-20">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {cards.map(({ to, icon: Icon, label, description, stat1, stat2, cta }) => (
          <Link
            key={to}
            to={to}
            className="group flex flex-col p-6 rounded-2xl transition-all duration-200"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(244,63,94,.25)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(244,63,94,.08), 0 8px 32px rgba(0,0,0,.4)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
            }}
          >
            {/* Icon */}
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center mb-5"
              style={{ background: 'rgba(244,63,94,.1)', border: '1px solid rgba(244,63,94,.18)' }}
            >
              <Icon size={17} className="text-nerdplexity-400" />
            </div>

            {/* Label + description */}
            <h2 className="text-[15px] font-semibold text-neutral-100 mb-2 tracking-tight">{label}</h2>
            <p className="text-[12px] text-neutral-500 leading-relaxed flex-1">{description}</p>

            {/* Stats */}
            <div className="flex gap-4 mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <div>
                <div className="text-[18px] font-bold text-nerdplexity-400 leading-none">{stat1.v}</div>
                <div className="text-[10px] text-neutral-600 mt-1 uppercase tracking-wide">{stat1.l}</div>
              </div>
              <div>
                <div className="text-[18px] font-bold text-nerdplexity-400 leading-none">{stat2.v}</div>
                <div className="text-[10px] text-neutral-600 mt-1 uppercase tracking-wide">{stat2.l}</div>
              </div>
            </div>

            {/* CTA */}
            <div className="flex items-center gap-1.5 mt-4 text-[12px] text-neutral-600 group-hover:text-nerdplexity-400 transition-colors">
              <span>{cta}</span>
              <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>

      {/* Feature grid */}
      <div className="mt-16 pt-10" style={{ borderTop: '1px solid var(--border)' }}>
        <h3 className="text-[10px] font-semibold uppercase tracking-[.12em] text-neutral-700 mb-8">What you can monitor</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { tag: 'PERF', title: 'Performance', desc: 'Latency percentiles, TTFT, throughput, and SLA breach detection.' },
            { tag: 'COST', title: 'Cost', desc: 'Token consumption, estimated cost per 100 chats, and budget tracking.' },
            { tag: 'QUAL', title: 'Quality', desc: 'Error rates, refusal rates, judge scores, and groundedness metrics.' },
          ].map(({ tag, title, desc }) => (
            <div key={tag} className="flex gap-4">
              <div
                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-bold text-nerdplexity-500"
                style={{ background: 'rgba(244,63,94,.07)', border: '1px solid rgba(244,63,94,.12)' }}
              >
                {tag}
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-neutral-200 mb-1">{title}</h4>
                <p className="text-[11px] text-neutral-600 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default PromptOpsLanding;
