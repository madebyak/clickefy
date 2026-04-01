'use client';

import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * Custom Input component
 * Consistent height (h-10), clean styling, no borders/shadows
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, type = 'text', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-white mb-2">
            {label}
            {props.required && <span className="text-[#ef4444] ml-1">*</span>}
          </label>
        )}
        <input
          type={type}
          className={cn(
            'w-full h-10 px-4 rounded-lg bg-[#16161f] border border-[#27272a] text-white placeholder-[#a1a1aa]',
            'focus:outline-none focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent',
            'transition-colors',
            error && 'border-[#ef4444] focus:ring-[#ef4444]',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="text-sm text-[#ef4444] mt-1">{error}</p>
        )}
        {helperText && !error && (
          <p className="text-sm text-[#a1a1aa] mt-1">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
