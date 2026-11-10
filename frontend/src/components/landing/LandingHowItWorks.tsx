import React from 'react';

interface StepItem {
  number: string;
  title: string;
  description: string;
}

const STEPS: StepItem[] = [
  {
    number: '01',
    title: 'Write and share a snippet',
    description:
      'Create a snippet in any supported language and share its link with public, unlisted, or private visibility.',
  },
  {
    number: '02',
    title: 'Edit it together live',
    description:
      'Collaborate concurrently with low-latency remote cursors, selections, and presence powered by Yjs.',
  },
  {
    number: '03',
    title: 'Review and resolve line by line',
    description:
      'Anchor discussion threads directly to code lines, reply in real time, and mark resolved as you iterate.',
  },
];

export const LandingHowItWorks: React.FC = () => {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="w-full py-16 sm:py-20 max-w-[1120px] mx-auto px-4 sm:px-6 select-none"
    >
      <div className="space-y-4 text-left mb-10 sm:mb-12">
        <span className="text-xs font-mono font-medium tracking-wider uppercase text-[var(--ink-muted)]">
          Workflow
        </span>
        <h2
          id="how-it-works-heading"
          className="text-2xl sm:text-3xl font-light tracking-tight text-[var(--ink)]"
        >
          How it works
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {STEPS.map((step) => (
          <div
            key={step.number}
            className="frosted-surface rounded-[24px] p-6 flex flex-col justify-between border border-[var(--border)] shadow-raised space-y-6"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-[var(--ink-muted)] px-2.5 py-1 rounded-full bg-[var(--surface-raised)] border border-[var(--border)]">
                {step.number}
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-semibold text-[var(--ink)] tracking-tight">
                {step.title}
              </h3>
              <p className="text-xs sm:text-sm text-[var(--ink-muted)] leading-relaxed">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

