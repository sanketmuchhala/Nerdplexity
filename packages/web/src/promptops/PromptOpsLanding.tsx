import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, List, Zap, ArrowRight } from 'lucide-react';

const cards = [
  { to: '/app/analytics/dashboard', icon: BarChart3, label: 'Metrics Dashboard', desc: 'Latency percentiles, token usage, cost per 100 chats, error rates, and model quality.', stats: [{ v:'13', l:'KPIs' }, { v:'8', l:'Charts' }], cta: 'Open Dashboard' },
  { to: '/app/analytics/events',    icon: List,      label: 'All Events',          desc: 'Full log of every LLM call — latency, tokens, risk score, safety flags, cost estimate.', stats: [{ v:'19', l:'Columns' }, { v:'∞', l:'History' }], cta: 'Browse Events' },
  { to: '/app/analytics/benchmark', icon: Zap,       label: 'Benchmark',           desc: 'Measure TTFT and latency for your Ollama models. Get p50/p95 statistics per prompt.', stats: [{ v:'3', l:'Prompts' }, { v:'p95', l:'Stats' }], cta: 'Run Benchmark' },
];

export default function PromptOpsLanding() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--t1)' }}>
      <div className="px-8 py-4" style={{ borderBottom: '1px solid var(--b)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/app" className="flex items-center gap-2 text-xs transition-colors" style={{ color: 'var(--t3)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t1)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t3)'}>
            <ArrowLeft size={13} /> Back to chat
          </Link>
          <span className="text-xs font-bold tracking-widest" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t4)' }}>PROMPTOPS</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8">
        <div className="pt-14 pb-12">
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full mb-6 font-medium"
            style={{ background: 'var(--blue-dim)', border: '1px solid rgba(59,130,246,.3)', color: 'var(--blue-bright)' }}>
            Analytics Suite
          </div>
          <h1 className="text-3xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.03em' }}>
            PromptOps
          </h1>
          <p className="text-sm max-w-lg leading-relaxed" style={{ color: 'var(--t2)' }}>
            Full observability over every AI interaction. Monitor performance, debug issues, optimize cost.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-16">
          {cards.map(({ to, icon: Icon, label, desc, stats, cta }) => (
            <Link key={to} to={to}
              className="group flex flex-col p-5 rounded-xl transition-all duration-200"
              style={{ background: 'var(--s0)', border: '1px solid var(--b)' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(59,130,246,.25)'; el.style.boxShadow = '0 0 0 1px rgba(59,130,246,.06), 0 8px 32px rgba(0,0,0,.5)'; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--b)'; el.style.boxShadow = 'none'; }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-4"
                style={{ background: 'var(--blue-dim)', border: '1px solid rgba(59,130,246,.2)' }}>
                <Icon size={16} style={{ color: 'var(--blue-bright)' }} />
              </div>
              <h2 className="text-sm font-semibold mb-2" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>{label}</h2>
              <p className="text-xs leading-relaxed flex-1" style={{ color: 'var(--t3)' }}>{desc}</p>
              <div className="flex gap-5 mt-5 pt-4" style={{ borderTop: '1px solid var(--b)' }}>
                {stats.map(s => (
                  <div key={s.l}>
                    <div className="text-xl font-bold leading-none" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--blue-bright)' }}>{s.v}</div>
                    <div className="t-caps mt-1">{s.l}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mt-4 text-xs font-medium transition-colors" style={{ color: 'var(--t3)' }}>
                {cta} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
