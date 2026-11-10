import React from 'react';
import { GitBranch, MessageSquare, Users } from 'lucide-react';

export interface WorkspaceStatStripProps {
  versionNumber: number;
  openThreadsCount: number;
  resolvedThreadsCount: number;
  collaboratorsCount: number;
  onlineCount: number;
  isExpanded?: boolean;
  versionSummary?: string;
  onOpenHistory?: () => void;
  onOpenCollaborators?: () => void;
  onOpenComments?: () => void;
}

export const WorkspaceStatStrip: React.FC<WorkspaceStatStripProps> = ({
  versionNumber,
  openThreadsCount,
  resolvedThreadsCount,
  collaboratorsCount,
  onlineCount,
  isExpanded = false,
  versionSummary,
  onOpenHistory,
  onOpenCollaborators,
  onOpenComments,
}) => {
  if (isExpanded) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 select-none shrink-0 transition-all duration-300">
        {/* 1. Expanded Versions Column Tile */}
        <button
          type="button"
          onClick={onOpenHistory}
          aria-label={`View versions (current: v${versionNumber})`}
          className="rounded-[20px] frosted-surface p-3.5 flex flex-col justify-between text-left transition-all hover:bg-[var(--surface-raised)]/90 hover:scale-[1.01] active:scale-[0.99] cursor-pointer group focus-visible:outline-none focus-ring-visible shadow-raised border border-[var(--border)] min-h-[148px]"
        >
          <div className="flex items-center justify-between text-xs text-[var(--ink-muted)] w-full">
            <div className="flex items-center gap-1.5 font-medium text-[var(--ink)]">
              <GitBranch className="w-4 h-4 text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors" />
              <span>Versions</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)] font-semibold">
              v{versionNumber}
            </span>
          </div>

          <div className="my-1.5">
            <div className="text-3xl sm:text-4xl font-extralight tracking-tight text-[var(--ink)]">
              {versionNumber}
            </div>
            <p className="text-[11px] text-[var(--ink-muted)] mt-1 line-clamp-2 leading-relaxed">
              {versionSummary || 'Full history snapshots, commit logs & line diffs'}
            </p>
          </div>

          <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors w-full">
            <span>Snapshot history</span>
            <span className="font-medium">Inspect →</span>
          </div>
        </button>

        {/* 2. Expanded Review Threads Column Tile */}
        <button
          type="button"
          onClick={onOpenComments}
          aria-label={`View open review threads (${openThreadsCount} open)`}
          className="rounded-[20px] frosted-surface p-3.5 flex flex-col justify-between text-left transition-all hover:bg-[var(--surface-raised)]/90 hover:scale-[1.01] active:scale-[0.99] cursor-pointer group focus-visible:outline-none focus-ring-visible shadow-raised border border-[var(--border)] min-h-[148px]"
        >
          <div className="flex items-center justify-between text-xs text-[var(--ink-muted)] w-full">
            <div className="flex items-center gap-1.5 font-medium text-[var(--ink)]">
              <MessageSquare className="w-4 h-4 text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors" />
              <span>Open Threads</span>
            </div>
            {resolvedThreadsCount > 0 ? (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)]">
                +{resolvedThreadsCount} resolved
              </span>
            ) : (
              <span className="text-[10px] font-mono text-[var(--ink-muted)]">
                Clean tree
              </span>
            )}
          </div>

          <div className="my-1.5">
            <div className="text-3xl sm:text-4xl font-extralight tracking-tight text-[var(--ink)]">
              {openThreadsCount}
            </div>
            <p className="text-[11px] text-[var(--ink-muted)] mt-1 line-clamp-2 leading-relaxed">
              {openThreadsCount > 0
                ? `${openThreadsCount} unresolved discussion${openThreadsCount > 1 ? 's' : ''} awaiting review`
                : 'All inline review discussions resolved'}
            </p>
          </div>

          <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors w-full">
            <span>Review notes</span>
            <span className="font-medium">Open panel →</span>
          </div>
        </button>

        {/* 3. Expanded Collaborators Column Tile */}
        <button
          type="button"
          onClick={onOpenCollaborators}
          aria-label={`View collaborators (${collaboratorsCount} total)`}
          className="rounded-[20px] frosted-surface p-3.5 flex flex-col justify-between text-left transition-all hover:bg-[var(--surface-raised)]/90 hover:scale-[1.01] active:scale-[0.99] cursor-pointer group focus-visible:outline-none focus-ring-visible shadow-raised border border-[var(--border)] min-h-[148px]"
        >
          <div className="flex items-center justify-between text-xs text-[var(--ink-muted)] w-full">
            <div className="flex items-center gap-1.5 font-medium text-[var(--ink)]">
              <Users className="w-4 h-4 text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors" />
              <span>Collaborators</span>
            </div>
            {onlineCount > 0 ? (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink)]" />
                <span>{onlineCount} online</span>
              </span>
            ) : (
              <span className="text-[10px] font-mono text-[var(--ink-muted)]">
                Offline
              </span>
            )}
          </div>

          <div className="my-1.5">
            <div className="text-3xl sm:text-4xl font-extralight tracking-tight text-[var(--ink)]">
              {collaboratorsCount}
            </div>
            <p className="text-[11px] text-[var(--ink-muted)] mt-1 line-clamp-2 leading-relaxed">
              {onlineCount > 0
                ? `${onlineCount} active member${onlineCount > 1 ? 's' : ''} connected right now`
                : `${collaboratorsCount} member${collaboratorsCount > 1 ? 's' : ''} have access to this snippet`}
            </p>
          </div>

          <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors w-full">
            <span>Team members</span>
            <span className="font-medium">Manage access →</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 select-none shrink-0 transition-all duration-300">
      {/* 1. Versions Stat Card */}
      <button
        type="button"
        onClick={onOpenHistory}
        aria-label={`View versions (current: v${versionNumber})`}
        className="rounded-[16px] frosted-surface px-3.5 py-2 flex items-center justify-between gap-3 text-left transition-all hover:bg-[var(--surface-raised)]/90 hover:scale-[1.005] active:scale-[0.99] cursor-pointer group focus-visible:outline-none focus-ring-visible shadow-xs border border-[var(--border)]"
      >
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink)]">
            <GitBranch className="w-3.5 h-3.5 text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors" />
            <span>Versions</span>
          </div>
          <span className="text-[10px] text-[var(--ink-muted)] truncate group-hover:text-[var(--ink)] transition-colors">
            Snapshot history →
          </span>
        </div>
        <div className="text-2xl sm:text-3xl font-extralight tracking-tight text-[var(--ink)] shrink-0">
          {versionNumber}
        </div>
      </button>

      {/* 2. Review Threads Stat Card */}
      <button
        type="button"
        onClick={onOpenComments}
        aria-label={`View open review threads (${openThreadsCount} open)`}
        className="rounded-[16px] frosted-surface px-3.5 py-2 flex items-center justify-between gap-3 text-left transition-all hover:bg-[var(--surface-raised)]/90 hover:scale-[1.005] active:scale-[0.99] cursor-pointer group focus-visible:outline-none focus-ring-visible shadow-xs border border-[var(--border)]"
      >
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink)]">
            <MessageSquare className="w-3.5 h-3.5 text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors" />
            <span>Open Threads</span>
          </div>
          <span className="text-[10px] text-[var(--ink-muted)] truncate group-hover:text-[var(--ink)] transition-colors">
            {resolvedThreadsCount > 0 ? `+${resolvedThreadsCount} resolved →` : 'Review notes →'}
          </span>
        </div>
        <div className="text-2xl sm:text-3xl font-extralight tracking-tight text-[var(--ink)] shrink-0">
          {openThreadsCount}
        </div>
      </button>

      {/* 3. Collaborators Stat Card */}
      <button
        type="button"
        onClick={onOpenCollaborators}
        aria-label={`View collaborators (${collaboratorsCount} total)`}
        className="rounded-[16px] frosted-surface px-3.5 py-2 flex items-center justify-between gap-3 text-left transition-all hover:bg-[var(--surface-raised)]/90 hover:scale-[1.005] active:scale-[0.99] cursor-pointer group focus-visible:outline-none focus-ring-visible shadow-xs border border-[var(--border)]"
      >
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink)]">
            <Users className="w-3.5 h-3.5 text-[var(--ink-muted)] group-hover:text-[var(--ink)] transition-colors" />
            <span>Collaborators</span>
          </div>
          <span className="text-[10px] text-[var(--ink-muted)] truncate group-hover:text-[var(--ink)] transition-colors flex items-center gap-1">
            {onlineCount > 0 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--ink)]" />}
            <span>{onlineCount > 0 ? `${onlineCount} active now →` : 'Team access →'}</span>
          </span>
        </div>
        <div className="text-2xl sm:text-3xl font-extralight tracking-tight text-[var(--ink)] shrink-0">
          {collaboratorsCount}
        </div>
      </button>
    </div>
  );
};

