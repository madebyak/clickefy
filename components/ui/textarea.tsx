'use client';

import { TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * Custom Textarea component
 * Clean styling consistent with Input component
 */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-white mb-2">
            {label}
            {props.required && <span className="text-[#ef4444] ml-1">*</span>}
          </label>
        )}
        <textarea
          className={cn(
            'w-full px-4 py-3 rounded-lg bg-[#16161f] border border-[#27272a] text-white placeholder-[#a1a1aa]',
            'focus:outline-none focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent',
            'transition-colors resize-none',
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

Textarea.displayName = 'Textarea';

export { Textarea };
