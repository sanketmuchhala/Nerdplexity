import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const buttonVariants = {
  primary:     'bg-nerdplexity-600 hover:bg-nerdplexity-500 text-white border-transparent',
  secondary:   'bg-neutral-800 hover:bg-neutral-750 text-neutral-300 hover:text-neutral-100 border-neutral-700 hover:border-neutral-600',
  ghost:       'bg-transparent hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 border-transparent',
  destructive: 'bg-red-600 hover:bg-red-500 text-white border-transparent',
};

const buttonSizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  children,
  ...props
}) => {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl border font-medium',
        'transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-nerdplexity-500/50 focus:ring-offset-1 focus:ring-offset-neutral-950',
        'disabled:opacity-50 disabled:pointer-events-none',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};