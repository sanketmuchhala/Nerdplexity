import _React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Key, Shield, Zap, Globe, Brain, BarChart3, ChevronRight } from 'lucide-react';

const providers = [
  { name: 'Claude', color: '#e8a575' },
  { name: 'GPT-4',  color: '#74c69d' },
  { name: 'Gemini', color: '#74b3f8' },
  { name: 'DeepSeek', color: '#a78bfa' },
  { name: 'Ollama', color: '#8892b0' },
];

const features = [
  {
    icon: Key,
    title: 'Your Keys, Your Control',
    desc: 'Bring your own API keys for every provider. Zero data retention. Zero lock-in.',
  },
  {
    icon: Shield,
    title: 'Private by Design',
    desc: 'Messages never leave your browser. No accounts, no tracking, no telemetry.',
  },
  {
    icon: Zap,
    title: 'Multi-Provider',
    desc: 'Switch between Claude, GPT-4, Gemini, DeepSeek, or local Ollama mid-conversation.',
  },
  {
    icon: Globe,
    title: 'Web Search',
    desc: 'Ground responses in live data. Toggle web search per message.',
  },
  {
    icon: Brain,
    title: 'Extended Reasoning',
    desc: 'Surface the chain-of-thought for models that support it.',
  },
  {
    icon: BarChart3,
    title: 'PromptOps Analytics',
    desc: 'Latency, cost, quality metrics — full observability over every interaction.',
  },
];

export default function Landing() {
  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Subtle grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-100"
        style={{
          backgroundImage: 'linear-gradient(rgba(78,107,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(78,107,255,.04) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Blue glow origin */}
      <div
        className="pointer-events-none absolute top-[-20%] left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(ellipse, rgba(78,107,255,.35) 0%, transparent 70%)' }}
      />

      {/* ── Nav ── */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue)', boxShadow: '0 0 16px rgba(78,107,255,.4)' }}
          >
            <span className="text-xs font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>N</span>
          </div>
          <span className="text-base font-semibold text-[var(--t1)]" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.01em' }}>
            Nerdplexity
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/promptops"
            className="text-sm text-[var(--t3)] hover:text-[var(--t1)] transition-colors"
          >
            Analytics
          </Link>
          <Link
            to="/app"
            className="flex items-center gap-1.5 btn-primary text-sm px-4 py-2"
            style={{ borderRadius: '10px', paddingTop: '8px', paddingBottom: '8px' }}
          >
            Open App
            <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative z-10 text-center px-6 pt-20 pb-24 max-w-4xl mx-auto">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 mb-8">
          <span
            className="text-xs px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(78,107,255,.1)',
              border: '1px solid rgba(78,107,255,.25)',
              color: '#6b85ff',
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            Private-first AI interface
          </span>
        </div>

        <h1
          className="mb-6"
          style={{
            fontFamily: 'Bricolage Grotesque, sans-serif',
            fontWeight: 800,
            fontSize: 'clamp(40px, 6vw, 72px)',
            lineHeight: 1.08,
            letterSpacing: '-0.04em',
            color: '#e8eaf5',
          }}
        >
          Your AI.
          <br />
          <span style={{ color: 'var(--blue)' }}>Your Keys.</span>
          <br />
          Your Control.
        </h1>

        <p
          className="mx-auto mb-10 max-w-xl"
          style={{ fontSize: '17px', lineHeight: '1.7', color: 'var(--t2)' }}
        >
          The intelligent chat interface that runs entirely on your API keys.
          No accounts. No data retention. Full provider flexibility.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/app" className="btn-primary">
            Start Chatting
            <ArrowRight size={15} />
          </Link>
          <Link to="/promptops" className="btn-ghost">
            View Analytics
          </Link>
        </div>

        {/* Provider chips */}
        <div className="flex items-center justify-center gap-3 mt-12 flex-wrap">
          <span className="text-xs text-[var(--t3)]">Works with</span>
          {providers.map(p => (
            <span
              key={p.name}
              className="text-xs px-3 py-1 rounded-full"
              style={{
                background: 'var(--s2)',
                border: '1px solid var(--b)',
                color: p.color,
              }}
            >
              {p.name}
            </span>
          ))}
        </div>
      </section>

      {/* ── App preview mockup ── */}
      <section className="relative z-10 px-6 pb-24 max-w-5xl mx-auto">
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            border: '1px solid var(--b-hi)',
            background: 'var(--s1)',
            boxShadow: '0 0 0 1px rgba(78,107,255,.12), 0 24px 80px rgba(0,0,0,.7)',
          }}
        >
          {/* Mock title bar */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ borderBottom: '1px solid var(--b)', background: 'var(--s2)' }}
          >
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#febc2e' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#28c840' }} />
            </div>
            <div
              className="mx-auto text-xs px-4 py-0.5 rounded"
              style={{ background: 'var(--s3)', color: 'var(--t3)', border: '1px solid var(--b)' }}
            >
              nerdplexity.app
            </div>
          </div>

          {/* Mock chat area */}
          <div className="flex" style={{ minHeight: '320px' }}>
            {/* Sidebar mock */}
            <div
              className="hidden sm:flex flex-col gap-2 p-3"
              style={{ width: '200px', borderRight: '1px solid var(--b)', background: 'var(--s1)' }}
            >
              <div className="text-2xs text-[var(--t3)] px-2 pt-1">TODAY</div>
              {['Explain RLHF training', 'Python async patterns', 'Write a SQL query'].map((t, i) => (
                <div
                  key={i}
                  className="text-xs px-2.5 py-1.5 rounded-md truncate"
                  style={{
                    background: i === 0 ? 'rgba(78,107,255,.12)' : 'transparent',
                    color: i === 0 ? '#6b85ff' : 'var(--t3)',
                    borderLeft: i === 0 ? '2px solid var(--blue)' : '2px solid transparent',
                  }}
                >
                  {t}
                </div>
              ))}
            </div>

            {/* Chat mock */}
            <div className="flex-1 p-6 flex flex-col gap-4">
              {/* User message */}
              <div className="flex justify-end">
                <div
                  className="text-sm px-4 py-2.5 rounded-xl rounded-tr-sm max-w-xs"
                  style={{ background: 'var(--s3)', border: '1px solid var(--b-hi)', color: 'var(--t1)' }}
                >
                  Explain how transformer attention works
                </div>
              </div>

              {/* AI message */}
              <div className="max-w-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold text-white"
                    style={{ background: 'var(--blue)' }}
                  >N</div>
                  <span className="text-2xs text-[var(--t3)] font-semibold uppercase tracking-wider">Nerdplexity</span>
                  <span
                    className="text-2xs px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--s3)', color: '#74b3f8', border: '1px solid var(--b)' }}
                  >
                    claude-3-5-sonnet
                  </span>
                </div>
                <div className="space-y-2">
                  {['Attention mechanisms compute weighted sums over all tokens simultaneously...', 'For each token, we create Query, Key, and Value vectors through learned projections...'].map((_line, i) => (
                    <div
                      key={i}
                      className="h-3 rounded"
                      style={{
                        background: 'var(--s3)',
                        width: i === 0 ? '100%' : '75%',
                        opacity: 1 - i * 0.2,
                      }}
                    />
                  ))}
                  <p className="text-xs text-[var(--t2)] leading-relaxed">
                    Attention mechanisms compute weighted sums over all tokens simultaneously, allowing each position to attend to every other position...
                  </p>
                </div>
              </div>

              {/* Composer mock */}
              <div className="mt-auto">
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)' }}
                >
                  <span className="text-sm text-[var(--t3)] flex-1">Ask anything…</span>
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--blue)' }}
                  >
                    <ArrowRight size={13} className="text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="relative z-10 px-6 pb-24 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2
            className="text-3xl mb-3"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--t1)' }}
          >
            Everything you need
          </h2>
          <p className="text-base text-[var(--t2)]">Built for developers who want total control.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="p-5 rounded-xl group transition-all duration-200 cursor-default"
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--b)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(78,107,255,.3)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(78,107,255,.1), 0 8px 32px rgba(0,0,0,.4)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--b)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-4"
                style={{ background: 'rgba(78,107,255,.1)', border: '1px solid rgba(78,107,255,.2)' }}
              >
                <Icon size={16} style={{ color: 'var(--blue-hi)' }} />
              </div>
              <h3
                className="text-sm font-semibold text-[var(--t1)] mb-1.5"
                style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
              >
                {title}
              </h3>
              <p className="text-xs text-[var(--t2)] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA bottom ── */}
      <section className="relative z-10 px-6 pb-24 max-w-2xl mx-auto text-center">
        <div
          className="p-10 rounded-2xl"
          style={{
            background: 'var(--s1)',
            border: '1px solid rgba(78,107,255,.2)',
            boxShadow: '0 0 60px rgba(78,107,255,.08)',
          }}
        >
          <h2
            className="text-2xl mb-3"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--t1)' }}
          >
            Ready to take control?
          </h2>
          <p className="text-sm text-[var(--t2)] mb-6 leading-relaxed">
            No sign-up. No credit card. Just paste your API key and start.
          </p>
          <Link to="/app" className="btn-primary inline-flex">
            Open Nerdplexity
            <ChevronRight size={15} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="relative z-10 border-t px-8 py-6 max-w-6xl mx-auto flex items-center justify-between"
        style={{ borderColor: 'var(--b)' }}
      >
        <span className="text-xs text-[var(--t3)]" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontWeight: 600 }}>
          NERDPLEXITY
        </span>
        <span className="text-xs text-[var(--t3)]">Local-first. Private by design.</span>
      </footer>
    </div>
  );
}
