import React, { useState } from 'react';
import { cn } from '../../lib/utils';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ 
  code, 
  language, 
  className 
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <div className={cn('relative group rounded-xl overflow-hidden border border-neutral-700/80', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-850 border-b border-neutral-700/60">
        <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-all"
          title="Copy"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check size={12} className="text-nerdplexity-400" />
              <span className="text-nerdplexity-400">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code */}
      <pre className="bg-neutral-900 overflow-x-auto max-h-96 overflow-y-auto">
        <code className="block p-4 text-sm font-mono text-neutral-200 leading-relaxed whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  );
};