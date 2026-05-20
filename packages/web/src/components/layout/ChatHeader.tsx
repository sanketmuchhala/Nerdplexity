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

function SelectPill<T extends string>({
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
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        disabled={!canOpen}
        onClick={() => canOpen && setOpen(o => !o)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium text-neutral-500 transition-all duration-100"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          cursor: canOpen ? 'pointer' : 'default',
        }}
        onMouseEnter={e => { if (canOpen) (e.currentTarget as HTMLElement).style.color = '#e4e4e7'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = ''; }}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        {canOpen && (
          <ChevronDown size={10} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 z-50 min-w-[160px] rounded-xl overflow-hidden animate-fade-in"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-hi)',
            boxShadow: '0 8px 32px rgba(0,0,0,.6)',
          }}
        >
          {options.map(opt => {
            const isActive = opt === value;
            const optLabel = displayMap ? (displayMap[opt] ?? opt) : opt;
            return (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-[12px] transition-colors text-left"
                style={{ color: isActive ? '#fb7185' : 'var(--text-2)' }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span className="truncate">{optLabel}</span>
                {isActive && <Check size={11} className="flex-shrink-0 text-nerdplexity-400" />}
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
  onProviderChange, onModelChange,
  availableProviders = [],
}) => {
  if (!conversation) {
    return (
      <div
        className="flex items-center justify-between h-12 px-5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[12px] font-semibold text-neutral-700 tracking-tight">Nerdplexity</span>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg text-neutral-700 hover:text-neutral-300 transition-colors"
        >
          <Settings size={15} />
        </button>
      </div>
    );
  }

  const availableModels = getModelsForProvider(conversation.provider);

  return (
    <div
      className="flex items-center h-12 px-5 gap-3 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Thread title */}
      <h1 className="text-[13px] font-medium text-neutral-400 truncate flex-1 min-w-0">
        {sanitizeDisplayText(conversation.title)}
      </h1>

      {/* Provider + model pills */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <SelectPill
          value={conversation.provider}
          options={availableProviders as Provider[]}
          displayMap={PROVIDER_NAMES as Record<string, string>}
          onChange={p => onProviderChange?.(p as Provider)}
          disabled={availableProviders.length <= 1}
        />
        <SelectPill
          value={conversation.model}
          options={availableModels}
          onChange={m => onModelChange?.(m)}
          disabled={availableModels.length <= 1}
        />
      </div>

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="flex-shrink-0 p-1.5 rounded-lg text-neutral-700 hover:text-neutral-300 transition-colors"
        aria-label="Settings"
      >
        <Settings size={15} />
      </button>
    </div>
  );
};
