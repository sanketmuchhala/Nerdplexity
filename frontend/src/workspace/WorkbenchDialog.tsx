import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function WorkbenchDialog({
  title,
  onClose,
  children,
  sheet = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  sheet?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select')?.focus();
    return () => {
      element?.close();
      previous.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`np-dialog ${sheet ? 'sheet' : ''}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="np-dialog-inner">
        <header>
          <div>
            <span className="np-eyebrow">NERDPLEXITY</span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="np-icon-button"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
