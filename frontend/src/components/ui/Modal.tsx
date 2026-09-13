import { useEffect, ReactNode } from 'react';

interface Props { isOpen: boolean; onClose: () => void; title: string; children: ReactNode; maxWidth?: string; }

export function Modal({ isOpen, onClose, title, children, maxWidth = '600px' }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full rounded-2xl overflow-hidden animate-fade-in"
        style={{ maxWidth, background: 'var(--s0)', border: '1px solid var(--b-hi)', boxShadow: '0 16px 64px rgba(0,0,0,.8)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--b)' }}>
          <h2 className="text-base font-semibold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>{title}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-lg font-light transition-all"
            style={{ color: 'var(--t3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--s2)'; (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; }}>×</button>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: '80vh' }}>{children}</div>
      </div>
    </div>
  );
}
