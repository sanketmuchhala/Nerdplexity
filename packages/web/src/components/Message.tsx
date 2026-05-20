import React, { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { CodeBlock } from './ui';
import { ChatMessage } from '../hooks/useChat';
import { sanitizeDisplayText } from '../lib/stripEmojis';
import { WebSearchResult } from '../lib/db';

interface MessageProps {
  message: ChatMessage & {
    metadata?: { webSearchResults?: WebSearchResult[]; reasoning?: string };
  };
}

/* Shared column width — matches ChatGPT/Perplexity ~680px */
const COL = 'max-w-[680px] mx-auto w-full';

export const Message: React.FC<MessageProps> = ({ message }) => {
  const isUser   = message.role === 'user';
  const isSystem = message.role === 'system';
  const [showReasoning, setShowReasoning] = useState(false);

  if (isSystem) return null;

  const sources   = message.metadata?.webSearchResults ?? [];
  const reasoning = message.metadata?.reasoning;
  const ts = new Date(message.timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  /* ─── User message ─────────────────────────────── */
  if (isUser) {
    return (
      <div className="w-full px-4 py-5 animate-message-in">
        <div className={COL}>
          <div className="flex justify-end">
            <div
              className="max-w-[80%] rounded-2xl rounded-tr-md px-4 py-3"
              style={{
                background: 'var(--surface-3)',
                border: '1px solid var(--border-hi)',
              }}
            >
              <p className="text-[14px] leading-[1.65] text-neutral-200 whitespace-pre-wrap">
                {sanitizeDisplayText(message.content)}
              </p>
              <p className="text-[10px] text-neutral-600 mt-1.5 text-right">{ts}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Assistant message ────────────────────────── */
  return (
    <div className="w-full px-4 py-6 animate-message-in">
      <div className={COL}>
        {/* Label */}
        <div className="flex items-center gap-2 mb-3.5">
          <div
            className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(244,63,94,.12)',
              border: '1px solid rgba(244,63,94,.22)',
            }}
          >
            <span className="text-[9px] font-bold text-nerdplexity-400">N</span>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-neutral-600">
            Nerdplexity
          </span>
        </div>

        {/* Source chips — horizontal scroll */}
        {sources.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-2 scrollbar-none">
            <span className="flex-shrink-0 text-[9px] font-semibold uppercase tracking-[.1em] text-neutral-700">
              Sources
            </span>
            {sources.map((src, i) => {
              let host = src.source ?? '';
              if (!host) {
                try { host = new URL(src.url).hostname.replace('www.', ''); } catch { host = src.url; }
              }
              return (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={src.title}
                  className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-neutral-500 transition-all duration-100 hover:text-neutral-200"
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(244,63,94,.25)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                    style={{ background: 'rgba(244,63,94,.65)' }}
                  >
                    {i + 1}
                  </span>
                  <span className="max-w-[100px] truncate">{host}</span>
                  <ExternalLink size={8} className="opacity-40 flex-shrink-0" />
                </a>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div className="text-[14px] leading-[1.75] text-neutral-200">
          {formatContent(sanitizeDisplayText(message.content))}
        </div>

        {/* Reasoning */}
        {reasoning && (
          <div
            className="mt-5 rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)' }}
          >
            <button
              onClick={() => setShowReasoning(s => !s)}
              className="w-full flex items-center gap-2 px-4 py-3 text-[11px] text-neutral-600 hover:text-neutral-400 transition-colors"
              style={{ background: 'var(--surface-1)' }}
            >
              <Brain size={12} />
              <span>Thought process</span>
              {showReasoning
                ? <ChevronDown size={11} className="ml-auto" />
                : <ChevronRight size={11} className="ml-auto" />}
            </button>
            {showReasoning && (
              <div
                className="px-4 py-3 animate-slideDown"
                style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}
              >
                <p className="text-[12px] text-neutral-500 leading-relaxed whitespace-pre-wrap">
                  {reasoning}
                </p>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-neutral-700 mt-4">{ts}</p>
      </div>
    </div>
  );
};

/* ── Markdown renderer ─────────────────────────────────── */

const formatContent = (content: string): React.ReactNode => {
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
      if (code.length) out.push(<CodeBlock key={`c${i}`} code={code.join('\n')} language={lang || undefined} className="my-5" />);
      i++; continue;
    }

    if (line.trim().startsWith('> ')) {
      const ql: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) { ql.push(lines[i].trim().slice(2)); i++; }
      out.push(
        <blockquote key={`bq${i}`} className="border-l-2 border-nerdplexity-700/60 pl-4 my-3 py-1 rounded-r-lg" style={{ background: 'rgba(244,63,94,.04)' }}>
          {ql.map((q, j) => <div key={j} className="text-[14px] text-neutral-400 italic">{fmtLine(q)}</div>)}
        </blockquote>
      );
      continue;
    }

    if (line.includes('|') && line.split('|').length >= 3) {
      const rows: string[][] = [];
      let c = i;
      while (c < lines.length && lines[c].includes('|')) {
        const cells = lines[c].split('|').map(x => x.trim()).filter(Boolean);
        if (cells.length) rows.push(cells);
        c++;
      }
      if (rows.length) {
        out.push(
          <div key={`t${i}`} className="my-5 overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {rows[0].map((h, j) => (
                    <th key={j} className="px-4 py-2.5 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide" style={{ borderBottom: '1px solid var(--border)' }}>
                      {fmtLine(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).filter(r => !r.every(x => x.match(/^-+$/)) && r.length).map((r, ri) => (
                  <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                    {r.map((cell, ci) => (
                      <td key={ci} className="px-4 py-2.5 text-neutral-300">{fmtLine(cell)}</td>
                    ))}
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
        <div key={i} className="my-1 leading-[1.75]">
          {parts.map((p, j) =>
            j % 2 === 1
              ? <code key={j} className="px-1.5 py-0.5 rounded text-[13px] font-mono text-nerdplexity-300" style={{ background: 'rgba(244,63,94,.08)', border: '1px solid rgba(244,63,94,.15)' }}>{p}</code>
              : fmtLine(p)
          )}
        </div>
      );
      i++; continue;
    }

    out.push(<div key={i} className="my-0.5 leading-[1.75]">{fmtLine(line)}</div>);
    i++;
  }

  return <div>{out}</div>;
};

const fmtLine = (line: string): React.ReactNode => {
  if (!line.trim()) return <br />;
  if (line.startsWith('#### ')) return <h4 className="text-[14px] font-semibold text-neutral-100 mt-5 mb-1.5">{fmtInline(line.slice(5))}</h4>;
  if (line.startsWith('### '))  return <h3 className="text-[15px] font-semibold text-neutral-100 mt-6 mb-2">{fmtInline(line.slice(4))}</h3>;
  if (line.startsWith('## '))   return <h2 className="text-[17px] font-semibold text-neutral-100 mt-7 mb-2.5">{fmtInline(line.slice(3))}</h2>;
  if (line.startsWith('# '))    return <h1 className="text-[20px] font-bold text-white mt-8 mb-3 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>{fmtInline(line.slice(2))}</h1>;

  const num = line.match(/^(\s*)(\d+)\.\s(.+)/);
  if (num) {
    const level = Math.floor((num[1]?.length ?? 0) / 2);
    return (
      <div className="flex gap-3 my-1" style={{ marginLeft: `${level * 1.5}rem` }}>
        <span className="flex-shrink-0 text-nerdplexity-500 font-medium text-[13px] min-w-[1.25rem] text-right">{num[2]}.</span>
        <span className="text-[14px] text-neutral-200">{fmtInline(num[3])}</span>
      </div>
    );
  }

  if (line.trim().match(/^[-•*]\s/)) {
    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    const level = Math.floor(indent.length / 2);
    const content = line.trim().slice(2);
    return (
      <div className="flex items-start gap-3 my-1" style={{ marginLeft: `${level * 1.5}rem` }}>
        <span className="flex-shrink-0 mt-[9px] w-1 h-1 rounded-full bg-nerdplexity-600 block" />
        <span className="text-[14px] text-neutral-200">{fmtInline(content)}</span>
      </div>
    );
  }

  return <span className="text-[14px] text-neutral-200">{fmtInline(line)}</span>;
};

const fmtInline = (text: string): React.ReactNode => {
  if (text.includes('**')) {
    const parts = text.split('**');
    if (parts.length > 1) return <>{parts.map((p, i) => i % 2 === 1 ? <strong key={i} className="font-semibold text-neutral-100">{p}</strong> : p)}</>;
  }
  if (text.includes('*') && !text.includes('**')) {
    const parts = text.split('*');
    if (parts.length % 2 === 1 && parts.length > 1) return <>{parts.map((p, i) => i % 2 === 1 ? <em key={i} className="italic text-neutral-300">{p}</em> : p)}</>;
  }
  const linkRe = /(\[[^\]]+\]\([^)]+\))/g;
  if (linkRe.test(text)) {
    return <>{text.split(linkRe).map((p, i) => {
      const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      return m
        ? <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-nerdplexity-400 hover:text-nerdplexity-300 underline underline-offset-2 decoration-nerdplexity-700 transition-colors">{m[1]}</a>
        : p;
    })}</>;
  }
  return text;
};
