import React, { useState, useRef, useEffect } from 'react';
import { Settings, ChevronDown, Check } from 'lucide-react';
import { sanitizeDisplayText } from '../../lib/stripEmojis';
import { PROVIDER_NAMES, getModelsForProvider } from '../../constants/models';
import type { Provider } from '../../lib/db';
import type { Conversation } from '../../lib/db';

interface ChatHeaderProps {
  conversation: Conversation | null;
  onOpenSettings: () => void;
  onProviderChange?: (provider: Provider) => void;
  onModelChange?: (model: string) => void;
  availableProviders?: string[];
}

function Pill<T extends string>({
  value,
  options,
  displayMap,
  onChange,
  disabled,
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const label = displayMap ? (displayMap[value] ?? value) : value;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => canOpen && setOpen(o => !o)}
        disabled={!canOpen}
        className={`
          flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium
          border border-neutral-700 bg-neutral-850 text-neutral-400
          transition-all duration-100
          ${canOpen
            ? 'hover:border-neutral-600 hover:text-neutral-200 hover:bg-neutral-800 cursor-pointer'
            : 'cursor-default'}
        `}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        {canOpen && (
          <ChevronDown
            size={10}
            className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && (
        <div
          className="
            absolute top-full left-0 mt-1.5 z-50 min-w-[160px]
            bg-neutral-900 border border-neutral-700/80 rounded-xl shadow-2xl
            overflow-hidden animate-fade-in
          "
          style={{ backdropFilter: 'blur(12px)' }}
        >
          {options.map(opt => {
            const optLabel = displayMap ? (displayMap[opt] ?? opt) : opt;
            const isActive = opt === value;
            return (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`
                  w-full flex items-center justify-between gap-3 px-3 py-2 text-xs
                  transition-colors duration-100
                  ${isActive
                    ? 'text-nerdplexity-400 bg-nerdplexity-950/40'
                    : 'text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100'}
                `}
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
  conversation,
  onOpenSettings,
  onProviderChange,
  onModelChange,
  availableProviders = [],
}) => {
  if (!conversation) {
    return (
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-neutral-700/60">
        <span className="text-sm font-semibold text-neutral-500">Nerdplexity</span>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-all"
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>
      </div>
    );
  }

  const availableModels = getModelsForProvider(conversation.provider);

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-neutral-700/60">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <h1 className="text-sm font-medium text-neutral-300 truncate">
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
            options={availableModels}
            onChange={m => onModelChange?.(m)}
            disabled={availableModels.length <= 1}
          />
        </div>
      </div>

      <button
        onClick={onOpenSettings}
        className="flex-shrink-0 p-1.5 rounded-lg text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-all"
        aria-label="Open settings (Cmd+K)"
      >
        <Settings size={16} />
      </button>
    </div>
  );
};
