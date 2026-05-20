import React, { useState, useRef, useEffect } from 'react';
import { Settings, ChevronDown, Check } from 'lucide-react';
import { sanitizeDisplayText } from '../../lib/stripEmojis';
import { PROVIDER_NAMES, getModelsForProvider } from '../../constants/models';
import type { Provider, Conversation } from '../../lib/db';

interface ChatHeaderProps {
  conversation: Conversation | null;
  onOpenSettings: () => void;
  onProviderChange?: (p: Provider) => void;
  onModelChange?: (m: string) => void;
  availableProviders?: string[];
}

function Pill<T extends string>({
  value, options, displayMap, onChange, disabled,
}: {
  value: T;
  options: readonly T[];
  displayMap?: Record<string, string>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canOpen = !disabled && options.length > 1;
  const label = displayMap ? (displayMap[value] ?? value) : value;

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        disabled={!canOpen}
        onClick={() => canOpen && setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
        style={{
          background: 'var(--s3)',
          border: '1px solid var(--b)',
          color: 'var(--t2)',
          cursor: canOpen ? 'pointer' : 'default',
        }}
        onMouseEnter={e => { if (canOpen) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(78,107,255,.3)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--b)'; }}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        {canOpen && <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 z-50 min-w-[160px] rounded-xl overflow-hidden animate-fade-in"
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--b-hi)',
            boxShadow: '0 8px 32px rgba(0,0,0,.7)',
          }}
        >
          {options.map(opt => {
            const active = opt === value;
            const lbl = displayMap ? (displayMap[opt] ?? opt) : opt;
            return (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs text-left transition-colors"
                style={{ color: active ? 'var(--blue-hi)' : 'var(--t2)' }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--s2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span className="truncate">{lbl}</span>
                {active && <Check size={11} style={{ color: 'var(--blue)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  conversation, onOpenSettings,
  onProviderChange, onModelChange, availableProviders = [],
}) => {
  const iconBtn = (
    <button
      onClick={onOpenSettings}
      className="p-2 rounded-lg transition-all"
      style={{ color: 'var(--t3)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; (e.currentTarget as HTMLElement).style.background = 'var(--s2)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <Settings size={15} />
    </button>
  );

  if (!conversation) {
    return (
      <div className="flex items-center justify-between h-12 px-5 flex-shrink-0" style={{ borderBottom: '1px solid var(--b)' }}>
        <span className="text-xs font-semibold text-[var(--t3)]" style={{ fontFamily: 'Syne, sans-serif', letterSpacing: '0.02em' }}>
          NERDPLEXITY
        </span>
        {iconBtn}
      </div>
    );
  }

  const models = getModelsForProvider(conversation.provider);

  return (
    <div
      className="flex items-center gap-3 h-12 px-5 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--b)' }}
    >
      <h1 className="text-sm font-medium text-[var(--t2)] truncate flex-1 min-w-0">
        {sanitizeDisplayText(conversation.title)}
      </h1>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Pill
          value={conversation.provider}
          options={availableProviders as Provider[]}
          displayMap={PROVIDER_NAMES as Record<string, string>}
          onChange={p => onProviderChange?.(p as Provider)}
          disabled={availableProviders.length <= 1}
        />
        <Pill
          value={conversation.model}
          options={models}
          onChange={m => onModelChange?.(m)}
          disabled={models.length <= 1}
        />
      </div>

      {iconBtn}
    </div>
  );
};
