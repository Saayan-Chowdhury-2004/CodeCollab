import React from 'react';
import { LandingLogo } from './LandingLogo.tsx';

export const LandingFooter: React.FC = () => {
  const repoUrl = import.meta.env.VITE_REPO_URL;

  return (
    <footer className="w-full border-t border-[var(--border)] py-12 select-none">
      <div className="max-w-[1120px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-[var(--ink-muted)]">
        <div className="flex items-center gap-3">
          <LandingLogo className="w-5 h-5 text-[var(--ink)]" />
          <span className="font-semibold text-sm text-[var(--ink)]">CodeCollab</span>
          <span className="hidden sm:inline">·</span>
          <p className="text-center sm:text-left">
            Open source real-time collaborative code editor and review platform.
          </p>
        </div>

        <nav className="flex items-center gap-5 font-medium" aria-label="Footer links">
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--ink)] transition-colors focus-visible:outline-none focus-ring-visible rounded"
          >
            API docs
          </a>

          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--ink)] transition-colors focus-visible:outline-none focus-ring-visible rounded"
            >
              GitHub
            </a>
          )}

          <a
            href="#how-it-works"
            className="hover:text-[var(--ink)] transition-colors focus-visible:outline-none focus-ring-visible rounded"
          >
            How it works
          </a>
        </nav>
      </div>
    </footer>
  );
};

