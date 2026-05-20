import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default', size = 'sm', className, children, ...props
}) => {
  const base = 'inline-flex items-center gap-1 rounded-full border font-medium';
  const sizes = { sm: 'px-2 py-0.5 text-xs', md: 'px-3 py-1 text-sm' };

  const styles: React.CSSProperties = {};
  if (variant === 'default') { styles.background = 'var(--s3)'; styles.borderColor = 'var(--b)'; styles.color = 'var(--t2)'; }
  if (variant === 'primary') { styles.background = 'rgba(78,107,255,.12)'; styles.borderColor = 'rgba(78,107,255,.3)'; styles.color = '#8fa5ff'; }
  if (variant === 'success') { styles.background = 'rgba(74,222,128,.1)'; styles.borderColor = 'rgba(74,222,128,.3)'; styles.color = '#86efac'; }
  if (variant === 'warning') { styles.background = 'rgba(251,191,36,.1)'; styles.borderColor = 'rgba(251,191,36,.3)'; styles.color = '#fcd34d'; }
  if (variant === 'danger')  { styles.background = 'rgba(239,68,68,.1)';  styles.borderColor = 'rgba(239,68,68,.3)';  styles.color = '#fca5a5'; }

  return (
    <span style={styles} className={cn(base, sizes[size], className)} {...props}>
      {children}
    </span>
  );
};
