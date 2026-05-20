import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Cpu } from "lucide-react";

interface ThinkingHUDProps {
  running: boolean;
  elapsedMs: number;
  tokensPerSec?: number;
  phase?: "Planning" | "Drafting" | "Refining";
  summary?: string;
}

const phaseColors: Record<string, string> = {
  Planning: '#4e6bff',
  Drafting:  '#6b85ff',
  Refining:  '#8fa5ff',
};

export default function ThinkingHUD({ running, elapsedMs, tokensPerSec, phase = "Planning", summary }: ThinkingHUDProps) {
  const [dots, setDots]         = useState(0);
  const [progress, setProgress] = useState(0);
  const [detail, setDetail]     = useState('');
  const [expanded, setExpanded] = useState(false);

  const details = [
    'Analyzing context…',
    'Processing request…',
    'Synthesizing response…',
    'Refining output…',
    'Validating logic…',
  ];

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setDots(d => (d + 1) % 4), 500);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setProgress(p => Math.min(p + (p < 50 ? 7 : p < 80 ? 3 : 1), 94)), 300);
    return () => clearInterval(t);
  }, [running, phase]);

  useEffect(() => { setProgress(0); }, [phase]);

  useEffect(() => {
    if (!running) return;
    let idx = 0;
    setDetail(details[0]);
    const t = setInterval(() => { idx = (idx + 1) % details.length; setDetail(details[idx]); }, 1400);
    return () => clearInterval(t);
  }, [running]);

  if (!running) return null;

  const fmt = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  const color = phaseColors[phase] ?? '#4e6bff';

  return (
    <div
      className="my-3 rounded-xl overflow-hidden"
      style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)' }}
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <Cpu size={14} style={{ color }} className="animate-spin-slow" />
            <span className="text-sm font-medium" style={{ color }}>
              {phase}{'·'.repeat(dots + 1)}
            </span>
            <span className="text-xs" style={{ color: 'var(--t3)' }}>
              {fmt(elapsedMs)}
            </span>
            {tokensPerSec != null && tokensPerSec > 0 && (
              <span className="text-xs font-mono" style={{ color: 'var(--blue-hi)' }}>
                {tokensPerSec.toFixed(1)} tok/s
              </span>
            )}
          </div>
          {summary && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-xs transition-colors"
              style={{ color: 'var(--t3)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t3)'}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Details
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-0.5 rounded-full overflow-hidden mb-2" style={{ background: 'var(--s4)' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, background: color }}
          />
        </div>

        <p className="text-xs animate-thinking-text" style={{ color: 'var(--t3)' }}>
          {detail}
        </p>
      </div>

      {summary && expanded && (
        <div className="px-4 pb-3 pt-0 border-t animate-slideDown" style={{ borderColor: 'var(--b)' }}>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--t2)' }}>{summary}</p>
        </div>
      )}
    </div>
  );
}
