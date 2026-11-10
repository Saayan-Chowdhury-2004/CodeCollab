import { create } from 'zustand';
import { apiFetch, ApiClientError } from '../api/client.ts';
import {
  CollaboratorRole,
  EffectiveSnippetRole,
  PaginatedResult,
  SearchFacetsDTO,
  SearchSortMode,
  SnippetCollaboratorDTO,
  SnippetDetailDTO,
  SnippetDiffDTO,
  SnippetScopeMode,
  SnippetSearchHitDTO,
  SnippetSummaryDTO,
  SnippetVersionDTO,
  SnippetVersionSummaryDTO,
  SnippetVisibility,
} from '../types/domain.ts';
import { isVirtualOrDevUser } from '../utils/format.ts';

export interface SnippetSearchFilters {
  q: string;
  language: string;
  tag: string;
  authorUsername: string;
  visibility: '' | SnippetVisibility;
  scope: SnippetScopeMode;
  createdFrom: string;
  createdTo: string;
  sort: SearchSortMode;
}

interface SnippetStoreState {
  items: SnippetSearchHitDTO[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoadingList: boolean;
  listError: string | null;
  facets: SearchFacetsDTO;
  filters: SnippetSearchFilters;

  activeSnippet: SnippetDetailDTO | null;
  isLoadingSnippet: boolean;
  snippetError: string | null;

  versions: SnippetVersionSummaryDTO[];
  versionsNextCursor: string | null;
  versionsHasMore: boolean;
  isLoadingVersions: boolean;

  diffResult: SnippetDiffDTO | null;
  isLoadingDiff: boolean;
  diffError: string | null;

  setFilters: (partial: Partial<SnippetSearchFilters>, autoFetch?: boolean) => Promise<void>;
  resetFilters: () => Promise<void>;
  fetchSnippets: (opts?: { append?: boolean; autoSelect?: boolean }) => Promise<void>;
  fetchFacets: () => Promise<void>;
  selectSnippet: (snippetId: string | null) => Promise<SnippetDetailDTO | null>;
  refreshActiveSnippet: () => Promise<void>;
  createSnippet: (input: {
    title: string;
    description: string;
    language: string;
    visibility: SnippetVisibility;
    content: string;
    tags: string[];
  }) => Promise<SnippetDetailDTO>;
  updateActiveSnippet: (input: {
    title?: string;
    description?: string;
    language?: string;
    visibility?: SnippetVisibility;
    content?: string;
    tags?: string[];
    versionSummary?: string;
  }) => Promise<SnippetDetailDTO>;
  deleteSnippet: (snippetId: string) => Promise<void>;

  fetchVersions: (snippetId: string, opts?: { append?: boolean }) => Promise<void>;
  createVersionSnapshot: (snippetId: string, summary?: string, content?: string) => Promise<SnippetVersionDTO>;
  restoreVersion: (snippetId: string, versionId: string) => Promise<SnippetDetailDTO>;
  computeDiff: (snippetId: string, fromVersionId: string, toVersionId: string) => Promise<SnippetDiffDTO>;
  clearDiff: () => void;

  addCollaborator: (
    snippetId: string,
    input: { username?: string; email?: string; userId?: string; role: CollaboratorRole }
  ) => Promise<SnippetCollaboratorDTO>;
  removeCollaborator: (snippetId: string, userId: string) => Promise<void>;
  syncActiveSnippetContentLocal: (
    content: string,
    latestVersionNumber?: number,
    currentVersionId?: string | null,
    meta?: {
      title?: string;
      tags?: string[];
      visibility?: SnippetVisibility;
      effectiveRole?: EffectiveSnippetRole;
    }
  ) => void;
}

const DEFAULT_FILTERS: SnippetSearchFilters = {
  q: '',
  language: '',
  tag: '',
  authorUsername: '',
  visibility: '',
  scope: 'all',
  createdFrom: '',
  createdTo: '',
  sort: 'newest',
};

export const useSnippetStore = create<SnippetStoreState>((set, get) => ({
  items: [],
  nextCursor: null,
  hasMore: false,
  isLoadingList: false,
  listError: null,
  facets: { languages: [], tags: [] },
  filters: { ...DEFAULT_FILTERS },

  activeSnippet: null,
  isLoadingSnippet: false,
  snippetError: null,

  versions: [],
  versionsNextCursor: null,
  versionsHasMore: false,
  isLoadingVersions: false,

  diffResult: null,
  isLoadingDiff: false,
  diffError: null,

  setFilters: async (partial, autoFetch = true) => {
    const current = get().filters;
    const next = { ...current, ...partial };
    // Automatically switch sort to 'relevance' when user enters a search query
    if (partial.q !== undefined) {
      if (partial.q.trim() && current.sort === 'newest' && partial.sort === undefined) {
        next.sort = 'relevance';
      } else if (!partial.q.trim() && next.sort === 'relevance' && partial.sort === undefined) {
        next.sort = 'newest';
      }
    }
    set({ filters: next });
    if (autoFetch) {
      await get().fetchSnippets({ append: false });
    }
  },

  resetFilters: async () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    await get().fetchSnippets({ append: false });
  },

  fetchSnippets: async (opts = { append: false, autoSelect: false }) => {
    const { filters, nextCursor, items } = get();
    set({ isLoadingList: true, listError: null });

    try {
      const params = new URLSearchParams();
      if (filters.q.trim()) params.set('q', filters.q.trim());
      if (filters.language) params.set('language', filters.language);
      if (filters.tag) params.set('tag', filters.tag);
      if (filters.authorUsername.trim()) {
        params.set('authorUsername', filters.authorUsername.trim());
      }
      if (filters.visibility) params.set('visibility', filters.visibility);
      if (filters.scope) params.set('scope', filters.scope);
      if (filters.createdFrom) {
        params.set('createdFrom', new Date(filters.createdFrom).toISOString());
      }
      if (filters.createdTo) {
        params.set('createdTo', new Date(filters.createdTo).toISOString());
      }
      if (filters.sort) params.set('sort', filters.sort);
      params.set('limit', '12');

      if (opts.append && nextCursor) {
        params.set('cursor', nextCursor);
      }

      const data = await apiFetch<PaginatedResult<SnippetSearchHitDTO>>(
        `/api/search/snippets?${params.toString()}`
      );

      const cleanItems = data.items.filter(
        (hit) => !isVirtualOrDevUser(hit.owner?.username)
      );

      const merged = opts.append ? [...items, ...cleanItems] : cleanItems;
      set({
        items: merged,
        nextCursor: data.nextCursor,
        hasMore: data.hasMore,
        isLoadingList: false,
      });

      // Auto-select first snippet if none is currently active and explicitly requested
      if (opts.autoSelect && !get().activeSnippet && merged.length > 0) {
        await get().selectSnippet(merged[0].id);
      }
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : 'Failed to load snippets';
      set({ isLoadingList: false, listError: message });
    }
  },

  fetchFacets: async () => {
    try {
      const facets = await apiFetch<SearchFacetsDTO>('/api/search/facets');
      set({ facets });
    } catch {
      // Ignore facet errors silently
    }
  },

  selectSnippet: async (snippetId) => {
    if (!snippetId) {
      set({ activeSnippet: null, isLoadingSnippet: false, snippetError: null, diffResult: null });
      return null;
    }
    set({ isLoadingSnippet: true, snippetError: null, diffResult: null });
    try {
      const res = await apiFetch<{ snippet: SnippetDetailDTO }>(
        `/api/snippets/${snippetId}`
      );
      const cleanedSnippet = {
        ...res.snippet,
        collaborators: (res.snippet.collaborators || []).filter(
          (c) => !isVirtualOrDevUser(c.username)
        ),
      };
      set({ activeSnippet: cleanedSnippet, isLoadingSnippet: false });
      await get().fetchVersions(snippetId, { append: false });
      return cleanedSnippet;
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : 'Failed to load snippet';
      set({ isLoadingSnippet: false, snippetError: message });
      return null;
    }
  },

  refreshActiveSnippet: async () => {
    const active = get().activeSnippet;
    if (!active) return;
    try {
      const res = await apiFetch<{ snippet: SnippetDetailDTO }>(
        `/api/snippets/${active.id}`
      );
      const cleanedSnippet = {
        ...res.snippet,
        collaborators: (res.snippet.collaborators || []).filter(
          (c) => !isVirtualOrDevUser(c.username)
        ),
      };
      set({ activeSnippet: cleanedSnippet });
    } catch {
      // Ignore transient errors
    }
  },

  createSnippet: async (input) => {
    const res = await apiFetch<{ snippet: SnippetDetailDTO }>('/api/snippets', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    set({ activeSnippet: res.snippet });
    await Promise.all([
      get().fetchSnippets({ append: false }),
      get().fetchFacets(),
      get().fetchVersions(res.snippet.id, { append: false }),
    ]);
    return res.snippet;
  },

  updateActiveSnippet: async (input) => {
    const active = get().activeSnippet;
    if (!active) throw new Error('No active snippet selected');

    const res = await apiFetch<{ snippet: SnippetDetailDTO }>(
      `/api/snippets/${active.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    );

    set({ activeSnippet: res.snippet });
    await Promise.all([
      get().fetchSnippets({ append: false }),
      get().fetchFacets(),
      get().fetchVersions(active.id, { append: false }),
    ]);
    return res.snippet;
  },

  deleteSnippet: async (snippetId) => {
    await apiFetch(`/api/snippets/${snippetId}`, {
      method: 'DELETE',
    });
    const isDeletingActive = get().activeSnippet?.id === snippetId;
    if (isDeletingActive) {
      set({ activeSnippet: null, versions: [], diffResult: null });
    }
    await Promise.all([
      get().fetchSnippets({ append: false }),
      get().fetchFacets(),
    ]);
  },

  fetchVersions: async (snippetId, opts = { append: false }) => {
    const { versions, versionsNextCursor } = get();
    set({ isLoadingVersions: true });
    try {
      const params = new URLSearchParams({ limit: '15' });
      if (opts.append && versionsNextCursor) {
        params.set('cursor', versionsNextCursor);
      }
      const data = await apiFetch<PaginatedResult<SnippetVersionDTO>>(
        `/api/snippets/${snippetId}/versions?${params.toString()}`
      );
      set({
        versions: opts.append ? [...versions, ...data.items] : data.items,
        versionsNextCursor: data.nextCursor,
        versionsHasMore: data.hasMore,
        isLoadingVersions: false,
      });
    } catch {
      set({ isLoadingVersions: false });
    }
  },

  createVersionSnapshot: async (snippetId, summary, content) => {
    const res = await apiFetch<{ version: SnippetVersionDTO }>(
      `/api/snippets/${snippetId}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...(summary ? { summary } : {}),
          ...(content !== undefined ? { content } : {}),
        }),
      }
    );
    await Promise.all([
      get().refreshActiveSnippet(),
      get().fetchVersions(snippetId, { append: false }),
    ]);
    return res.version;
  },

  restoreVersion: async (snippetId, versionId) => {
    const res = await apiFetch<{
      snippet: SnippetDetailDTO;
      restoredVersion: SnippetVersionDTO;
    }>(`/api/snippets/${snippetId}/versions/${versionId}/restore`, {
      method: 'POST',
    });
    set({ activeSnippet: res.snippet });
    await Promise.all([
      get().fetchVersions(snippetId, { append: false }),
      get().fetchSnippets({ append: false }),
    ]);
    return res.snippet;
  },

  computeDiff: async (snippetId, fromVersionId, toVersionId) => {
    set({ isLoadingDiff: true, diffError: null });
    try {
      const res = await apiFetch<{ diff: SnippetDiffDTO }>(
        `/api/snippets/${snippetId}/diff?from=${encodeURIComponent(
          fromVersionId
        )}&to=${encodeURIComponent(toVersionId)}`
      );
      set({ diffResult: res.diff, isLoadingDiff: false });
      return res.diff;
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : 'Failed to compute diff';
      set({ isLoadingDiff: false, diffError: message });
      throw err;
    }
  },

  clearDiff: () => set({ diffResult: null, diffError: null }),

  addCollaborator: async (snippetId, input) => {
    const res = await apiFetch<{ collaborator: SnippetCollaboratorDTO }>(
      `/api/snippets/${snippetId}/collaborators`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    await get().refreshActiveSnippet();
    return res.collaborator;
  },

  removeCollaborator: async (snippetId, userId) => {
    await apiFetch(`/api/snippets/${snippetId}/collaborators/${userId}`, {
      method: 'DELETE',
    });
    await get().refreshActiveSnippet();
  },

  syncActiveSnippetContentLocal: (content, latestVersionNumber, currentVersionId, meta) => {
    const active = get().activeSnippet;
    if (!active) return;
    set({
      activeSnippet: {
        ...active,
        currentContent: content,
        ...(latestVersionNumber !== undefined ? { latestVersionNumber } : {}),
        ...(currentVersionId !== undefined ? { currentVersionId } : {}),
        ...(meta?.title !== undefined ? { title: meta.title } : {}),
        ...(meta?.tags !== undefined ? { tags: meta.tags } : {}),
        ...(meta?.visibility !== undefined ? { visibility: meta.visibility } : {}),
        ...(meta?.effectiveRole !== undefined ? { effectiveRole: meta.effectiveRole } : {}),
      },
    });
  },
}));
