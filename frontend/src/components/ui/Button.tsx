import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  className?: string;
}

export function Button({ children, onClick, variant = 'primary', className }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 rounded-lg font-medium transition-colors',
        variant === 'primary' && 'bg-primary-600 hover:bg-primary-700 text-white',
        variant === 'secondary' && 'bg-slate-700 hover:bg-slate-600 text-slate-100',
        className
      )}
    >
      {children}
    </button>
  );
}
