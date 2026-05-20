import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Copy, Check } from 'lucide-react';

interface Props { code: string; language?: string; className?: string; }

export function CodeBlock({ code, language, className }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {} };

  return (
    <div className={cn('rounded-xl overflow-hidden', className)} style={{ border:'1px solid var(--b-hi)' }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background:'var(--s3)', borderBottom:'1px solid var(--b)' }}>
        <span className="t-caps">{language || 'code'}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-all"
          style={{ color: copied ? 'var(--blue-bright)' : 'var(--t3)' }}
          onMouseEnter={e=>{ if(!copied) (e.currentTarget as HTMLElement).style.background='var(--s4)'; }}
          onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.background='transparent'; }}>
          {copied ? <><Check size={11}/> Copied</> : <><Copy size={11}/> Copy</>}
        </button>
      </div>
      <pre style={{ background:'var(--s2)', margin:0, overflowX:'auto', maxHeight:'380px' }}>
        <code className="block p-4 text-sm leading-relaxed whitespace-pre t-mono" style={{ color:'var(--t1)' }}>{code}</code>
      </pre>
    </div>
  );
}
export const CodeBlockLegacy = CodeBlock;
