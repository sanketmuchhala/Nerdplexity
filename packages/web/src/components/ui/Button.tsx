import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary', size = 'md', className, disabled, children, ...props
}) => {
  const base = 'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border';

  const variants = {
    primary:     'text-white border-transparent',
    secondary:   'border-transparent',
    ghost:       'border-transparent',
    destructive: 'text-white border-transparent bg-red-600 hover:bg-red-500',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  };

  const styles: React.CSSProperties = {};
  if (variant === 'primary')   { styles.background = 'var(--blue)'; styles.boxShadow = '0 0 16px rgba(78,107,255,.2)'; }
  if (variant === 'secondary') { styles.background = 'var(--s3)'; styles.borderColor = 'var(--b-hi)'; styles.color = 'var(--t2)'; }
  if (variant === 'ghost')     { styles.background = 'transparent'; styles.color = 'var(--t2)'; }

  return (
    <button
      style={styles}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
