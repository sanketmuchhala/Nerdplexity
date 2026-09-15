import { isValidElement, useState, type ReactNode } from 'react';
import { ExternalLink, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import Markdown, { type Components, defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
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
  const [showReasoning, setShowReasoning] = useState(true);

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
            <div className="max-w-[78%] px-5 py-3.5 rounded-[22px]"
              style={{ background: 'var(--s2)' }}>
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--t1)' }}>
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

/* CommonMark plus GFM. Raw HTML is ignored and the resulting tree is sanitized;
 * provider output never reaches dangerouslySetInnerHTML. */
const markdownComponents: Components = {
  a: ({ href, children, ...props }) => <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }) => <span className="np-markdown-image">[Image: {alt || 'unnamed'}]</span>,
  pre: ({ children }) => {
    if (isValidElement<{ children?: ReactNode; className?: string }>(children)) {
      const language = /language-([^\s]+)/.exec(children.props.className ?? '')?.[1];
      const code = String(children.props.children ?? '').replace(/\n$/, '');
      return <CodeBlock code={code} language={language} className="my-5" />;
    }
    return <pre>{children}</pre>;
  },
};

function safeMarkdownUrl(url: string): string {
  if (/^(https?:|mailto:)/i.test(url) || url.startsWith('#')) return defaultUrlTransform(url);
  return '';
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="np-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={markdownComponents}
        skipHtml
        urlTransform={safeMarkdownUrl}
      >
        {content}
      </Markdown>
    </div>
  );
}

function formatContent(content: string) {
  return <MarkdownContent content={content} />;
}
