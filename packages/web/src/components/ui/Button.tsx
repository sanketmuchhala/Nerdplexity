import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary'|'secondary'|'ghost'|'destructive';
  size?: 'sm'|'md'|'lg';
  children: ReactNode;
}

export function Button({ variant='primary', size='md', className, disabled, children, style, ...props }: Props) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border';
  const sizes = { sm:'px-3 py-1.5 text-xs', md:'px-4 py-2 text-sm', lg:'px-5 py-2.5 text-sm' };

  const styles: React.CSSProperties = {};
  if (variant==='primary')     { styles.background='var(--blue-dark)'; styles.borderColor='rgba(59,130,246,.4)'; styles.color='#fff'; }
  if (variant==='secondary')   { styles.background='var(--s2)'; styles.borderColor='var(--b-hi)'; styles.color='var(--t2)'; }
  if (variant==='ghost')       { styles.background='transparent'; styles.borderColor='transparent'; styles.color='var(--t2)'; }
  if (variant==='destructive') { styles.background='#dc2626'; styles.borderColor='transparent'; styles.color='#fff'; }

  return (
    <button style={{ ...styles, ...style }} className={cn(base, sizes[size], className)} disabled={disabled} {...props}>
      {children}
    </button>
  );
}
