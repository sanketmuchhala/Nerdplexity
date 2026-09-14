import { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { CodeBlock } from './ui/CodeBlock';
import type { Message as StoredMessage, WebSearchResult } from '../lib/db';
import ModelLogo, { formatModelName } from '../workspace/ModelLogo';

interface Props {
  message: Omit<StoredMessage, 'createdAt'> & { timestamp: number; metadata?: { webSearchResults?: WebSearchResult[]; reasoning?: string } };
  /** Skip the entrance animation when the message replaces text already on screen. */
  animate?: boolean;
  /** The model that wrote an assistant answer, when known; its logo and name head the answer. */
  model?: { id: string; displayName?: string; provider: string };
  /** The answer is still arriving: show a caret after the text. */
  streaming?: boolean;
}

const COL = 'w-full max-w-[680px] mx-auto';
const ACCENT = (alpha: number) => `rgba(var(--np-accent-rgb), ${alpha})`;

export function Message({ message, animate = true, model, streaming = false }: Props) {
  const isUser   = message.role === 'user';
  const isSystem = message.role === 'system';
  const [showReasoning, setShowReasoning] = useState(false);

  if (isSystem) return null;

  const sources   = message.metadata?.webSearchResults ?? [];
  const reasoning = message.metadata?.reasoning;
  const ts = new Date(message.timestamp).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });

  /* ── User ── */
  if (isUser) {
    return (
      <div className={`w-full px-4 py-4 ${animate ? 'animate-message-in' : ''}`}>
        <div className={COL}>
          <div className="flex justify-end">
            <div className="max-w-[85%] px-5 py-3.5 rounded-[24px]"
              style={{ background: 'var(--s2)' }}>
              <p className="text-[15px] leading-[1.65] whitespace-pre-wrap" style={{ color: 'var(--t1)', overflowWrap: 'break-word' }}>
                {message.content}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Assistant ── */
  return (
    <div className={`w-full px-4 py-6 ${animate ? 'animate-message-in' : ''}`}>
      <div className={COL}>
        {/* Label */}
        <div className="flex items-center gap-3 mb-4 np-answer-label">
          {model ? (
            <ModelLogo modelId={model.id} provider={model.provider} size={26} />
          ) : (
            <img
              src="/brand/nerdplexity-mark.svg"
              alt=""
              width={26}
              height={26}
              className="h-[26px] w-[26px] flex-shrink-0 rounded-lg"
            />
          )}
          <span className="text-[15px] font-medium" style={{ color: 'var(--t1)' }}>
            {model ? formatModelName(model.displayName, model.id) : 'Nerdplexity'}
          </span>
        </div>

        {/* Reasoning is a separate, complete stream and always precedes the answer. */}
        {reasoning && (
          <section
            className={`np-reasoning ${streaming ? 'live' : 'complete'}`}
            role="region"
            aria-label={streaming ? 'Thinking live' : 'Thought process'}
          >
            {streaming ? (
              <div className="np-reasoning-heading" role="status">
                <Brain size={13} />
                <span className="np-reasoning-pulse" aria-hidden="true" />
                <strong>Thinking live</strong>
                <span className="np-reasoning-state">Streaming</span>
                <ChevronDown size={12} className="ml-auto" />
              </div>
            ) : (
              <button
                type="button"
                className="np-reasoning-heading"
                aria-expanded={showReasoning}
                aria-controls={`reasoning-${message.id}`}
                onClick={() => setShowReasoning(value => !value)}
              >
                <Brain size={13} />
                <strong>Thought process</strong>
                <span className="np-reasoning-state">Complete</span>
                {showReasoning ? <ChevronDown size={12} className="ml-auto" /> : <ChevronRight size={12} className="ml-auto" />}
              </button>
            )}
            {(streaming || showReasoning) && (
              <div id={`reasoning-${message.id}`} className="np-reasoning-body">
                {formatContent(reasoning)}
                {streaming && <span className="np-reasoning-caret" aria-hidden="true" />}
              </div>
            )}
          </section>
        )}

        {/* Source chips */}
        {sources.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-1.5 scrollbar-none">
            <span className="t-caps flex-shrink-0">Sources</span>
            {sources.map((src, i) => {
              let host = src.source ?? '';
              if (!host) { try { host = new URL(src.url).hostname.replace('www.',''); } catch { host = src.url; } }
              return (
                <a key={i} href={src.url} target="_blank" rel="noopener noreferrer"
                  className="flex-shrink-0 flex items-center gap-1.5 text-[11px] rounded-full transition-all"
                  style={{ padding: '3px 10px 3px 6px', background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t3)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = ACCENT(.3); (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--b-hi)'; (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; }}
                >
                  <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                    style={{ background: ACCENT(.6), color: 'var(--np-on-accent)' }}>{i+1}</span>
                  <span className="max-w-[100px] truncate">{host}</span>
                  <ExternalLink size={8} className="opacity-40 flex-shrink-0" />
                </a>
              );
            })}
          </div>
        )}

        {reasoning && message.content && <div className="np-answer-heading">Answer</div>}

        {/* Content */}
        <div className={`np-answer-content text-[15px] leading-[1.75] ${streaming ? 'np-streaming' : ''}`} style={{ color: 'var(--t1)' }}>
          {/* Show model output exactly as received. */}
          {formatContent(message.content)}
        </div>

        <p className="text-[10px] mt-3.5" style={{ color: 'var(--t4)' }}>{ts}</p>
      </div>
    </div>
  );
}

/* ── Markdown renderer ── */
function formatContent(content: string) {
  const lines = content.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++; }
      if (code.length) out.push(<CodeBlock key={`c${i}`} code={code.join('\n')} language={lang||undefined} className="my-5" />);
      i++; continue;
    }

    if (line.trim().startsWith('> ')) {
      const ql: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) { ql.push(lines[i].trim().slice(2)); i++; }
      out.push(
        <blockquote key={`bq${i}`} className="my-3 py-1 pl-4 rounded-r-lg"
          style={{ borderLeft: `2px solid ${ACCENT(.4)}`, background: ACCENT(.04) }}>
          {ql.map((q,j) => <div key={j} className="text-sm italic" style={{ color: 'var(--t2)' }}>{fmtLine(q)}</div>)}
        </blockquote>
      );
      continue;
    }

    if (line.includes('|') && line.split('|').length >= 3) {
      const rows: string[][] = [];
      let c = i;
      while (c < lines.length && lines[c].includes('|')) {
        const cells = lines[c].split('|').map(x=>x.trim()).filter(Boolean);
        if (cells.length) rows.push(cells);
        c++;
      }
      if (rows.length) {
        out.push(
          <div key={i} className="my-6 overflow-x-auto rounded-[16px] shadow-sm" style={{ border:'1px solid rgba(var(--np-contrast-rgb), 0.12)' }}>
            <table className="w-full text-left border-collapse" style={{ minWidth:'500px' }}>
              <thead style={{ background:'color-mix(in srgb, var(--np-raised) 50%, transparent)' }}>
                <tr>
                  {rows[0].map((h,j) => <th key={j} className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider" style={{ borderBottom:'1px solid rgba(var(--np-contrast-rgb), 0.12)', color:'var(--np-muted)' }}>{fmtLine(h)}</th>)}
                </tr>
              </thead>
              <tbody style={{ background:'var(--np-panel)' }}>
                {rows.slice(1).filter(r => !r.every(x=>x.match(/^-+$/)) && r.length).map((r,ri) => (
                  <tr key={ri} className="transition-colors hover:bg-[rgba(var(--np-contrast-rgb),0.02)]" style={{ borderBottom:'1px solid rgba(var(--np-contrast-rgb), 0.06)' }}>
                    {r.map((cell,ci) => <td key={ci} className="px-5 py-3.5 text-[14px]" style={{ color:'var(--t1)' }}>{fmtLine(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        i = c; continue;
      }
    }

    if (line.includes('`') && !line.includes('```')) {
      const parts = line.split('`');
      out.push(
        <div key={i} className="my-0.5 leading-[1.75]">
          {parts.map((p,j) => j%2===1
            ? <code key={j} className="text-[13px] px-1.5 py-0.5 mx-0.5 rounded-md t-mono font-medium" style={{ background: 'rgba(var(--np-contrast-rgb), 0.08)', border:`1px solid rgba(var(--np-contrast-rgb), 0.05)`, color:'var(--t1)' }}>{p}</code>
            : fmtLine(p))}
        </div>
      );
      i++; continue;
    }

    out.push(<div key={i} className="my-0.5 leading-[1.8]">{fmtLine(line)}</div>);
    i++;
  }
  return <div>{out}</div>;
}

function fmtLine(line: string): React.ReactNode {
  if (!line.trim()) return <br />;
  if (line.startsWith('#### ')) return <h4 className="text-sm font-semibold mt-4 mb-1" style={{ fontFamily:'Bricolage Grotesque, sans-serif', color:'var(--t1)' }}>{fmtInline(line.slice(5))}</h4>;
  if (line.startsWith('### '))  return <h3 className="text-base font-semibold mt-5 mb-1.5" style={{ fontFamily:'Bricolage Grotesque, sans-serif', color:'var(--t1)' }}>{fmtInline(line.slice(4))}</h3>;
  if (line.startsWith('## '))   return <h2 className="text-lg font-semibold mt-6 mb-2" style={{ fontFamily:'Bricolage Grotesque, sans-serif', color:'var(--t1)' }}>{fmtInline(line.slice(3))}</h2>;
  if (line.startsWith('# '))    return <h1 className="text-xl font-bold mt-7 mb-2.5 pb-2" style={{ fontFamily:'Bricolage Grotesque, sans-serif', color:'var(--t1)', borderBottom:'1px solid var(--b-hi)' }}>{fmtInline(line.slice(2))}</h1>;

  const num = line.match(/^(\s*)(\d+)\.\s(.+)/);
  if (num) {
    const level = Math.floor((num[1]?.length??0)/2);
    return <div className="flex gap-3 my-1" style={{ marginLeft:`${level*1.5}rem` }}>
      <span className="flex-shrink-0 font-medium text-sm min-w-[1.25rem] text-right" style={{ color:'var(--blue-bright)' }}>{num[2]}.</span>
      <span style={{ color:'var(--t1)' }}>{fmtInline(num[3])}</span>
    </div>;
  }
  if (line.trim().match(/^[-•*]\s/)) {
    const level = Math.floor((line.match(/^(\s*)/)?.[1]?.length??0)/2);
    const content = line.trim().slice(2);
    return <div className="flex items-start gap-3 my-1" style={{ marginLeft:`${level*1.5}rem` }}>
      <span className="flex-shrink-0 mt-2.5 w-1.5 h-1.5 rounded-full" style={{ background: ACCENT(.6), flexShrink:0 }} />
      <span style={{ color:'var(--t1)' }}>{fmtInline(content)}</span>
    </div>;
  }
  return <span style={{ color:'var(--t1)' }}>{fmtInline(line)}</span>;
}

function fmtInline(text: string): React.ReactNode {
  if (text.includes('**')) {
    const parts = text.split('**');
    if (parts.length>1) return <>{parts.map((p,i) => i%2===1 ? <strong key={i} className="font-semibold" style={{ color:'var(--t1)' }}>{p}</strong> : p)}</>;
  }
  if (text.includes('*') && !text.includes('**')) {
    const parts = text.split('*');
    if (parts.length%2===1 && parts.length>1) return <>{parts.map((p,i) => i%2===1 ? <em key={i} className="italic" style={{ color:'var(--t2)' }}>{p}</em> : p)}</>;
  }
  const linkRe = /(\[[^\]]+\]\([^)]+\))/g;
  if (linkRe.test(text)) {
    return <>{text.split(linkRe).map((p,i) => {
      const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (!m || !/^(https?:|mailto:)/i.test(m[2].trim())) return p;
      return <a key={i} href={m[2].trim()} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 transition-colors" style={{ color:'var(--blue-bright)', textDecorationColor: ACCENT(.4) }}>{m[1]}</a>;
    })}</>;
  }
  return text;
}
