import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  Code2,
  Filter,
  FolderOpen,
  Globe,
  Link2,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Tag,
  User,
  Users,
  X,
} from 'lucide-react';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { useAuthStore } from '../../store/authStore.ts';
import {
  SearchSortMode,
  SnippetScopeMode,
  SnippetVisibility,
} from '../../types/domain.ts';
import { formatRelativeTime, getLanguageColor } from '../../utils/format.ts';
import { SidebarProfileBlock } from './SidebarProfileBlock.tsx';
import { SidebarFacetsTree } from './SidebarFacetsTree.tsx';
import { CustomSelect } from '../ui/CustomSelect.tsx';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'oldest', label: 'Oldest first' },
];

const SIDEBAR_VISIBILITY_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

function renderSafeHighlightedHeadline(headline: string): React.ReactNode {
  if (!headline) return null;
  const parts = headline.split(/(<mark>.*?<\/mark>)/gi);
  return parts.map((part, idx) => {
    const match = /^<mark>(.*?)<\/mark>$/i.exec(part);
    if (match) {
      return (
        <mark
          key={idx}
          className="bg-[var(--surface-raised)] text-[var(--ink)] px-0.5 rounded font-mono font-semibold"
        >
          {match[1]}
        </mark>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export interface SnippetExplorerSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenAuthModal?: (mode: 'login' | 'register') => void;
  onOpenProfileModal?: () => void;
  onOpenCreateSnippetModal?: () => void;
}

export const SnippetExplorerSidebar: React.FC<SnippetExplorerSidebarProps> = ({
  isOpen = true,
  onClose,
  onOpenAuthModal,
  onOpenProfileModal,
  onOpenCreateSnippetModal,
}) => {
  const { user } = useAuthStore();
  const {
    items,
    hasMore,
    isLoadingList,
    listError,
    facets,
    filters,
    activeSnippet,
    setFilters,
    resetFilters,
    fetchSnippets,
    selectSnippet,
  } = useSnippetStore();

  const [showFiltersPopover, setShowFiltersPopover] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [hoveredSnippetId, setHoveredSnippetId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowFiltersPopover(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({ q: searchInput });
  };

  const handleClearFilters = () => {
    setSearchInput('');
    resetFilters();
    setShowFiltersPopover(false);
  };

  const isCustomSort = filters.q.trim()
    ? filters.sort !== 'relevance'
    : filters.sort !== 'newest';

  const hasActiveFilters =
    Boolean(filters.q.trim()) ||
    Boolean(filters.language) ||
    Boolean(filters.tag) ||
    Boolean(filters.authorUsername) ||
    Boolean(filters.visibility) ||
    filters.scope !== 'all' ||
    Boolean(filters.createdFrom) ||
    Boolean(filters.createdTo) ||
    isCustomSort;

  const filterCount = [
    Boolean(filters.language),
    Boolean(filters.tag),
    Boolean(filters.authorUsername),
    Boolean(filters.visibility),
    Boolean(filters.createdFrom || filters.createdTo),
    isCustomSort,
  ].filter(Boolean).length;

  return (
    <aside
      className={`w-80 rounded-[28px] frosted-surface flex flex-col h-full shrink-0 select-none transition-transform z-20 overflow-hidden ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
    >
      {/* Top Header: Collapse Button */}
      <div className="flex items-center justify-end px-4 pt-3 pb-1 shrink-0">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse sidebar"
            title="Collapse sidebar (<)"
            className="p-1.5 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors focus-visible:outline-none focus-ring-visible"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Top Profile Block */}
      <div className="px-3 py-1 shrink-0">
        <SidebarProfileBlock
          onOpenAuthModal={onOpenAuthModal}
          onOpenProfileModal={onOpenProfileModal}
        />
      </div>

      {/* Scrollable Explorer Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {/* Titled Group: Snippets Scope Navigation */}
        <div className="space-y-1">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--ink-muted)] px-2">
            Snippets
          </div>
          {(
            [
              { id: 'all', label: 'All', icon: FolderOpen },
              { id: 'public', label: 'Public', icon: Globe },
              { id: 'mine', label: 'Mine', icon: User, authOnly: true },
              { id: 'collaborated', label: 'Shared', icon: Users, authOnly: true },
            ] as Array<{ id: SnippetScopeMode; label: string; icon: React.ComponentType<{ className?: string }>; authOnly?: boolean }>
          ).map((tab) => {
            const Icon = tab.icon;
            const disabled = tab.authOnly && !user;
            const active = filters.scope === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                disabled={disabled}
                onClick={() => setFilters({ scope: tab.id })}
                className={`w-full flex items-center justify-between py-1.5 px-3 rounded-[14px] text-xs transition-colors duration-150 ${active
                    ? 'bg-[var(--surface-raised)] shadow-raised text-[var(--ink)] font-semibold'
                    : disabled
                      ? 'text-[var(--ink-muted)]/40 cursor-not-allowed'
                      : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
                  }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </div>
              </button>
            );
          })}

          {/* Create new snippet option below Shared */}
          <button
            type="button"
            onClick={onOpenCreateSnippetModal}
            className="w-full flex items-center justify-between py-1.5 px-3 rounded-[14px] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)]/60 transition-colors duration-150 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Plus className="w-4 h-4 text-[var(--ink)]" />
              <span>Create</span>
            </div>
          </button>
        </div>

        {/* Inset Search Field & Compact Filters Row */}
        <div className="space-y-2 pt-1">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                if (e.target.value === '') setFilters({ q: '' });
              }}
              placeholder="Search snippets"
              aria-label="Search snippets"
              className="w-full shadow-inset rounded-[14px] pl-9 pr-8 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] bg-[var(--surface)]/30 border border-transparent focus:border-[var(--ink-muted)] outline-none transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setFilters({ q: '' });
                }}
                aria-label="Clear search text"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </form>

          {/* Compact Filter Row */}
          <div className="flex items-center justify-between relative" ref={popoverRef}>
            <button
              type="button"
              onClick={() => setShowFiltersPopover((v) => !v)}
              aria-expanded={showFiltersPopover}
              aria-label="Toggle filter options"
              className={`w-full py-1.5 px-3 rounded-[14px] text-xs font-medium border border-[var(--border)] flex items-center justify-between transition-colors ${showFiltersPopover || filterCount > 0
                  ? 'bg-[var(--surface-raised)] text-[var(--ink)] shadow-raised'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
                }`}
            >
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5" />
                <span>Filters</span>
              </div>
              {filterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-[var(--ink)] text-[var(--ink-contrast)] text-[9px] font-mono flex items-center justify-center font-bold">
                  {filterCount}
                </span>
              )}
            </button>

            {/* Popover */}
            {showFiltersPopover && (
              <div className="absolute top-full left-0 right-0 mt-2 rounded-2xl popover-surface shadow-2xl p-3 z-50 text-xs space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                  <span className="font-semibold text-[var(--ink)]">Search Filters</span>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--ink-muted)] mb-1">
                    Sort by
                  </label>
                  <CustomSelect
                    value={filters.sort}
                    onChange={(val) => setFilters({ sort: val as SearchSortMode })}
                    options={SORT_OPTIONS}
                    aria-label="Sort by"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--ink-muted)] mb-1">
                      Visibility
                    </label>
                    <CustomSelect
                      value={filters.visibility}
                      onChange={(val) => setFilters({ visibility: val as '' | SnippetVisibility })}
                      options={SIDEBAR_VISIBILITY_OPTIONS}
                      aria-label="Filter visibility"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--ink-muted)] mb-1">
                      Author
                    </label>
                    <input
                      type="text"
                      value={filters.authorUsername}
                      onChange={(e) => setFilters({ authorUsername: e.target.value })}
                      placeholder="@username"
                      className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[10px] px-2 py-1 text-xs text-[var(--ink)] outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tree of Languages and Tags */}
        <SidebarFacetsTree />

        {/* Snippet List: Framed Inset Panel */}
        <div className="space-y-1.5 pt-2">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--ink-muted)] px-2">
            Results ({items.length})
          </div>

          <div className="shadow-inset rounded-[20px] bg-[var(--surface)]/25 border border-[var(--border)] p-1.5 space-y-1 overflow-hidden min-h-[160px] isolate transform-gpu">
            {listError && (
              <div className="p-3 bg-[var(--surface-raised)] rounded-xl border border-[var(--border)] text-xs text-[var(--ink)]">
                {listError}
              </div>
            )}

            {isLoadingList && items.length === 0 ? (
              <div className="p-2 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-3 rounded-[14px] bg-[var(--surface-raised)]/40 animate-pulse space-y-2">
                    <div className="h-3.5 bg-[var(--surface-raised)] rounded w-3/4" />
                    <div className="h-2.5 bg-[var(--surface-raised)] rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center flex flex-col items-center justify-center space-y-2">
                <span className="text-xl text-[var(--ink-muted)] font-mono">「 」</span>
                <p className="text-xs font-medium text-[var(--ink)]">No snippets found</p>
                <p className="text-[11px] text-[var(--ink-muted)]">Try refining your search or filters.</p>
              </div>
            ) : (
              items.map((snippet) => {
                const isSelected = activeSnippet?.id === snippet.id;
                const langColor = getLanguageColor(snippet.language);
                const remainingTagsCount = Math.max(0, snippet.tags.length - 3);

                return (
                  <button
                    key={snippet.id}
                    type="button"
                    onClick={() => {
                      selectSnippet(snippet.id);
                      if (onClose) onClose();
                    }}
                    className={`w-full text-left p-2.5 rounded-[14px] transition-colors duration-150 block focus-visible:outline-none focus-ring-visible cursor-pointer relative will-change-[background-color] ${isSelected
                        ? 'bg-[var(--surface-raised)] shadow-raised text-[var(--ink)]'
                        : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/50'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <h4 className="text-xs font-medium text-[var(--ink)] truncate">
                        {snippet.title}
                      </h4>
                      <div className="shrink-0 text-[var(--ink-muted)]">
                        {snippet.visibility === 'public' ? (
                          <Globe className="w-3 h-3 text-[var(--ink-muted)]" />
                        ) : snippet.visibility === 'unlisted' ? (
                          <Link2 className="w-3 h-3 text-[var(--ink-muted)]" />
                        ) : (
                          <Lock className="w-3 h-3 text-[var(--ink-muted)]" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[var(--ink-muted)]">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: langColor }}
                      />
                      <span className="font-medium text-[var(--ink)]">{snippet.language}</span>
                      <span>·</span>
                      <span className="truncate">@{snippet.owner.username}</span>
                      <span>·</span>
                      <span className="shrink-0 text-[10px]">
                        {formatRelativeTime(snippet.updatedAt || snippet.createdAt)}
                      </span>
                    </div>

                    {snippet.tags.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        {snippet.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink-muted)]"
                          >
                            #{tag}
                          </span>
                        ))}
                        {remainingTagsCount > 0 && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--surface-raised)] text-[var(--ink-muted)]">
                            +{remainingTagsCount}
                          </span>
                        )}
                      </div>
                    )}

                    {snippet.headline && filters.q && (
                      <div className="mt-1.5 text-[10px] font-mono text-[var(--ink-muted)] truncate">
                        {renderSafeHighlightedHeadline(snippet.headline)}
                      </div>
                    )}
                  </button>
                );
              })
            )}

            {hasMore && (
              <div className="p-1">
                <button
                  type="button"
                  disabled={isLoadingList}
                  onClick={() => fetchSnippets({ append: true })}
                  className="w-full py-1.5 rounded-[10px] border border-[var(--border)] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors"
                >
                  {isLoadingList ? 'Loading...' : 'Load more snippets'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
