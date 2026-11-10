import React, { useEffect, useState } from 'react';
import {
  Activity,
  Code2,
  ExternalLink,
  Globe,
  RefreshCw,
  User,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.ts';
import { useRealtimeStore } from '../../store/realtimeStore.ts';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { ActivityDTO, ActivityEventType } from '../../types/domain.ts';
import { CustomSelect } from '../ui/CustomSelect.tsx';

interface ActivityFeedViewProps {
  onNavigateToSnippet: (snippetId: string) => void;
}

const EVENT_TYPES: Array<{ value: '' | ActivityEventType; label: string }> = [
  { value: '', label: 'All Event Types' },
  { value: 'snippet.created', label: 'Snippet created' },
  { value: 'snippet.edited', label: 'Snippet edited' },
  { value: 'snippet.deleted', label: 'Snippet deleted' },
  { value: 'comment.added', label: 'Comment added' },
  { value: 'comment.resolved', label: 'Comment resolved' },
  { value: 'collaborator.added', label: 'Collaborator added' },
];

export const ActivityFeedView: React.FC<ActivityFeedViewProps> = ({
  onNavigateToSnippet,
}) => {
  const { user } = useAuthStore();
  const { activeSnippet } = useSnippetStore();
  const {
    globalActivities,
    globalHasMore,
    snippetActivities,
    snippetHasMore,
    userActivities,
    userHasMore,
    isLoadingActivities,
    activityTypeFilter,
    setActivityTypeFilter,
    fetchGlobalActivities,
    fetchSnippetActivities,
    fetchUserActivities,
  } = useRealtimeStore();

  const [scopeTab, setScopeTab] = useState<'global' | 'snippet' | 'user'>(
    'global'
  );

  const loadScope = (
    tab: 'global' | 'snippet' | 'user',
    append = false
  ) => {
    if (tab === 'global') {
      fetchGlobalActivities({ append });
    } else if (tab === 'snippet' && activeSnippet) {
      fetchSnippetActivities(activeSnippet.id, { append });
    } else if (tab === 'user' && user) {
      fetchUserActivities(user.id, { append });
    }
  };

  useEffect(() => {
    loadScope(scopeTab, false);
  }, [scopeTab, activityTypeFilter, activeSnippet?.id, user?.id]);

  let currentItems: ActivityDTO[] = globalActivities;
  let currentHasMore = globalHasMore;
  if (scopeTab === 'snippet') {
    currentItems = snippetActivities;
    currentHasMore = snippetHasMore;
  } else if (scopeTab === 'user') {
    currentItems = userActivities;
    currentHasMore = userHasMore;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header & Controls */}
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
          <div>
            <div className="flex items-center gap-2 text-[var(--accent-positive)] mb-1">
              <Activity className="w-5 h-5" />
              <span className="text-xs uppercase tracking-wider font-semibold">Feed</span>
            </div>
            <h1 className="text-[30px] font-[300] tracking-tight text-[var(--ink)] leading-none">
              Activity
            </h1>
            <p className="text-xs text-[var(--ink-muted)] mt-1.5">
              Live updates across public snippets, active collaborations, and your profile.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <CustomSelect
              value={activityTypeFilter}
              onChange={(val) => setActivityTypeFilter(val as '' | ActivityEventType)}
              options={EVENT_TYPES}
              aria-label="Filter by activity event type"
              className="w-48"
              triggerClassName="py-1.5"
            />

            <button
              type="button"
              onClick={() => loadScope(scopeTab, false)}
              className="px-3 py-1.5 rounded-[14px] border border-[var(--border)] hover:bg-[var(--surface-raised)] text-xs text-[var(--ink)] flex items-center gap-1.5 transition-colors focus-ring-visible cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[var(--ink-muted)] ${
                  isLoadingActivities ? 'animate-spin text-[var(--accent-positive)]' : ''
                }`}
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Feed Scope Tabs */}
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setScopeTab('global')}
            className={`px-3.5 py-1.5 rounded-[14px] text-xs font-medium flex items-center gap-1.5 transition-all focus-ring-visible ${
              scopeTab === 'global'
                ? 'bg-[var(--surface-raised)] text-[var(--ink)] shadow-raised font-semibold'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Global</span>
          </button>

          <button
            type="button"
            disabled={!activeSnippet}
            onClick={() => setScopeTab('snippet')}
            className={`px-3.5 py-1.5 rounded-[14px] text-xs font-medium flex items-center gap-1.5 transition-all focus-ring-visible ${
              scopeTab === 'snippet'
                ? 'bg-[var(--surface-raised)] text-[var(--ink)] shadow-raised font-semibold'
                : !activeSnippet
                ? 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>
              Active Snippet {activeSnippet ? `(${activeSnippet.title.slice(0, 18)})` : ''}
            </span>
          </button>

          <button
            type="button"
            disabled={!user}
            onClick={() => setScopeTab('user')}
            className={`px-3.5 py-1.5 rounded-[14px] text-xs font-medium flex items-center gap-1.5 transition-all focus-ring-visible ${
              scopeTab === 'user'
                ? 'bg-[var(--surface-raised)] text-[var(--ink)] shadow-raised font-semibold'
                : !user
                ? 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>My Activity {user ? `(@${user.username})` : ''}</span>
          </button>
        </div>

        {/* Activity Cards List */}
        <div className="frosted-surface rounded-[24px] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] overflow-hidden">
          {currentItems.length === 0 ? (
            <div className="p-12 text-center relative flex flex-col items-center justify-center">
              <span className="text-sm font-mono text-[var(--ink-muted)] opacity-60">
                「 No activity recorded in this scope 」
              </span>
              <p className="text-xs text-[var(--ink-muted)] mt-1">
                Events will appear here in real-time as team members collaborate.
              </p>
            </div>
          ) : (
            currentItems.map((act) => (
              <div
                key={act.id}
                className="p-4 sm:p-5 flex items-start justify-between gap-4 text-xs hover:bg-[var(--surface-raised)]/30 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[var(--ink)]">
                      {act.actor.displayName}
                    </span>
                    <span className="font-mono text-[var(--ink-muted)] text-[11px]">
                      @{act.actor.username}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--ink)]">
                      {act.type.replace('.', ' ')}
                    </span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[var(--surface-raised)]/60 text-[var(--ink-muted)]">
                      {act.visibility}
                    </span>
                  </div>

                  {Object.keys(act.metadata || {}).length > 0 && (
                    <pre className="text-[11px] font-mono text-[var(--ink-muted)] bg-[var(--surface-raised)]/40 border border-[var(--border-subtle)] rounded-[12px] p-2.5 overflow-x-auto max-w-2xl">
                      {JSON.stringify(act.metadata, null, 2)}
                    </pre>
                  )}

                  <div className="text-[11px] font-mono text-[var(--ink-muted)]">
                    {new Date(act.createdAt).toLocaleString()}
                  </div>
                </div>

                {act.snippetId && (
                  <button
                    type="button"
                    onClick={() => onNavigateToSnippet(act.snippetId!)}
                    className="px-3 py-1.5 rounded-[14px] border border-[var(--border)] hover:bg-[var(--surface-raised)] text-[var(--ink)] text-[11px] font-medium flex items-center gap-1.5 shrink-0 transition-colors focus-ring-visible cursor-pointer"
                  >
                    <span>View snippet</span>
                    <ExternalLink className="w-3 h-3 text-[var(--ink-muted)]" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {currentHasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={isLoadingActivities}
              onClick={() => loadScope(scopeTab, true)}
              className="px-5 py-2.5 rounded-[14px] border border-[var(--border)] hover:bg-[var(--surface-raised)] text-xs font-medium text-[var(--ink)] transition-colors focus-ring-visible cursor-pointer"
            >
              {isLoadingActivities
                ? 'Loading...'
                : 'Load older activity'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
