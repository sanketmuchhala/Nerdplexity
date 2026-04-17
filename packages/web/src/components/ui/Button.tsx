import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const buttonVariants = {
  primary: 'bg-nerdplexity-600 hover:bg-nerdplexity-700 text-white border-transparent nerdplexity-glow hover:nerdplexity-glow-strong',
  secondary: 'bg-neutral-800 hover:bg-neutral-700 text-nerdplexity-300 border-nerdplexity-600 hover:border-nerdplexity-500',
  ghost: 'bg-transparent hover:bg-neutral-800 text-nerdplexity-400 hover:text-nerdplexity-300 border-transparent hover:nerdplexity-glow',
  destructive: 'bg-red-600 hover:bg-red-700 text-white border-transparent'
};

const buttonSizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base'
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
        'inline-flex items-center justify-center gap-2 rounded-2xl border font-medium',
        'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-nerdplexity-400 focus:ring-offset-2 focus:ring-offset-neutral-950',
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