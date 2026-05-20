import _React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, List, Zap, ArrowRight } from 'lucide-react';

const cards = [
  {
    to: '/dashboard',
    icon: BarChart3,
    label: 'Metrics Dashboard',
    desc: 'Latency percentiles, token usage, cost, error rates, and model quality at a glance.',
    stats: [{ v: '13', l: 'KPIs' }, { v: '8', l: 'Charts' }],
    cta: 'Open Dashboard',
  },
  {
    to: '/events',
    icon: List,
    label: 'All Events',
    desc: 'Full log of every LLM call — latency, tokens, risk score, safety flags, cost.',
    stats: [{ v: '19', l: 'Columns' }, { v: '∞', l: 'History' }],
    cta: 'Browse Events',
  },
  {
    to: '/benchmark',
    icon: Zap,
    label: 'Performance Benchmark',
    desc: 'Measure TTFT and latency for local Ollama models. Get p50/p95 statistics.',
    stats: [{ v: '3', l: 'Prompts' }, { v: 'p95', l: 'Stats' }],
    cta: 'Run Benchmark',
  },
];

export default function PromptOpsLanding() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--t1)' }}>

      {/* Top bar */}
      <div className="px-8 py-4" style={{ borderBottom: '1px solid var(--b)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link
            to="/app"
            className="flex items-center gap-2 text-xs transition-colors"
            style={{ color: 'var(--t3)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t1)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t3)'}
          >
            <ArrowLeft size={13} />
            Back to chat
          </Link>
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--t3)', fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '0.08em' }}
          >
            PROMPTOPS
          </span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8">
        {/* Hero */}
        <div className="pt-14 pb-12">
          <div
            className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full mb-6"
            style={{
              background: 'rgba(78,107,255,.1)',
              border: '1px solid rgba(78,107,255,.25)',
              color: '#8fa5ff',
              fontWeight: 500,
            }}
          >
            Analytics Suite
          </div>
          <h1
            className="text-3xl font-bold mb-3"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.025em', color: 'var(--t1)' }}
          >
            PromptOps
          </h1>
          <p className="text-sm max-w-lg leading-relaxed" style={{ color: 'var(--t2)' }}>
            Full observability over every AI interaction. Monitor performance, debug issues,
            and optimize costs — all from your local data.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pb-16">
          {cards.map(({ to, icon: Icon, label, desc, stats, cta }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-col p-6 rounded-2xl transition-all duration-200"
              style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'rgba(78,107,255,.3)';
                el.style.boxShadow = '0 0 0 1px rgba(78,107,255,.08), 0 8px 32px rgba(0,0,0,.5)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--b)';
                el.style.boxShadow = 'none';
              }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-5"
                style={{ background: 'rgba(78,107,255,.1)', border: '1px solid rgba(78,107,255,.2)' }}
              >
                <Icon size={18} style={{ color: 'var(--blue-hi)' }} />
              </div>

              <h2
                className="text-base font-semibold mb-2"
                style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}
              >
                {label}
              </h2>
              <p className="text-xs leading-relaxed flex-1" style={{ color: 'var(--t3)' }}>
                {desc}
              </p>

              <div className="flex gap-5 mt-5 pt-4" style={{ borderTop: '1px solid var(--b)' }}>
                {stats.map(s => (
                  <div key={s.l}>
                    <div className="text-xl font-bold leading-none" style={{ color: 'var(--blue-hi)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                      {s.v}
                    </div>
                    <div className="t-label mt-1">{s.l}</div>
                  </div>
                ))}
              </div>

              <div
                className="flex items-center gap-1.5 mt-4 text-xs font-medium transition-colors"
                style={{ color: 'var(--t3)' }}
              >
                {cta}
                <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>

        {/* Footer features */}
        <div className="pb-16 pt-8" style={{ borderTop: '1px solid var(--b)' }}>
          <div className="t-label mb-8">What you can monitor</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { tag: 'PERF', title: 'Performance', desc: 'Latency (p50/p95/p99), TTFT, throughput, SLA breaches.' },
              { tag: 'COST', title: 'Cost',        desc: 'Token consumption, estimated cost per 100 chats, budget trends.' },
              { tag: 'QUAL', title: 'Quality',     desc: 'Error rates, refusal rates, judge scores, groundedness.' },
            ].map(({ tag, title, desc }) => (
              <div key={tag} className="flex gap-4">
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-bold"
                  style={{ background: 'rgba(78,107,255,.08)', border: '1px solid rgba(78,107,255,.15)', color: 'var(--blue-hi)' }}
                >
                  {tag}
                </div>
                <div>
                  <h4
                    className="text-sm font-semibold mb-1"
                    style={{ color: 'var(--t1)', fontFamily: 'Bricolage Grotesque, sans-serif' }}
                  >
                    {title}
                  </h4>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
