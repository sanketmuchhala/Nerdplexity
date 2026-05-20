import React, { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { CodeBlock } from './ui';
import { ChatMessage } from '../hooks/useChat';
import { sanitizeDisplayText } from '../lib/stripEmojis';
import { WebSearchResult } from '../lib/db';

interface MessageProps {
  message: ChatMessage & {
    metadata?: {
      webSearchResults?: WebSearchResult[];
      reasoning?: string;
    };
  };
}

export const Message: React.FC<MessageProps> = ({ message }) => {
  const isUser   = message.role === 'user';
  const isSystem = message.role === 'system';
  const [showReasoning, setShowReasoning] = useState(false);

  if (isSystem) return null;

  const sources  = message.metadata?.webSearchResults ?? [];
  const reasoning = message.metadata?.reasoning;

  /* ── User bubble ── */
  if (isUser) {
    return (
      <div className="flex justify-end px-6 py-3 animate-message-in">
        <div
          className="
            max-w-[72%] px-4 py-3
            bg-neutral-800 border border-neutral-700/80
            rounded-2xl rounded-tr-sm
            text-sm text-neutral-100 leading-relaxed
            whitespace-pre-wrap break-words
          "
        >
          {sanitizeDisplayText(message.content)}
        </div>
      </div>
    );
  }

  /* ── Assistant response ── */
  return (
    <div className="px-6 py-5 animate-message-in">
      <div className="max-w-3xl mx-auto">
        {/* Label */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
            Nerdplexity
          </span>
        </div>

        {/* Source chips — horizontal scroll, above content */}
        {sources.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-1 scrollbar-none">
            <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
              Sources
            </span>
            {sources.map((src, i) => (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                title={src.title}
                className="
                  flex-shrink-0 flex items-center gap-1.5
                  px-2.5 py-1 rounded-full
                  border border-neutral-700 bg-neutral-850
                  text-[11px] text-neutral-400
                  hover:border-nerdplexity-500/40 hover:text-neutral-200
                  hover:bg-neutral-800 transition-all duration-100
                "
              >
                <span
                  className="
                    flex-shrink-0 w-3.5 h-3.5 rounded-full
                    bg-nerdplexity-600 text-white
                    flex items-center justify-center
                    text-[8px] font-bold
                  "
                >
                  {i + 1}
                </span>
                <span className="max-w-[96px] truncate">
                  {src.source ?? (() => {
                    try { return new URL(src.url).hostname.replace('www.', ''); } catch { return src.url; }
                  })()}
                </span>
                <ExternalLink size={9} className="opacity-50 flex-shrink-0" />
              </a>
            ))}
          </div>
        )}

        {/* Main content */}
        <div className="text-sm text-neutral-200 leading-relaxed">
          {formatContent(sanitizeDisplayText(message.content))}
        </div>

        {/* Reasoning toggle */}
        {reasoning && (
          <div className="mt-4 border border-neutral-700/60 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowReasoning(s => !s)}
              className="
                w-full flex items-center gap-2 px-4 py-2.5
                text-xs text-neutral-500 hover:text-neutral-300
                hover:bg-neutral-800/40 transition-colors
              "
            >
              <Brain size={13} />
              <span>Thought process</span>
              {showReasoning
                ? <ChevronDown size={12} className="ml-auto" />
                : <ChevronRight size={12} className="ml-auto" />}
            </button>
            {showReasoning && (
              <div className="px-4 py-3 bg-neutral-850 border-t border-neutral-700/60 animate-slideDown">
                <p className="text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap">
                  {reasoning}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className="mt-3 text-[10px] text-neutral-600">
          {new Date(message.timestamp).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────
   Markdown renderer
──────────────────────────────────────────────────────────── */

const formatContent = (content: string): React.ReactNode => {
  const lines    = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const language  = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (codeLines.length > 0) {
        elements.push(
          <CodeBlock
            key={`code-${i}`}
            code={codeLines.join('\n')}
            language={language || undefined}
            className="my-4"
          />
        );
      }
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-2 border-nerdplexity-600/60 pl-4 py-1 my-3 bg-nerdplexity-950/20 rounded-r-lg"
        >
          {quoteLines.map((ql, idx) => (
            <div key={idx} className="text-neutral-300 italic text-sm my-0.5">
              {formatTextLine(ql)}
            </div>
          ))}
        </blockquote>
      );
      continue;
    }

    // Table
    if (line.includes('|') && line.split('|').length >= 3) {
      const tableRows: string[][] = [];
      let cur = i;
      while (cur < lines.length && lines[cur].includes('|')) {
        const cells = lines[cur].split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length > 0) tableRows.push(cells);
        cur++;
      }
      if (tableRows.length > 0) {
        elements.push(
          <div key={`table-${i}`} className="my-4 overflow-x-auto">
            <table className="min-w-full border border-neutral-700 rounded-xl overflow-hidden text-sm">
              <thead className="bg-neutral-850">
                <tr>
                  {tableRows[0].map((h, idx) => (
                    <th key={idx} className="px-4 py-2.5 text-left text-neutral-200 font-semibold border-b border-neutral-700 text-xs uppercase tracking-wide">
                      {formatTextLine(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.slice(1)
                  .filter(row => !row.every(c => c.match(/^-+$/)) && row.length > 0)
                  .map((row, ri) => (
                    <tr key={ri} className="border-b border-neutral-700/60 hover:bg-neutral-800/30">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-4 py-2.5 text-neutral-300">
                          {formatTextLine(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        );
        i = cur;
        continue;
      }
    }

    // Inline code line
    if (line.includes('`') && !line.includes('```')) {
      const parts = line.split('`');
      const formatted = parts.map((part, idx) =>
        idx % 2 === 1
          ? <code key={idx} className="px-1.5 py-0.5 bg-neutral-800 text-nerdplexity-300 rounded text-[13px] font-mono border border-neutral-700/60">{part}</code>
          : formatTextLine(part)
      );
      elements.push(<div key={i} className="my-1.5 leading-relaxed">{formatted}</div>);
      i++;
      continue;
    }

    elements.push(
      <div key={i} className="my-1 leading-relaxed">
        {formatTextLine(line)}
      </div>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
};

const formatTextLine = (line: string): React.ReactNode => {
  if (!line.trim()) return <br />;

  // Headers
  if (line.trim().startsWith('#### ')) return <h4 className="text-sm font-semibold text-neutral-100 mt-4 mb-1.5">{line.trim().slice(5)}</h4>;
  if (line.trim().startsWith('### '))  return <h3 className="text-base font-semibold text-neutral-100 mt-5 mb-2">{line.trim().slice(4)}</h3>;
  if (line.trim().startsWith('## '))   return <h2 className="text-lg font-semibold text-neutral-100 mt-6 mb-2">{line.trim().slice(3)}</h2>;
  if (line.trim().startsWith('# '))    return <h1 className="text-xl font-bold text-white mt-7 mb-3 border-b border-neutral-700 pb-2">{line.trim().slice(2)}</h1>;

  // Numbered list
  const numMatch = line.match(/^(\s*)(\d+)\.\s(.+)/);
  if (numMatch) {
    const [, indent, number, content] = numMatch;
    const level = Math.floor(indent.length / 2);
    return (
      <div className="flex items-start gap-2.5 my-0.5" style={{ marginLeft: `${level * 1.25}rem` }}>
        <span className="flex-shrink-0 text-nerdplexity-400 font-medium min-w-[1.25rem] text-right text-sm">{number}.</span>
        <span className="text-neutral-200 text-sm">{formatInlineText(content)}</span>
      </div>
    );
  }

  // Bullet
  if (line.trim().startsWith('- ') || line.trim().startsWith('• ') || line.trim().startsWith('* ')) {
    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    const level  = Math.floor(indent.length / 2);
    const content = line.trim().slice(2);
    return (
      <div className="flex items-start gap-2.5 my-0.5" style={{ marginLeft: `${level * 1.25}rem` }}>
        <span className="flex-shrink-0 text-nerdplexity-500 mt-1.5 w-1 h-1 rounded-full bg-current block" />
        <span className="text-neutral-200 text-sm">{formatInlineText(content)}</span>
      </div>
    );
  }

  // Task list
  if (line.trim().startsWith('- [ ]') || line.trim().startsWith('- [x]') || line.trim().startsWith('- [X]')) {
    const checked = line.includes('[x]') || line.includes('[X]');
    const content = line.replace(/^(\s*)-\s*\[[xX\s]\]\s*/, '');
    return (
      <div className="flex items-start gap-2.5 my-0.5">
        <input type="checkbox" checked={checked} readOnly className="mt-1 rounded border-neutral-600 bg-neutral-800 accent-nerdplexity-500" />
        <span className={`text-sm ${checked ? 'line-through text-neutral-500' : 'text-neutral-200'}`}>
          {formatInlineText(content)}
        </span>
      </div>
    );
  }

  return <span className="text-neutral-200 text-sm">{formatInlineText(line)}</span>;
};

const formatInlineText = (text: string): React.ReactNode => {
  // Bold
  if (text.includes('**')) {
    const parts = text.split('**');
    const nodes = parts.map((part, i) =>
      i % 2 === 1
        ? <strong key={`b${i}`} className="font-semibold text-neutral-100">{part}</strong>
        : part
    );
    if (nodes.some(n => typeof n !== 'string')) return <>{nodes}</>;
  }

  // Italic
  if (text.includes('*') && !text.includes('**')) {
    const parts = text.split('*');
    if (parts.length % 2 === 1) {
      const nodes = parts.map((part, i) =>
        i % 2 === 1
          ? <em key={`em${i}`} className="italic text-neutral-300">{part}</em>
          : part
      );
      return <>{nodes}</>;
    }
  }

  // Links
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  if (linkRegex.test(text)) {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return (
      <>
        {parts.map((part, i) => {
          const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
          if (m) {
            return (
              <a
                key={i}
                href={m[2]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-nerdplexity-400 hover:text-nerdplexity-300 underline decoration-nerdplexity-500/40 underline-offset-2 transition-colors"
              >
                {m[1]}
              </a>
            );
          }
          return part;
        })}
      </>
    );
  }

  return text;
};
