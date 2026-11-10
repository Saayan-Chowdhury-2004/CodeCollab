import React from 'react';
import { CheckCircle2, MessageSquare } from 'lucide-react';

/**
 * Decorative mockup editor illustration rendered purely from DOM and design tokens.
 * Aria-hidden, with zero external network or Monaco runtime overhead.
 */
export const LandingHeroIllustration: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="w-full max-w-lg frosted-surface rounded-[24px] border border-[var(--border)] shadow-raised overflow-hidden select-none motion-safe:transition-all"
    >
      {/* Editor Window Top Bar */}
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-raised)]/40 text-[11px] text-[var(--ink-muted)]">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--border)]" />
          <span className="font-mono text-xs text-[var(--ink)] font-medium">
            mergeSnippets.ts
          </span>
          <span className="font-mono text-[10px] text-[var(--ink-muted)]">· v4</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink)]" />
          <span>2 online</span>
        </div>
      </div>

      {/* Editor Body */}
      <div className="p-4 sm:p-5 font-mono text-xs leading-relaxed space-y-3 bg-[var(--editor-bg)] text-[var(--ink)]">
        {/* Line 1 */}
        <div className="flex items-start gap-4">
          <span className="text-[var(--ink-muted)] opacity-50 select-none w-4 text-right">
            1
          </span>
          <div className="flex-1">
            <span className="font-semibold text-[var(--ink)]">export function </span>
            <span>mergeRevisions(local, remote) &#123;</span>
          </div>
        </div>

        {/* Line 2 with Remote Cursor Alex */}
        <div className="flex items-start gap-4 relative">
          <span className="text-[var(--ink-muted)] opacity-50 select-none w-4 text-right">
            2
          </span>
          <div className="flex-1 relative">
            <span className="text-[var(--ink-muted)] pl-4">const state = </span>
            <span className="font-semibold">applyYjsUpdate</span>
            <span>(local.doc, remote.update);</span>

            {/* Remote Cursor 1: Alex */}
            <span className="inline-flex flex-col items-start align-middle ml-0.5">
              <span className="text-[9px] font-sans px-1.5 py-0.2 rounded-t bg-[var(--ink)] text-[var(--ink-contrast)] font-medium">
                Alex
              </span>
              <span className="w-0.5 h-4 bg-[var(--ink)] motion-safe:animate-pulse" />
            </span>
          </div>
        </div>

        {/* Line 3 with Remote Cursor Jordan */}
        <div className="flex items-start gap-4 relative">
          <span className="text-[var(--ink-muted)] opacity-50 select-none w-4 text-right">
            3
          </span>
          <div className="flex-1 relative">
            <span className="text-[var(--ink-muted)] pl-4">return </span>
            <span>createSnapshot(state, &#123; summary: </span>
            <span className="text-[var(--ink-muted)]">&apos;auto-sync&apos;</span>
            <span> &#125;);</span>

            {/* Remote Cursor 2: Jordan */}
            <span className="inline-flex flex-col items-start align-middle ml-1">
              <span className="text-[9px] font-sans px-1.5 py-0.2 rounded-t bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)] font-medium">
                Jordan
              </span>
              <span className="w-0.5 h-4 bg-[var(--ink-muted)] motion-safe:animate-pulse" />
            </span>
          </div>
        </div>

        {/* Line 4 */}
        <div className="flex items-start gap-4">
          <span className="text-[var(--ink-muted)] opacity-50 select-none w-4 text-right">
            4
          </span>
          <div className="flex-1">
            <span>&#125;</span>
          </div>
        </div>

        {/* Anchored Review Thread Card */}
        <div className="ml-8 mt-2 p-3 rounded-2xl bg-[var(--surface-raised)]/60 border border-[var(--border)] shadow-xs space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[var(--ink)] font-sans font-medium text-[11px]">
              <MessageSquare className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              <span>Line 2 · Review note</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink)] font-semibold">
              <CheckCircle2 className="w-3 h-3 text-[var(--ink)]" />
              <span>Resolved</span>
            </span>
          </div>
          <p className="text-[11px] font-sans text-[var(--ink-muted)] leading-normal">
            Low-latency sync verified across concurrent vector updates.
          </p>
        </div>
      </div>
    </div>
  );
};

