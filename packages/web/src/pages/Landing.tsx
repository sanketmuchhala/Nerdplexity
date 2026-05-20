import { Link } from 'react-router-dom';
import { ArrowRight, Key, Shield, Zap, Globe, Brain, BarChart3, ChevronRight, Check, X, Lock, Cpu, Database, Eye } from 'lucide-react';

const PROVIDERS = [
  { name: 'Claude',   sub: 'Anthropic', dot: '#e8a575' },
  { name: 'GPT-4o',  sub: 'OpenAI',    dot: '#74c99d' },
  { name: 'Gemini',  sub: 'Google',    dot: '#74b3f8' },
  { name: 'DeepSeek',sub: 'DeepSeek',  dot: '#a78bfa' },
  { name: 'Ollama',  sub: 'Local',     dot: '#555'    },
];

const FEATURES = [
  { icon: Key,      title: 'Bring Your Own Keys',    desc: 'Connect your API keys directly to the provider. Zero markup. Zero middleman billing. You own the relationship.' },
  { icon: Shield,   title: 'Zero Server Storage',    desc: 'Conversations live in your browser via IndexedDB. Our server never sees, stores, or touches your messages.' },
  { icon: Zap,      title: 'Any Model, Any Provider', desc: 'Claude, GPT-4o, Gemini 1.5, DeepSeek R1, and any local Ollama model — switchable mid-conversation.' },
  { icon: Globe,    title: 'Live Web Search',         desc: 'Ground every response in real-time data. Toggle per message. Works with every provider.' },
  { icon: Brain,    title: 'Extended Reasoning',      desc: 'See chain-of-thought from models that support it. Full thinking trace, collapsible and searchable.' },
  { icon: BarChart3, title: 'PromptOps Analytics',   desc: 'Latency percentiles, token costs, error rates, and quality scores — tracked locally, privately.' },
];

const STEPS = [
  { n: '01', title: 'Add your API key',      desc: 'Paste your key from Anthropic, OpenAI, Google, or DeepSeek. Keys are stored in your browser only — never sent anywhere except directly to the provider.' },
  { n: '02', title: 'Pick a model',          desc: 'Choose from any supported model across all providers. Or pull a local Ollama model and run it entirely on your machine.' },
  { n: '03', title: 'Chat with full control', desc: 'Toggle web search, reasoning mode, and per-conversation settings. Every message goes direct from your browser to the AI.' },
];

const COMPARISON = [
  { feature: 'Your own API keys',         nerd: true,  gpt: false, claude: false },
  { feature: 'Messages stored locally',   nerd: true,  gpt: false, claude: false },
  { feature: 'No account required',       nerd: true,  gpt: false, claude: false },
  { feature: 'Multiple AI providers',     nerd: true,  gpt: false, claude: false },
  { feature: 'Local / Ollama models',     nerd: true,  gpt: false, claude: false },
  { feature: 'Live web search',           nerd: true,  gpt: true,  claude: false },
  { feature: 'Usage analytics',           nerd: true,  gpt: false, claude: false },
  { feature: 'Zero data collection',      nerd: true,  gpt: false, claude: false },
];

const PRIVACY_PILLARS = [
  { icon: Lock,     title: 'Keys stay in your browser', desc: 'API keys are encrypted in localStorage. They are transmitted only in the Authorization header of requests to the AI provider — never to our servers.' },
  { icon: Database, title: 'Conversations in IndexedDB', desc: 'Every message is written to your browser\'s local database. Clearing site data permanently deletes everything.' },
  { icon: Eye,      title: 'Open architecture',         desc: 'The proxy server only routes requests — it does not log bodies, store keys, or retain any user content.' },
  { icon: Cpu,      title: 'Run fully offline',         desc: 'Pair with Ollama to run local models. Zero network requests leave your machine.' },
];

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'var(--bg)', color: 'var(--t1)' }}>

      {/* ── Background decorations ── */}
      <div
        className="fixed inset-0 pointer-events-none select-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.025) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          maskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, black 30%, transparent 100%)',
        }}
      />
      <div
        className="fixed pointer-events-none"
        style={{
          top: '-15%', left: '50%', transform: 'translateX(-50%)',
          width: '900px', height: '700px',
          background: 'radial-gradient(ellipse at 50% 20%, rgba(37,99,235,.15) 0%, transparent 60%)',
          filter: 'blur(1px)',
        }}
      />

      {/* ── Nav ── */}
      <nav className="relative z-10 border-b" style={{ borderColor: 'var(--b)' }}>
        <div className="max-w-6xl mx-auto px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white"
              style={{ background: 'var(--blue-dark)', boxShadow: '0 0 14px rgba(37,99,235,.5)', fontFamily: 'Bricolage Grotesque, sans-serif' }}
            >N</div>
            <span className="font-semibold text-sm" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.02em' }}>
              Nerdplexity
            </span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/app/analytics"
              className="text-sm transition-colors hidden sm:block"
              style={{ color: 'var(--t3)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--t1)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}>
              Analytics
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm transition-colors hidden sm:block"
              style={{ color: 'var(--t3)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--t1)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}>
              GitHub
            </a>
            <Link to="/app" className="btn-primary" style={{ padding: '7px 16px', borderRadius: '10px', fontSize: '13px' }}>
              Open App <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative z-10 pt-24 pb-20 px-6 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full text-xs font-medium"
          style={{ background: 'rgba(37,99,235,.08)', border: '1px solid rgba(59,130,246,.2)', color: 'var(--blue-bright)' }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--blue-bright)' }} />
          Private-first · Open source · Local-first
        </div>

        <h1
          className="mb-6"
          style={{
            fontFamily: 'Bricolage Grotesque, sans-serif',
            fontWeight: 800,
            fontSize: 'clamp(44px, 7.5vw, 96px)',
            lineHeight: 1.0,
            letterSpacing: '-0.045em',
            color: 'var(--t1)',
          }}
        >
          One interface.<br />
          <span style={{
            background: 'linear-gradient(120deg, #93c5fd 0%, var(--blue) 50%, #1d4ed8 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Every AI model.
          </span>
        </h1>

        <p className="mx-auto mb-10 max-w-lg text-base leading-relaxed" style={{ color: 'var(--t2)' }}>
          Chat with Claude, GPT-4o, Gemini, DeepSeek, and local Ollama models using your own API keys.
          No accounts. No data retention. No lock-in.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/app" className="btn-primary" style={{ fontSize: '15px', padding: '12px 26px' }}>
            Start for free <ArrowRight size={15} />
          </Link>
          <Link to="/app/analytics" className="btn-ghost" style={{ fontSize: '15px', padding: '12px 26px' }}>
            View analytics
          </Link>
        </div>

        {/* Provider row */}
        <div className="flex items-center justify-center gap-2.5 mt-12 flex-wrap">
          <span className="text-xs mr-1" style={{ color: 'var(--t4)' }}>Works with</span>
          {PROVIDERS.map(p => (
            <div
              key={p.name}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
              style={{ background: 'var(--s1)', border: '1px solid var(--b-hi)', color: 'var(--t3)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.dot }} />
              {p.name}
            </div>
          ))}
        </div>
      </section>

      {/* ── App Mockup ── */}
      <section className="relative z-10 px-6 pb-32 max-w-5xl mx-auto">
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            border: '1px solid var(--b-hi)',
            background: 'var(--s0)',
            boxShadow: '0 0 0 1px rgba(59,130,246,.04), 0 40px 120px rgba(0,0,0,.9), 0 0 100px rgba(37,99,235,.05)',
          }}
        >
          {/* Window chrome */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--b)', background: 'var(--s1)' }}>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded text-xs" style={{ background: 'var(--s2)', border: '1px solid var(--b)', color: 'var(--t3)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#28c840' }} />
              nerdplexity — claude-3-5-sonnet
            </div>
            <div className="w-16" />
          </div>

          {/* App layout */}
          <div className="flex" style={{ minHeight: '400px' }}>
            {/* Sidebar */}
            <div className="hidden sm:flex flex-col py-3" style={{ width: '196px', borderRight: '1px solid var(--b)', background: 'var(--s0)', flexShrink: 0 }}>
              <div className="px-3 pb-3">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ background: 'var(--blue-dark)' }}>N</div>
                  <span className="text-xs font-semibold truncate" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Nerdplexity</span>
                </div>
                <div className="text-xs py-1.5 px-3 rounded-lg font-medium text-center" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t3)' }}>+ New thread</div>
              </div>
              <div className="px-2">
                <div className="t-caps px-2 pb-1.5 pt-1">Today</div>
                {['Explain transformer attention', 'Rust async patterns', 'SQL window functions', 'React Server Components'].map((t, i) => (
                  <div key={t} className="text-xs px-2.5 py-1.5 rounded-lg mb-0.5 truncate"
                    style={{
                      background: i === 0 ? 'rgba(59,130,246,.07)' : 'transparent',
                      borderLeft: i === 0 ? '2px solid var(--blue)' : '2px solid transparent',
                      color: i === 0 ? 'var(--blue-bright)' : 'var(--t3)',
                    }}>{t}</div>
                ))}
                <div className="t-caps px-2 pb-1.5 pt-3">Yesterday</div>
                {['Python decorators deep dive', 'WebGL shaders intro'].map(t => (
                  <div key={t} className="text-xs px-2.5 py-1.5 rounded-lg mb-0.5 truncate" style={{ color: 'var(--t4)', borderLeft: '2px solid transparent' }}>{t}</div>
                ))}
              </div>
            </div>

            {/* Chat area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-5 h-11 flex-shrink-0" style={{ borderBottom: '1px solid var(--b)' }}>
                <span className="text-xs font-medium truncate" style={{ color: 'var(--t2)' }}>Explain transformer attention</span>
                <div className="flex items-center gap-1.5">
                  {['Anthropic', 'claude-3-5-sonnet'].map(t => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-md whitespace-nowrap" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t3)' }}>{t}</span>
                  ))}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-hidden p-5 space-y-5">
                <div className="flex justify-end">
                  <div className="max-w-[70%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm" style={{ background: 'var(--s3)', border: '1px solid var(--b-hi)', color: 'var(--t1)' }}>
                    How does self-attention work in transformers?
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ background: 'var(--blue-dark)' }}>N</div>
                    <span className="t-caps">Nerdplexity</span>
                    <div className="flex gap-1.5 ml-1 flex-wrap">
                      {['arxiv.org', '"Attention is All You Need"', 'huggingface.co'].map((s, i) => (
                        <span key={s} className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--s2)', border: '1px solid var(--b)', color: 'var(--t3)' }}>
                          <span className="w-3 h-3 rounded-full text-[8px] flex items-center justify-center text-white font-bold flex-shrink-0" style={{ background: 'rgba(59,130,246,.5)' }}>{i+1}</span>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--t1)' }}>
                      Self-attention allows every token to attend to every other token simultaneously, computing weighted sums based on query-key dot products.
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>
                      For each position <span className="font-mono text-xs px-1.5 rounded" style={{ background: 'rgba(59,130,246,.1)', color: 'var(--blue-bright)' }}>i</span>, the model computes Q, K, V projections and scales dot products by <span className="font-mono text-xs px-1 rounded" style={{ background: 'rgba(59,130,246,.1)', color: 'var(--blue-bright)' }}>√d_k</span>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Composer */}
              <div className="px-4 pb-4 flex-shrink-0">
                <div className="rounded-xl overflow-hidden" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)' }}>
                  <div className="px-4 py-3 text-sm" style={{ color: 'var(--t4)' }}>Ask anything…</div>
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

      {/* ── How it works ── */}
      <section className="relative z-10 px-6 pb-32 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--s1)', border: '1px solid var(--b-hi)', color: 'var(--t3)' }}>
            Simple setup
          </div>
          <h2 className="text-3xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.035em' }}>
            Up in 30 seconds
          </h2>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--t2)' }}>No sign-up. No OAuth. No subscription. Just paste a key and start.</p>
        </div>

        <div className="relative">
          {/* Connecting line */}
          <div className="hidden md:block absolute top-10 left-[calc(16.67%+20px)] right-[calc(16.67%+20px)] h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--b-hi), var(--b-hi), transparent)' }} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map(({ n, title, desc }) => (
              <div key={n} className="relative">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--blue-bright)', fontFamily: 'Bricolage Grotesque, sans-serif', flexShrink: 0 }}
                  >{n}</div>
                  <h3 className="text-sm font-semibold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>{title}</h3>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)', paddingLeft: '52px' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features grid ── */}
      <section className="relative z-10 px-6 pb-32 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--s1)', border: '1px solid var(--b-hi)', color: 'var(--t3)' }}>
            Everything included
          </div>
          <h2 className="text-3xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.035em' }}>
            Built for power users
          </h2>
          <p className="text-sm" style={{ color: 'var(--t2)' }}>Every feature you'd expect, without the privacy compromises.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="p-5 rounded-xl transition-all duration-200 group cursor-default"
              style={{ background: 'var(--s0)', border: '1px solid var(--b)' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,.2)';
                (e.currentTarget as HTMLElement).style.background = 'var(--s1)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,0,0,.6)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--b)';
                (e.currentTarget as HTMLElement).style.background = 'var(--s0)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-4 transition-all duration-200"
                style={{ background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.15)' }}>
                <Icon size={16} style={{ color: 'var(--blue-bright)' }} />
              </div>
              <h3 className="text-sm font-semibold mb-2" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>{title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Privacy architecture ── */}
      <section className="relative z-10 px-6 pb-32 max-w-5xl mx-auto">
        <div
          className="rounded-2xl p-10 md:p-12"
          style={{
            background: 'var(--s0)',
            border: '1px solid var(--b)',
            boxShadow: '0 0 60px rgba(37,99,235,.03)',
          }}
        >
          <div className="max-w-lg mb-12">
            <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.18)', color: 'var(--blue-bright)' }}>
              Privacy by design
            </div>
            <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.03em' }}>
              Your data never leaves your machine
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>
              We built a thin proxy that routes your API calls — nothing more. Keys, messages, and conversations are yours alone.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PRIVACY_PILLARS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 p-5 rounded-xl" style={{ background: 'var(--s1)', border: '1px solid var(--b-hi)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.15)' }}>
                  <Icon size={15} style={{ color: 'var(--blue-bright)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1.5" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>{title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison table ── */}
      <section className="relative z-10 px-6 pb-32 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.035em' }}>
            How we compare
          </h2>
          <p className="text-sm" style={{ color: 'var(--t2)' }}>Other interfaces trade your privacy for convenience.</p>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--b)' }}>
          {/* Header */}
          <div className="grid grid-cols-4 px-6 py-3.5" style={{ background: 'var(--s1)', borderBottom: '1px solid var(--b)' }}>
            <div className="text-xs font-medium col-span-1" style={{ color: 'var(--t3)' }}>Feature</div>
            <div className="text-xs font-semibold text-center" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--blue-bright)' }}>Nerdplexity</div>
            <div className="text-xs font-medium text-center" style={{ color: 'var(--t3)' }}>ChatGPT</div>
            <div className="text-xs font-medium text-center" style={{ color: 'var(--t3)' }}>Claude.ai</div>
          </div>
          {/* Rows */}
          {COMPARISON.map(({ feature, nerd, gpt, claude }, i) => (
            <div
              key={feature}
              className="grid grid-cols-4 px-6 py-3.5 transition-colors"
              style={{
                background: i % 2 === 0 ? 'var(--s0)' : 'transparent',
                borderBottom: i < COMPARISON.length - 1 ? '1px solid var(--b)' : 'none',
              }}
            >
              <div className="text-xs col-span-1" style={{ color: 'var(--t2)' }}>{feature}</div>
              {[
                { v: nerd, highlight: true },
                { v: gpt,  highlight: false },
                { v: claude, highlight: false },
              ].map(({ v, highlight }, j) => (
                <div key={j} className="flex items-center justify-center">
                  {v
                    ? <Check size={14} style={{ color: highlight ? 'var(--blue-bright)' : '#4a4a4a' }} />
                    : <X size={13} style={{ color: 'var(--t4)' }} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── Analytics preview ── */}
      <section className="relative z-10 px-6 pb-32 max-w-5xl mx-auto">
        <div className="rounded-2xl p-8 md:p-10" style={{ background: 'var(--s0)', border: '1px solid var(--b)' }}>
          <div className="flex items-start justify-between mb-8 gap-4">
            <div>
              <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full text-xs font-medium"
                style={{ background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.18)', color: 'var(--blue-bright)' }}>
                PromptOps
              </div>
              <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.025em' }}>
                Full observability built in
              </h2>
              <p className="text-sm max-w-md" style={{ color: 'var(--t2)' }}>
                Every interaction measured locally. Latency, cost, quality, error rates — private analytics that stay in your browser.
              </p>
            </div>
            <Link to="/app/analytics"
              className="flex items-center gap-1 text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors"
              style={{ color: 'var(--blue-bright)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--t1)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--blue-bright)')}>
              Open dashboard <ChevronRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total calls',  value: '2,847', delta: '+12%',  up: true  },
              { label: 'Avg latency', value: '1.2s',   delta: '-8%',   up: false },
              { label: 'Helpful rate', value: '94%',   delta: '+2%',   up: true  },
              { label: 'Cost / 100',  value: '$0.14',  delta: '-18%',  up: false },
            ].map(k => (
              <div key={k.label} className="p-4 rounded-xl" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)' }}>
                <div className="t-caps mb-3">{k.label}</div>
                <div className="flex items-end justify-between gap-1">
                  <span className="text-xl font-bold leading-none" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--blue-bright)' }}>{k.value}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium mb-0.5"
                    style={{ background: k.up ? 'rgba(59,130,246,.1)' : 'rgba(239,68,68,.08)', color: k.up ? 'var(--blue-bright)' : '#f87171' }}>
                    {k.delta}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Mini chart representation */}
          <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)' }}>
            <div className="t-caps mb-3">Latency distribution — last 7 days</div>
            <div className="flex items-end gap-1.5 h-12">
              {[0.6, 0.8, 0.5, 0.9, 0.7, 1.0, 0.75, 0.4, 0.85, 0.65, 0.95, 0.5, 0.7, 0.6, 0.8, 0.9, 0.55, 0.75, 0.85, 0.7].map((v, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm transition-all"
                  style={{ height: `${v * 100}%`, background: i === 19 ? 'var(--blue)' : 'var(--s4)', minWidth: 0 }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-[10px]" style={{ color: 'var(--t4)' }}>7d ago</span>
              <span className="text-[10px]" style={{ color: 'var(--t4)' }}>today</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 px-6 pb-32 max-w-2xl mx-auto text-center">
        <div
          className="rounded-2xl p-12 md:p-14"
          style={{
            background: 'var(--s0)',
            border: '1px solid rgba(59,130,246,.15)',
            boxShadow: '0 0 80px rgba(37,99,235,.06)',
          }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-6 text-xl font-bold text-white"
            style={{ background: 'var(--blue-dark)', boxShadow: '0 0 32px rgba(37,99,235,.4)', fontFamily: 'Bricolage Grotesque, sans-serif' }}
          >N</div>

          <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.03em' }}>
            Your AI. Your keys. Your data.
          </h2>
          <p className="text-sm mb-8 leading-relaxed mx-auto max-w-sm" style={{ color: 'var(--t2)' }}>
            No sign-up. No credit card. No subscription. Paste your API key and you're talking to the world's best AI models in under a minute.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/app" className="btn-primary w-full sm:w-auto justify-center" style={{ fontSize: '15px', padding: '12px 28px' }}>
              Open Nerdplexity <ArrowRight size={15} />
            </Link>
            <Link to="/app/analytics" className="btn-ghost w-full sm:w-auto justify-center" style={{ fontSize: '14px', padding: '12px 24px' }}>
              View analytics
            </Link>
          </div>

          <div className="flex items-center justify-center gap-5 mt-8">
            {['Free forever', 'Local-first', 'Open source'].map(t => (
              <div key={t} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--t3)' }}>
                <Check size={11} style={{ color: 'var(--blue-bright)' }} />
                {t}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t" style={{ borderColor: 'var(--b)' }}>
        <div className="max-w-6xl mx-auto px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white" style={{ background: 'var(--blue-dark)' }}>N</div>
            <span className="text-xs font-semibold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t3)' }}>Nerdplexity</span>
          </div>
          <div className="flex items-center gap-6">
            {['Privacy', 'Analytics', 'Open App'].map(t => (
              <Link
                key={t}
                to={t === 'Open App' ? '/app' : t === 'Analytics' ? '/app/analytics' : '/'}
                className="text-xs transition-colors"
                style={{ color: 'var(--t4)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--t2)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--t4)')}>{t}</Link>
            ))}
          </div>
          <span className="text-xs" style={{ color: 'var(--t4)' }}>Local-first · Private by design</span>
        </div>
      </footer>
    </div>
  );
}
