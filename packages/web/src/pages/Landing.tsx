import { Link } from 'react-router-dom';
import { ArrowRight, Key, Shield, Zap, Globe, Brain, BarChart3, ChevronRight } from 'lucide-react';

const PROVIDERS = [
  { name: 'Claude',    sub: 'Anthropic',  dot: '#e8a575' },
  { name: 'GPT-4',     sub: 'OpenAI',     dot: '#74c99d' },
  { name: 'Gemini',    sub: 'Google',     dot: '#74b3f8' },
  { name: 'DeepSeek',  sub: 'DeepSeek',   dot: '#a78bfa' },
  { name: 'Ollama',    sub: 'Local',       dot: '#888' },
];

const FEATURES = [
  { icon: Key,      title: 'Bring Your Own Keys',   desc: 'Your API keys, your billing, your usage. Zero markup. Direct to provider.' },
  { icon: Shield,   title: 'Zero Data Retention',   desc: 'Messages live in your browser. No server stores your conversations.' },
  { icon: Zap,      title: 'Any Provider, Any Model', desc: 'Switch between Claude, GPT, Gemini, DeepSeek, and local Ollama in one click.' },
  { icon: Globe,    title: 'Live Web Search',        desc: 'Ground responses in real-time data. Toggle per message, per model.' },
  { icon: Brain,    title: 'Extended Thinking',      desc: 'Surface chain-of-thought from models that support reasoning.' },
  { icon: BarChart3,'title': 'PromptOps Analytics', desc: 'Full observability. Latency, cost, quality — every request measured.' },
];

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'var(--bg)', color: 'var(--t1)' }}>

      {/* ─────────── Background decoration ─────────── */}
      {/* Dot grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 80% at 50% 0%, black 40%, transparent 100%)',
        }}
      />
      {/* Blue radial glow at top */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: '-20%', left: '50%', transform: 'translateX(-50%)',
          width: '800px', height: '600px',
          background: 'radial-gradient(ellipse, rgba(59,130,246,.12) 0%, transparent 65%)',
        }}
      />

      {/* ─────────── Nav ─────────── */}
      <nav className="relative z-10 border-b" style={{ borderColor: 'var(--b)' }}>
        <div className="max-w-6xl mx-auto px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white"
              style={{ background: 'var(--blue-dark)', boxShadow: '0 0 12px rgba(59,130,246,.35)', fontFamily: 'Bricolage Grotesque, sans-serif' }}
            >N</div>
            <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Nerdplexity
            </span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/app/analytics" className="text-sm transition-colors" style={{ color: 'var(--t3)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--t1)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}>
              Analytics
            </Link>
            <Link to="/app" className="btn-primary" style={{ padding: '7px 16px', borderRadius: '10px', fontSize: '13px' }}>
              Open App <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ─────────── Hero ─────────── */}
      <section className="relative z-10 pt-28 pb-24 px-6 text-center max-w-5xl mx-auto">
        {/* Pill badge */}
        <div className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full text-xs font-medium"
          style={{ background: 'var(--blue-dim)', border: '1px solid rgba(59,130,246,.3)', color: 'var(--blue-bright)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          Private-first AI interface
        </div>

        {/* Headline */}
        <h1
          className="mb-6"
          style={{
            fontFamily: 'Bricolage Grotesque, sans-serif',
            fontWeight: 800,
            fontSize: 'clamp(48px, 7vw, 88px)',
            lineHeight: 1.02,
            letterSpacing: '-0.04em',
            color: 'var(--t1)',
          }}
        >
          AI on your terms.<br />
          <span style={{
            background: 'linear-gradient(135deg, var(--blue-bright) 0%, var(--blue) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            Your keys, your rules.
          </span>
        </h1>

        <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed" style={{ color: 'var(--t2)' }}>
          Chat with Claude, GPT-4, Gemini, DeepSeek, and local models — using your own API keys.
          No accounts. No data collection. No lock-in.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/app" className="btn-primary" style={{ fontSize: '15px', padding: '12px 24px' }}>
            Start chatting free <ArrowRight size={15} />
          </Link>
          <Link to="/app/analytics" className="btn-ghost" style={{ fontSize: '15px', padding: '12px 24px' }}>
            View analytics
          </Link>
        </div>

        {/* Provider row */}
        <div className="flex items-center justify-center gap-3 mt-14 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--t3)' }}>Works with</span>
          {PROVIDERS.map(p => (
            <div
              key={p.name}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: 'var(--s1)', border: '1px solid var(--b-hi)', color: 'var(--t2)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.dot }} />
              {p.name}
            </div>
          ))}
        </div>
      </section>

      {/* ─────────── App Mockup ─────────── */}
      <section className="relative z-10 px-6 pb-28 max-w-5xl mx-auto">
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            border: '1px solid var(--b-hi)',
            background: 'var(--s0)',
            boxShadow: '0 0 0 1px rgba(59,130,246,.06), 0 32px 96px rgba(0,0,0,.8), 0 0 80px rgba(59,130,246,.04)',
          }}
        >
          {/* Window chrome */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--b)', background: 'var(--s1)' }}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#febc2e' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#28c840' }} />
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded text-xs" style={{ background: 'var(--s2)', border: '1px solid var(--b)', color: 'var(--t3)' }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#28c840' }} />
              nerdplexity — claude-3-5-sonnet
            </div>
            <div className="w-16" />
          </div>

          {/* App layout mock */}
          <div className="flex" style={{ minHeight: '380px' }}>
            {/* Sidebar */}
            <div className="hidden sm:flex flex-col py-4" style={{ width: '200px', borderRight: '1px solid var(--b)', background: 'var(--s0)' }}>
              <div className="px-3 pb-3">
                <div className="flex items-center gap-2 mb-3 px-2">
                  <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold text-white" style={{ background: 'var(--blue-dark)' }}>N</div>
                  <span className="text-xs font-semibold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Nerdplexity</span>
                </div>
                <div className="text-xs py-1.5 px-3 rounded-lg font-medium" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t2)' }}>+ New thread</div>
              </div>
              <div className="px-3">
                <div className="t-caps px-2 pb-2">Today</div>
                {['Explain transformer attention', 'Rust async patterns', 'SQL window functions'].map((t, i) => (
                  <div key={t} className="text-xs px-2.5 py-2 rounded-lg mb-0.5 truncate"
                    style={{
                      background: i === 0 ? 'var(--blue-dim)' : 'transparent',
                      borderLeft: i === 0 ? '2px solid var(--blue)' : '2px solid transparent',
                      color: i === 0 ? 'var(--blue-bright)' : 'var(--t3)',
                      paddingLeft: i === 0 ? '10px' : undefined,
                    }}>{t}</div>
                ))}
              </div>
            </div>

            {/* Chat area */}
            <div className="flex-1 flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 h-11" style={{ borderBottom: '1px solid var(--b)' }}>
                <span className="text-xs font-medium truncate" style={{ color: 'var(--t2)' }}>Explain transformer attention</span>
                <div className="flex items-center gap-1.5">
                  {['Anthropic', 'claude-3-5-sonnet'].map(t => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t3)' }}>{t}</span>
                  ))}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-hidden p-5 space-y-5">
                {/* User */}
                <div className="flex justify-end">
                  <div className="max-w-[72%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm" style={{ background: 'var(--s3)', border: '1px solid var(--b-hi)', color: 'var(--t1)' }}>
                    How does self-attention work in transformers?
                  </div>
                </div>
                {/* AI */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white" style={{ background: 'var(--blue-dark)' }}>N</div>
                    <span className="t-caps">Nerdplexity</span>
                    <div className="flex gap-1.5 ml-1">
                      {['arxiv.org', 'attention is all you need', 'huggingface.co'].map((s, i) => (
                        <span key={s} className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--s2)', border: '1px solid var(--b)', color: 'var(--t3)' }}>
                          <span className="w-3 h-3 rounded-full text-[8px] flex items-center justify-center text-white font-bold" style={{ background: 'rgba(59,130,246,.6)' }}>{i+1}</span>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--t1)' }}>
                      Self-attention allows every token to attend to every other token in the sequence simultaneously, computing weighted sums based on query-key dot products...
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>
                      For each position <span className="font-mono text-xs px-1.5 rounded" style={{ background: 'var(--blue-dim)', color: 'var(--blue-bright)' }}>i</span>, the model computes Q, K, V projections and scales dot products by √d_k...
                    </p>
                  </div>
                </div>
              </div>

              {/* Composer */}
              <div className="px-4 pb-4">
                <div className="rounded-xl overflow-hidden composer-wrap" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)' }}>
                  <div className="px-4 py-3 text-sm" style={{ color: 'var(--t3)' }}>Ask anything…</div>
                  <div className="flex items-center justify-between px-3 pb-2.5">
                    <div className="flex gap-1.5">
                      {['🌐 Web', '🧠 Reason'].map(p => (
                        <span key={p} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: 'var(--s3)', border: '1px solid var(--b)', color: 'var(--t3)' }}>{p}</span>
                      ))}
                    </div>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--blue-dark)' }}>
                      <ArrowRight size={13} className="text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Features ─────────── */}
      <section className="relative z-10 px-6 pb-28 max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.03em' }}>
            Built for power users
          </h2>
          <p className="text-sm" style={{ color: 'var(--t2)' }}>Everything you need, nothing you don't.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="p-5 rounded-xl transition-all duration-200 group"
              style={{ background: 'var(--s0)', border: '1px solid var(--b)' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,.25)';
                (e.currentTarget as HTMLElement).style.background = 'var(--s1)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--b)';
                (e.currentTarget as HTMLElement).style.background = 'var(--s0)';
              }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-4" style={{ background: 'var(--blue-dim)', border: '1px solid rgba(59,130,246,.2)' }}>
                <Icon size={16} style={{ color: 'var(--blue-bright)' }} />
              </div>
              <h3 className="text-sm font-semibold mb-2" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>{title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────── Analytics preview ─────────── */}
      <section className="relative z-10 px-6 pb-28 max-w-5xl mx-auto">
        <div className="rounded-2xl p-8" style={{ background: 'var(--s0)', border: '1px solid var(--b)' }}>
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-1" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.025em' }}>
                Full observability
              </h2>
              <p className="text-sm" style={{ color: 'var(--t2)' }}>Every interaction measured. PromptOps analytics built in.</p>
            </div>
            <Link to="/app/analytics" className="flex items-center gap-1 text-sm font-medium transition-colors" style={{ color: 'var(--blue-bright)' }}>
              Open dashboard <ChevronRight size={14} />
            </Link>
          </div>

          {/* Mini KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total calls', value: '2,847', trend: '↑' },
              { label: 'Avg latency', value: '1.2s', trend: '↓' },
              { label: 'Helpful rate', value: '94%', trend: '↑' },
              { label: 'Cost / 100', value: '$0.14', trend: '↓' },
            ].map(k => (
              <div key={k.label} className="p-4 rounded-xl" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)' }}>
                <div className="t-caps mb-2">{k.label}</div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--blue-bright)' }}>{k.value}</span>
                  <span className="text-xs" style={{ color: k.trend === '↑' ? '#74c99d' : '#f87171' }}>{k.trend}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Final CTA ─────────── */}
      <section className="relative z-10 px-6 pb-28 max-w-2xl mx-auto text-center">
        <div className="rounded-2xl p-12" style={{ background: 'var(--s0)', border: '1px solid rgba(59,130,246,.2)', boxShadow: '0 0 60px rgba(59,130,246,.06)' }}>
          <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.025em' }}>
            Ready to take control?
          </h2>
          <p className="text-sm mb-7 leading-relaxed" style={{ color: 'var(--t2)' }}>
            No sign-up. No credit card. Paste your API key and you're in.
          </p>
          <Link to="/app" className="btn-primary inline-flex" style={{ fontSize: '15px', padding: '12px 28px' }}>
            Open Nerdplexity <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-5 border-t max-w-6xl mx-auto flex items-center justify-between" style={{ borderColor: 'var(--b)' }}>
        <span className="text-xs font-bold tracking-widest" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t4)' }}>NERDPLEXITY</span>
        <span className="text-xs" style={{ color: 'var(--t4)' }}>Local-first. Private by design.</span>
      </footer>
    </div>
  );
}
