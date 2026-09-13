import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface Props extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; }

export const Input = forwardRef<HTMLInputElement, Props>(({ label, error, className, ...props }, ref) => (
  <div className="flex flex-col gap-1.5">
    {label && <label className="t-label">{label}</label>}
    <input
      ref={ref}
      style={{ background:'var(--s2)', border:`1px solid ${error ? '#ef4444' : 'var(--b-hi)'}`, color:'var(--t1)', borderRadius:'var(--radius-md)' }}
      className={cn('w-full px-3 py-2.5 text-sm outline-none transition-all placeholder:opacity-40', className)}
      onFocus={e => { if (!error) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,.4)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px rgba(59,130,246,.08)'; }}
      onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = error ? '#ef4444' : 'var(--b-hi)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
      {...props}
    />
    {error && <p className="text-xs" style={{ color:'#f87171' }}>{error}</p>}
  </div>
));
Input.displayName = 'Input';
