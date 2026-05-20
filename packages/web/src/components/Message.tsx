import { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { CodeBlock } from './ui/CodeBlock';
import { ChatMessage } from '../hooks/useChat';
import { sanitizeDisplayText } from '../lib/stripEmojis';
import { WebSearchResult } from '../lib/db';

interface Props {
  message: ChatMessage & { metadata?: { webSearchResults?: WebSearchResult[]; reasoning?: string } };
}

const COL = 'w-full max-w-[680px] mx-auto';

export function Message({ message }: Props) {
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
      <div className="w-full px-4 py-4 animate-message-in">
        <div className={COL}>
          <div className="flex justify-end">
            <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-tr-sm"
              style={{ background: 'var(--s3)', border: '1px solid var(--b-hi)' }}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--t1)' }}>
                {sanitizeDisplayText(message.content)}
              </p>
              <p className="text-[10px] mt-1.5 text-right" style={{ color: 'var(--t4)' }}>{ts}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Assistant ── */
  return (
    <div className="w-full px-4 py-6 animate-message-in">
      <div className={COL}>
        {/* Label */}
        <div className="flex items-center gap-2 mb-3.5">
          <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-white"
            style={{ background: 'var(--blue-dark)', boxShadow: '0 0 8px rgba(59,130,246,.3)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>N</div>
          <span className="t-caps" style={{ letterSpacing: '.1em' }}>Nerdplexity</span>
        </div>

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
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,.3)'; (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--b-hi)'; (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; }}
                >
                  <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                    style={{ background: 'rgba(59,130,246,.6)' }}>{i+1}</span>
                  <span className="max-w-[100px] truncate">{host}</span>
                  <ExternalLink size={8} className="opacity-40 flex-shrink-0" />
                </a>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div className="text-sm leading-[1.8]" style={{ color: 'var(--t1)' }}>
          {formatContent(sanitizeDisplayText(message.content))}
        </div>

        {/* Reasoning */}
        {reasoning && (
          <div className="mt-4 rounded-xl overflow-hidden" style={{ border: '1px solid var(--b)' }}>
            <button onClick={() => setShowReasoning(s => !s)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs transition-colors"
              style={{ background: 'var(--s1)', color: 'var(--t3)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t3)'}
            >
              <Brain size={12} />
              <span>Thought process</span>
              {showReasoning ? <ChevronDown size={11} className="ml-auto" /> : <ChevronRight size={11} className="ml-auto" />}
            </button>
            {showReasoning && (
              <div className="px-4 py-3 animate-slideDown" style={{ background: 'var(--s0)', borderTop: '1px solid var(--b)' }}>
                <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--t3)' }}>{reasoning}</p>
              </div>
            )}
          </div>
        )}

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
          style={{ borderLeft: '2px solid rgba(59,130,246,.4)', background: 'rgba(59,130,246,.04)' }}>
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
          <div key={`t${i}`} className="my-5 overflow-x-auto rounded-xl" style={{ border: '1px solid var(--b-hi)' }}>
            <table className="w-full text-sm" style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--s2)' }}>
                  {rows[0].map((h,j) => <th key={j} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ borderBottom:'1px solid var(--b-hi)', color:'var(--t2)' }}>{fmtLine(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).filter(r => !r.every(x=>x.match(/^-+$/)) && r.length).map((r,ri) => (
                  <tr key={ri} style={{ borderBottom:'1px solid var(--b)' }}>
                    {r.map((cell,ci) => <td key={ci} className="px-4 py-2.5 text-sm" style={{ color:'var(--t1)' }}>{fmtLine(cell)}</td>)}
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
        <div key={i} className="my-0.5 leading-[1.8]">
          {parts.map((p,j) => j%2===1
            ? <code key={j} className="text-sm px-1.5 py-0.5 rounded t-mono" style={{ background: 'rgba(59,130,246,.1)', border:'1px solid rgba(59,130,246,.2)', color:'var(--blue-bright)' }}>{p}</code>
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
      <span className="text-sm" style={{ color:'var(--t1)' }}>{fmtInline(num[3])}</span>
    </div>;
  }
  if (line.trim().match(/^[-•*]\s/)) {
    const level = Math.floor((line.match(/^(\s*)/)?.[1]?.length??0)/2);
    const content = line.trim().slice(2);
    return <div className="flex items-start gap-3 my-1" style={{ marginLeft:`${level*1.5}rem` }}>
      <span className="flex-shrink-0 mt-2.5 w-1.5 h-1.5 rounded-full" style={{ background:'rgba(59,130,246,.6)', flexShrink:0 }} />
      <span className="text-sm" style={{ color:'var(--t1)' }}>{fmtInline(content)}</span>
    </div>;
  }
  return <span className="text-sm" style={{ color:'var(--t1)' }}>{fmtInline(line)}</span>;
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
      return m ? <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 transition-colors" style={{ color:'var(--blue-bright)', textDecorationColor:'rgba(59,130,246,.4)' }}>{m[1]}</a> : p;
    })}</>;
  }
  return text;
}
