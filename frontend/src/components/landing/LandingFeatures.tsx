import React from 'react';
import {
  Bell,
  History,
  MessageSquare,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';

interface FeatureCard {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const FEATURES: FeatureCard[] = [
  {
    icon: Users,
    title: 'Live collaborative editing',
    description:
      'Collaborate concurrently in the same snippet with low-latency remote cursors, selections, and presence via Yjs.',
  },
  {
    icon: MessageSquare,
    title: 'Line-anchored review threads',
    description:
      'Anchor discussions directly to code lines, reply in real time, and track outdated markers when code changes.',
  },
  {
    icon: History,
    title: 'Version history and diff',
    description:
      'Save timestamped version checkpoints, inspect visual line diffs between any two versions, and restore snapshots.',
  },
  {
    icon: Search,
    title: 'Full-text code search',
    description:
      'Query snippets across title, content, and tags with ranking, plus filters for language, author, and creation date.',
  },
  {
    icon: ShieldCheck,
    title: 'Roles and sharing controls',
    description:
      'Control access across admin, editor, and viewer roles, with public, unlisted, or private visibility per snippet.',
  },
  {
    icon: Bell,
    title: 'Activity and notifications',
    description:
      'Stay updated with live workspace activity streams and notifications whenever review comments are created.',
  },
];

export const LandingFeatures: React.FC = () => {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="w-full py-16 sm:py-20 max-w-[1120px] mx-auto px-4 sm:px-6 select-none"
    >
      <div className="space-y-4 text-left mb-10 sm:mb-12">
        <span className="text-xs font-mono font-medium tracking-wider uppercase text-[var(--ink-muted)]">
          Capabilities
        </span>
        <h2
          id="features-heading"
          className="text-2xl sm:text-3xl font-light tracking-tight text-[var(--ink)]"
        >
          Features
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="frosted-surface rounded-[24px] p-6 flex flex-col justify-between border border-[var(--border)] shadow-raised space-y-5"
            >
              <div className="w-10 h-10 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--ink)] shadow-xs">
                <Icon className="w-5 h-5 text-[var(--ink)]" />
              </div>

              <div className="space-y-2">
                <h3 className="text-base font-semibold text-[var(--ink)] tracking-tight">
                  {feature.title}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--ink-muted)] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

