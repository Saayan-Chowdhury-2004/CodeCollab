import React from 'react';

export interface LandingCtaProps {
  onGetStarted: () => void;
}

export const LandingCta: React.FC<LandingCtaProps> = ({
  onGetStarted,
}) => {
  return (
    <section
      aria-labelledby="cta-heading"
      className="w-full py-16 sm:py-24 max-w-[1120px] mx-auto px-4 sm:px-6 select-none"
    >
      <div className="frosted-surface rounded-[28px] p-8 sm:p-12 text-center border border-[var(--border)] shadow-raised space-y-6">
        <div className="space-y-3 max-w-xl mx-auto">
          <h2
            id="cta-heading"
            className="text-2xl sm:text-3xl font-light tracking-tight text-[var(--ink)]"
          >
            Start collaborating on code in seconds.
          </h2>
          <p className="text-xs sm:text-sm text-[var(--ink-muted)] leading-relaxed">
            Create an account or sign in to save snippets, invite collaborators, and track line-by-line review notes.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onGetStarted}
            className="min-h-[40px] px-6 py-2.5 rounded-full bg-[var(--ink)] text-[var(--ink-contrast)] text-xs sm:text-sm font-semibold shadow-raised hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none focus-ring-visible"
          >
            Get started
          </button>
        </div>
      </div>
    </section>
  );
};

