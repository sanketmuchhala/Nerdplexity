import React, { useState } from 'react';
import { cn } from '../../lib/utils';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, className }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  };

  return (
    <div
      className={cn('rounded-xl overflow-hidden', className)}
      style={{ border: '1px solid var(--b-hi)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'var(--s3)', borderBottom: '1px solid var(--b)' }}
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--t3)' }}
        >
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-all"
          style={{ color: copied ? '#8fa5ff' : 'var(--t3)' }}
          onMouseEnter={e => { if (!copied) (e.currentTarget as HTMLElement).style.background = 'var(--s4)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Code */}
      <pre style={{ background: 'var(--s2)', margin: 0, overflowX: 'auto', maxHeight: '380px' }}>
        <code
          className="block p-4 text-sm font-mono leading-relaxed whitespace-pre"
          style={{ color: 'var(--t1)', fontFamily: "'DM Mono', 'JetBrains Mono', monospace" }}
        >
          {code}
        </code>
      </pre>
    </div>
  );
};
