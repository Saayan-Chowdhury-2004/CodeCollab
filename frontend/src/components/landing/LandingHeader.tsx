import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore.ts';
import { LandingLogo } from './LandingLogo.tsx';

export interface LandingHeaderProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export const LandingHeader: React.FC<LandingHeaderProps> = ({
  onGetStarted,
  onSignIn,
}) => {
  const { resolvedTheme, toggleTheme } = useThemeStore();

  return (
    <header className="sticky top-0 z-30 w-full frosted-surface border-b border-[var(--border)] select-none">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 px-4 py-2 rounded-xl bg-[var(--ink)] text-[var(--ink-contrast)] text-xs font-semibold shadow-raised focus-visible:outline-none focus-ring-visible"
      >
        Skip to content
      </a>

      <div className="max-w-[1120px] mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-4">
        {/* Brand */}
        <a
          href="#"
          className="flex items-center gap-2.5 text-[var(--ink)] hover:opacity-85 transition-opacity focus-visible:outline-none focus-ring-visible rounded-lg"
          aria-label="CodeCollab home"
        >
          <LandingLogo className="w-7 h-7 text-[var(--ink)] shrink-0" />
          <span className="font-semibold text-base sm:text-lg tracking-tight">
            CodeCollab
          </span>
        </a>

        {/* Anchor Navigation */}
        <nav
          className="hidden md:flex items-center gap-6 text-xs text-[var(--ink-muted)] font-medium"
          aria-label="Landing navigation"
        >
          <a
            href="#features"
            className="hover:text-[var(--ink)] transition-colors focus-visible:outline-none focus-ring-visible rounded"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="hover:text-[var(--ink)] transition-colors focus-visible:outline-none focus-ring-visible rounded"
          >
            How it works
          </a>
        </nav>

        {/* Right Actions: Theme Toggle, Sign In, Get Started */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            className="min-h-[40px] min-w-[40px] p-2 rounded-full text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors flex items-center justify-center focus-visible:outline-none focus-ring-visible"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-[var(--ink)]" />
            ) : (
              <Moon className="w-4 h-4 text-[var(--ink)]" />
            )}
          </button>

          <button
            type="button"
            onClick={onSignIn}
            className="min-h-[40px] px-3.5 sm:px-4 py-2 rounded-full border border-[var(--border)] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors cursor-pointer focus-visible:outline-none focus-ring-visible"
          >
            Sign in
          </button>

          <button
            type="button"
            onClick={onGetStarted}
            className="min-h-[40px] px-4 sm:px-5 py-2 rounded-full bg-[var(--ink)] text-[var(--ink-contrast)] text-xs font-semibold shadow-raised hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none focus-ring-visible"
          >
            Get started
          </button>
        </div>
      </div>
    </header>
  );
};

