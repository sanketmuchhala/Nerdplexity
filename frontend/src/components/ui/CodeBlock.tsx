import { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { Copy, Check } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-markdown';
import 'prism-themes/themes/prism-one-dark.css';

interface Props { code: string; language?: string; className?: string; }

export function CodeBlock({ code, language, className }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { 
    try { 
      await navigator.clipboard.writeText(code); 
      setCopied(true); 
      setTimeout(()=>setCopied(false),2000); 
    } catch {} 
  };

  const highlightedCode = useMemo(() => {
    let lang = language || 'plaintext';
    // Map common aliases
    if (lang === 'js') lang = 'javascript';
    if (lang === 'ts') lang = 'typescript';
    if (lang === 'py') lang = 'python';
    if (lang === 'sh') lang = 'bash';

    const grammar = Prism.languages[lang] || Prism.languages.javascript; // fallback
    return Prism.highlight(code, grammar, lang);
  }, [code, language]);

  return (
    <div className={cn('rounded-[16px] overflow-hidden my-5 shadow-sm', className)} style={{ border:'1px solid rgba(var(--np-contrast-rgb), 0.12)' }}>
      <div className="flex items-center justify-between px-4 py-2" style={{ background: 'color-mix(in srgb, var(--np-raised) 70%, transparent)', borderBottom:'1px solid rgba(var(--np-contrast-rgb), 0.08)' }}>
        <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400" style={{ color: 'var(--np-muted)' }}>{language || 'code'}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-all font-medium"
          style={{ color: copied ? 'var(--blue-bright)' : 'var(--np-muted)' }}
          onMouseEnter={e=>{ if(!copied) (e.currentTarget as HTMLElement).style.background='rgba(var(--np-contrast-rgb), 0.05)'; }}
          onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.background='transparent'; }}>
          {copied ? <><Check size={12}/> Copied</> : <><Copy size={12}/> Copy</>}
        </button>
      </div>
      <div style={{ maxHeight: '450px', overflowY: 'auto' }}>
        <pre className="!m-0 !bg-[#121212] !p-4">
          <code 
            className={`language-${language} text-[13px] leading-[1.65] whitespace-pre t-mono`} 
            dangerouslySetInnerHTML={{ __html: highlightedCode }} 
          />
        </pre>
      </div>
    </div>
  );
}
