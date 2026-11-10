import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string;
  disabled?: boolean;
}

export interface CustomSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<CustomSelectOption<T> | T>;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}

export function CustomSelect<T extends string = string>({
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  placeholder = 'Select an option',
  id,
  'aria-label': ariaLabel,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Normalize options to CustomSelectOption objects
  const normalizedOptions: CustomSelectOption<T>[] = options.map((opt) => {
    if (typeof opt === 'string') {
      return { value: opt as T, label: opt };
    }
    return opt;
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className={`relative ${/\bw-/.test(className) ? className : `w-full ${className}`}`}
    >
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[14px] px-3.5 py-2 text-xs text-[var(--ink)] flex items-center justify-between gap-2 shadow-inset outline-none transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-ring-visible ${triggerClassName}`}
      >
        <span className="truncate capitalize font-normal">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''
            }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className={`absolute left-0 right-0 top-full mt-1.5 py-1 rounded-[14px] popover-surface shadow-2xl z-50 max-h-56 overflow-y-auto divide-y divide-[var(--border-subtle)] ${menuClassName}`}
        >
          {normalizedOptions.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${isSelected
                    ? 'bg-[var(--surface-raised)] text-[var(--ink)] font-semibold'
                    : 'text-[var(--ink)] hover:bg-[var(--surface-raised)]/60 font-normal'
                  }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="truncate capitalize">{opt.label}</span>
                  {opt.badge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink-muted)] font-mono">
                      {opt.badge}
                    </span>
                  )}
                </div>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-[var(--ink)] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

