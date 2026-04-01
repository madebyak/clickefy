'use client';

import { SelectHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  options: DropdownOption[];
  error?: string;
  helperText?: string;
  onChange?: (value: string) => void;
}

/**
 * Custom Dropdown component
 * Consistent height (h-10) with Input component
 */
const Dropdown = forwardRef<HTMLSelectElement, DropdownProps>(
  ({ className, label, options, error, helperText, onChange, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-white mb-2">
            {label}
            {props.required && <span className="text-[#ef4444] ml-1">*</span>}
          </label>
        )}
        <select
          className={cn(
            'w-full h-10 px-4 rounded-lg bg-[#16161f] border border-[#27272a] text-white',
            'focus:outline-none focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent',
            'transition-colors cursor-pointer',
            error && 'border-[#ef4444] focus:ring-[#ef4444]',
            className
          )}
          ref={ref}
          onChange={(e) => onChange?.(e.target.value)}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-[#1e1e2a]">
              {option.label}
            </option>
          ))}
        </select>
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

Dropdown.displayName = 'Dropdown';

export { Dropdown };
export type { DropdownOption };
