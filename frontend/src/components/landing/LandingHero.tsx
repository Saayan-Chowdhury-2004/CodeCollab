import React from 'react';

export interface LandingHeroProps {
  onGetStarted: () => void;
  illustration?: React.ReactNode;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  onGetStarted,
  illustration,
}) => {
  return (
    <section
      aria-labelledby="hero-heading"
      className="w-full pt-12 pb-16 sm:pt-20 sm:pb-24 max-w-[1120px] mx-auto px-4 sm:px-6"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
        {/* Left Column: Headline, Subline, Action buttons */}
        <div className="lg:col-span-6 space-y-6 text-left">
          <div className="space-y-4">
            <span className="inline-block text-xs font-mono font-medium tracking-wider uppercase text-[var(--ink-muted)]">
              Real-time collaboration & review
            </span>
            <h1
              id="hero-heading"
              className="text-4xl sm:text-5xl lg:text-[56px] lg:leading-[1.1] font-light tracking-tight text-[var(--ink)] text-balance"
            >
              Write code together. Review it line by line.
            </h1>
            <p className="text-sm sm:text-base text-[var(--ink-muted)] leading-relaxed max-w-xl text-pretty">
              CodeCollab is an open source platform for collaborative coding. Edit in the
              same snippet with live presence, discuss changes in line-anchored threads,
              and restore any version.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onGetStarted}
              className="min-h-[40px] px-6 py-2.5 rounded-full bg-[var(--ink)] text-[var(--ink-contrast)] text-xs sm:text-sm font-semibold shadow-raised hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none focus-ring-visible"
            >
              Get started
            </button>
          </div>
        </div>

        {/* Right Column: Interactive Decorative Product Illustration */}
        <div className="lg:col-span-6 w-full flex items-center justify-center">
          {illustration}
        </div>
      </div>
    </section>
  );
};

