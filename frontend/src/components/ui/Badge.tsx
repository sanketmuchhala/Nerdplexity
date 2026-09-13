import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default'|'primary'|'success'|'warning'|'danger';
  size?: 'sm'|'md'; children: ReactNode;
}

export function Badge({ variant='default', size='sm', className, children, ...props }: Props) {
  const s: React.CSSProperties = {};
  if (variant==='default') { s.background='var(--s3)'; s.borderColor='var(--b-hi)'; s.color='var(--t2)'; }
  if (variant==='primary') { s.background='rgba(59,130,246,.1)'; s.borderColor='rgba(59,130,246,.3)'; s.color='var(--blue-bright)'; }
  if (variant==='success') { s.background='rgba(74,222,128,.08)'; s.borderColor='rgba(74,222,128,.25)'; s.color='#86efac'; }
  if (variant==='warning') { s.background='rgba(251,191,36,.08)'; s.borderColor='rgba(251,191,36,.25)'; s.color='#fcd34d'; }
  if (variant==='danger')  { s.background='rgba(239,68,68,.08)';  s.borderColor='rgba(239,68,68,.25)';  s.color='#fca5a5'; }
  const sizes = { sm:'px-2 py-0.5 text-xs', md:'px-3 py-1 text-sm' };
  return <span style={s} className={cn('inline-flex items-center gap-1 rounded-full border font-medium', sizes[size], className)} {...props}>{children}</span>;
}
