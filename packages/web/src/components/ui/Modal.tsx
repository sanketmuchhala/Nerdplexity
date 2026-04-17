import React, { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const modalSizes = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl'
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md'
}) => {
  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop - translucent is okay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Panel - MUST be fully opaque */}
      <div
        className={cn(
          'relative w-full rounded-2xl bg-neutral-900 text-neutral-100 shadow-2xl',
          'border border-neutral-700 nerdplexity-border nerdplexity-glow-strong',
          modalSizes[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between p-6 border-b border-neutral-700 nerdplexity-border">
            <h2 className="text-lg font-semibold text-nerdplexity-300">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-neutral-800 rounded-lg transition-colors text-nerdplexity-400 hover:text-nerdplexity-300 hover:nerdplexity-glow"
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
          </div>
        )}
        
        {/* Content */}
        <div className={cn('p-6', title && 'pt-0')}>
          {children}
        </div>
      </div>
    </div>
  );
};