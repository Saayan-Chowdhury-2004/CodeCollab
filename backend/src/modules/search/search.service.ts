import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  snippets,
  snippetCollaborators,
  snippetTags,
  tags,
  users,
} from '../../db/schema.ts';
import {
  CollaboratorRole,
  EffectiveSnippetRole,
  resolveEffectiveSnippetRole,
  SnippetVisibility,
} from '../../auth/authorize.ts';
import { AuthenticatedUser } from '../../auth/jwt.ts';
import { AppError } from '../../utils/errors.ts';
import { decodeCursor, encodeCursor, PaginatedResult } from '../../utils/pagination.ts';
import { SnippetCollaboratorDTO, SnippetSummaryDTO } from '../snippets/snippets.service.ts';

export type SearchSortMode = 'relevance' | 'newest' | 'oldest' | 'updated';

export interface SnippetSearchHitDTO extends SnippetSummaryDTO {
  rank: number;
  headline: string;
}

export interface SearchSnippetsParams {
  q?: string;
  language?: string;
  tag?: string;
  authorId?: string;
  authorUsername?: string;
  visibility?: SnippetVisibility;
  scope?: 'public' | 'mine' | 'collaborated' | 'all';
  createdFrom?: Date;
  createdTo?: Date;
  sort?: SearchSortMode;
  cursor?: string;
  limit: number;
}

export interface SearchFacetsDTO {
  languages: Array<{ language: string; count: number }>;
  tags: Array<{ name: string; count: number }>;
}

function parseRelevanceCursor(rawSortValue: string | number): {
  rank: number;
  createdAt: Date;
} {
  const parts = String(rawSortValue).split('|');
  if (parts.length !== 2) {
    throw new AppError(400, 'INVALID_CURSOR', 'Malformed relevance pagination cursor');
  }
  const rank = Number(parts[0]);
  const createdAt = new Date(parts[1]);
  if (Number.isNaN(rank) || Number.isNaN(createdAt.getTime())) {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid relevance pagination cursor values');
  }
  return { rank, createdAt };
}

function encodeRelevanceSortValue(rank: number, createdAt: Date): string {
  return `${Number(rank).toFixed(8)}|${createdAt.toISOString()}`;
}

async function buildAccessCondition(
  actor: AuthenticatedUser | null | undefined,
  scope: 'public' | 'mine' | 'collaborated' | 'all' = 'all',
  visibilityFilter?: SnippetVisibility
): Promise<{ condition: SQL | null; emptyShortCircuit: boolean }> {
  if (!actor) {
    if (visibilityFilter && visibilityFilter !== 'public') {
      return { condition: null, emptyShortCircuit: true };
    }
    return { condition: eq(snippets.visibility, 'public'), emptyShortCircuit: false };
  }

  if (scope === 'public') {
    if (visibilityFilter && visibilityFilter !== 'public') {
      return { condition: null, emptyShortCircuit: true };
    }
    return { condition: eq(snippets.visibility, 'public'), emptyShortCircuit: false };
  }

  if (scope === 'mine') {
    const conds: SQL[] = [eq(snippets.ownerId, actor.id)];
    if (visibilityFilter) {
      conds.push(eq(snippets.visibility, visibilityFilter));
    }
    return { condition: and(...conds) ?? null, emptyShortCircuit: false };
  }

  const collabRows = await db
    .select({ snippetId: snippetCollaborators.snippetId })
    .from(snippetCollaborators)
    .where(eq(snippetCollaborators.userId, actor.id));
  const collabIds = collabRows.map((r) => r.snippetId);

  if (scope === 'collaborated') {
    if (collabIds.length === 0) {
      return { condition: null, emptyShortCircuit: true };
    }
    const conds: SQL[] = [inArray(snippets.id, collabIds)];
    if (visibilityFilter) {
      conds.push(eq(snippets.visibility, visibilityFilter));
    }
    return { condition: and(...conds) ?? null, emptyShortCircuit: false };
  }

  // Default scope === 'all':
  // Public snippets + snippets owned by actor + snippets where actor is a collaborator.
  // Never leaks unlisted or private snippets belonging to unrelated users in global search.
  const accessibleBranches: SQL[] = [
    eq(snippets.visibility, 'public'),
    eq(snippets.ownerId, actor.id),
  ];
  if (collabIds.length > 0) {
    accessibleBranches.push(inArray(snippets.id, collabIds));
  }

  const baseAccessible = or(...accessibleBranches)!;
  if (visibilityFilter) {
    return {
      condition: and(baseAccessible, eq(snippets.visibility, visibilityFilter)) ?? null,
      emptyShortCircuit: false,
    };
  }

  return { condition: baseAccessible, emptyShortCircuit: false };
}

export async function searchSnippetsPaginated(
  actor: AuthenticatedUser | null | undefined,
  params: SearchSnippetsParams
): Promise<PaginatedResult<SnippetSearchHitDTO>> {
  try {
    const conditions: SQL[] = [];

    // 1. Access control & visibility condition
    const access = await buildAccessCondition(actor, params.scope || 'all', params.visibility);
    if (access.emptyShortCircuit) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    if (access.condition) {
      conditions.push(access.condition);
    }

    // 2. Language filter
    if (params.language && params.language.trim()) {
      conditions.push(eq(snippets.language, params.language.trim().toLowerCase()));
    }

    // 3. Author filters
    if (params.authorId && params.authorId.trim()) {
      conditions.push(eq(snippets.ownerId, params.authorId.trim()));
    }
    if (params.authorUsername && params.authorUsername.trim()) {
      const normalizedUsername = params.authorUsername.trim().toLowerCase();
      const [authorRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, normalizedUsername));
      if (!authorRow) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      conditions.push(eq(snippets.ownerId, authorRow.id));
    }

    // 4. Tag filter
    if (params.tag && params.tag.trim()) {
      const normalizedTag = params.tag.trim().toLowerCase();
      const matchingTagRows = await db
        .select({ snippetId: snippetTags.snippetId })
        .from(snippetTags)
        .innerJoin(tags, eq(snippetTags.tagId, tags.id))
        .where(eq(tags.name, normalizedTag));
      const taggedSnippetIds = matchingTagRows.map((r) => r.snippetId);
      if (taggedSnippetIds.length === 0) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      conditions.push(inArray(snippets.id, taggedSnippetIds));
    }

    // 5. Created date range filters
    if (params.createdFrom) {
      conditions.push(gte(snippets.createdAt, params.createdFrom));
    }
    if (params.createdTo) {
      conditions.push(lte(snippets.createdAt, params.createdTo));
    }

    // 6. Full-text tsvector query & ranking expression
    const cleanQuery = params.q?.trim() || '';
    const hasFullTextQuery = cleanQuery.length > 0;

    const tsQueryExpr = hasFullTextQuery
      ? sql`websearch_to_tsquery('english', ${cleanQuery})`
      : null;

    if (hasFullTextQuery && tsQueryExpr) {
      conditions.push(sql`${snippets.searchVector} @@ ${tsQueryExpr}`);
    }

    // Round rank to 8 decimal places in SQL so cursor comparisons are exact and deterministic
    const rankExpr =
      hasFullTextQuery && tsQueryExpr
        ? sql<number>`round(ts_rank_cd(${snippets.searchVector}, ${tsQueryExpr})::numeric, 8)::double precision`
        : sql<number>`0::double precision`;

    const headlineExpr =
      hasFullTextQuery && tsQueryExpr
        ? sql<string>`ts_headline('english', ${snippets.currentContent}, ${tsQueryExpr}, 'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2')`
        : sql<string>`left(${snippets.currentContent}, 200)`;

    const effectiveSort: SearchSortMode =
      params.sort || (hasFullTextQuery ? 'relevance' : 'newest');

    // 7. Cursor condition
    if (params.cursor) {
      const decoded = decodeCursor(params.cursor);
      if (effectiveSort === 'relevance' && hasFullTextQuery) {
        const { rank: cursorRank, createdAt: cursorDate } = parseRelevanceCursor(
          decoded.sortValue
        );
        conditions.push(
          sql`(
            ${rankExpr} < ${cursorRank}
            OR (${rankExpr} = ${cursorRank} AND ${snippets.createdAt} < ${cursorDate})
            OR (${rankExpr} = ${cursorRank} AND ${snippets.createdAt} = ${cursorDate} AND ${snippets.id} < ${decoded.id})
          )`
        );
      } else if (effectiveSort === 'oldest') {
        const cursorDate = new Date(String(decoded.sortValue));
        if (Number.isNaN(cursorDate.getTime())) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid date cursor value');
        }
        conditions.push(
          or(
            gt(snippets.createdAt, cursorDate),
            and(eq(snippets.createdAt, cursorDate), gt(snippets.id, decoded.id))
          )!
        );
      } else if (effectiveSort === 'updated') {
        const cursorDate = new Date(String(decoded.sortValue));
        if (Number.isNaN(cursorDate.getTime())) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid date cursor value');
        }
        conditions.push(
          or(
            lt(snippets.updatedAt, cursorDate),
            and(eq(snippets.updatedAt, cursorDate), lt(snippets.id, decoded.id))
          )!
        );
      } else {
        // 'newest' (or 'relevance' fallback when q is empty)
        const cursorDate = new Date(String(decoded.sortValue));
        if (Number.isNaN(cursorDate.getTime())) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid date cursor value');
        }
        conditions.push(
          or(
            lt(snippets.createdAt, cursorDate),
            and(eq(snippets.createdAt, cursorDate), lt(snippets.id, decoded.id))
          )!
        );
      }
    }

    // 8. Order by clause
    const orderByClauses =
      effectiveSort === 'relevance' && hasFullTextQuery
        ? [desc(rankExpr), desc(snippets.createdAt), desc(snippets.id)]
        : effectiveSort === 'oldest'
          ? [asc(snippets.createdAt), asc(snippets.id)]
          : effectiveSort === 'updated'
            ? [desc(snippets.updatedAt), desc(snippets.id)]
            : [desc(snippets.createdAt), desc(snippets.id)];

    const rows = await db
      .select({
        snippet: snippets,
        rank: rankExpr,
        headline: headlineExpr,
      })
      .from(snippets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderByClauses)
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;

    if (slice.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    // Batch-hydrate owners, tags, collaborators for the page of snippets
    const snippetIds = slice.map((r) => r.snippet.id);
    const ownerIds = Array.from(new Set(slice.map((r) => r.snippet.ownerId)));

    const [ownerRows, collabRows, tagRows] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(inArray(users.id, ownerIds)),
      db
        .select({
          id: snippetCollaborators.id,
          snippetId: snippetCollaborators.snippetId,
          userId: snippetCollaborators.userId,
          role: snippetCollaborators.role,
          addedById: snippetCollaborators.addedById,
          createdAt: snippetCollaborators.createdAt,
          username: users.username,
          displayName: users.displayName,
          email: users.email,
          avatarUrl: users.avatarUrl,
        })
        .from(snippetCollaborators)
        .innerJoin(users, eq(snippetCollaborators.userId, users.id))
        .where(inArray(snippetCollaborators.snippetId, snippetIds))
        .orderBy(asc(snippetCollaborators.createdAt)),
      db
        .select({
          snippetId: snippetTags.snippetId,
          name: tags.name,
        })
        .from(snippetTags)
        .innerJoin(tags, eq(snippetTags.tagId, tags.id))
        .where(inArray(snippetTags.snippetId, snippetIds))
        .orderBy(asc(tags.name)),
    ]);

    const ownerMap = new Map(ownerRows.map((o) => [o.id, o]));
    const collabMap = new Map<string, SnippetCollaboratorDTO[]>();
    for (const c of collabRows) {
      const list = collabMap.get(c.snippetId) || [];
      list.push({
        id: c.id,
        userId: c.userId,
        username: c.username,
        displayName: c.displayName,
        email: c.email,
        avatarUrl: c.avatarUrl,
        role: c.role as CollaboratorRole,
        addedById: c.addedById,
        createdAt: c.createdAt,
      });
      collabMap.set(c.snippetId, list);
    }

    const tagsMap = new Map<string, string[]>();
    for (const t of tagRows) {
      const list = tagsMap.get(t.snippetId) || [];
      list.push(t.name);
      tagsMap.set(t.snippetId, list);
    }

    const items: SnippetSearchHitDTO[] = slice.map(({ snippet: s, rank, headline }) => {
      const owner = ownerMap.get(s.ownerId);
      const collabs = collabMap.get(s.id) || [];
      const snippetTagNames = tagsMap.get(s.id) || [];
      const actorCollabRole =
        actor ? (collabs.find((c) => c.userId === actor.id)?.role ?? null) : null;

      const effectiveRole: EffectiveSnippetRole = resolveEffectiveSnippetRole(actor, {
        id: s.id,
        ownerId: s.ownerId,
        visibility: s.visibility as SnippetVisibility,
        collaboratorRole: actorCollabRole,
      });

      const canViewCollaboratorEmails = Boolean(
        actor && (actor.globalRole === 'admin' || actor.id === s.ownerId)
      );

      return {
        id: s.id,
        title: s.title,
        description: s.description,
        language: s.language,
        visibility: s.visibility as SnippetVisibility,
        ownerId: s.ownerId,
        owner: {
          id: owner?.id || s.ownerId,
          username: owner?.username || 'unknown',
          displayName: owner?.displayName || 'Unknown User',
          avatarUrl: owner?.avatarUrl || null,
        },
        contentLength: s.currentContent ? s.currentContent.length : 0,
        currentVersionId: s.currentVersionId,
        latestVersionNumber: s.latestVersionNumber,
        tags: snippetTagNames,
        collaborators: collabs.map((c) => ({
          ...c,
          email: canViewCollaboratorEmails ? c.email : null,
        })),
        effectiveRole,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        rank: Number(rank ?? 0),
        headline: headline || (s.currentContent ? s.currentContent.slice(0, 200) : ''),
      };
    });

    const lastRow = slice[slice.length - 1];
    let nextCursor: string | null = null;
    if (hasMore && lastRow) {
      if (effectiveSort === 'relevance' && hasFullTextQuery) {
        nextCursor = encodeCursor({
          sortValue: encodeRelevanceSortValue(Number(lastRow.rank ?? 0), lastRow.snippet.createdAt),
          id: lastRow.snippet.id,
        });
      } else if (effectiveSort === 'updated') {
        nextCursor = encodeCursor({
          sortValue: lastRow.snippet.updatedAt.toISOString(),
          id: lastRow.snippet.id,
        });
      } else {
        nextCursor = encodeCursor({
          sortValue: lastRow.snippet.createdAt.toISOString(),
          id: lastRow.snippet.id,
        });
      }
    }

    return {
      items,
      nextCursor,
      hasMore,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to execute full-text snippet search:', error);
    throw new Error('Database error executing snippet search.', { cause: error });
  }
}

export async function getSearchFacets(
  actor: AuthenticatedUser | null | undefined
): Promise<SearchFacetsDTO> {
  try {
    const access = await buildAccessCondition(actor, 'all');
    if (access.emptyShortCircuit) {
      return { languages: [], tags: [] };
    }

    const languageRows = await db
      .select({
        language: snippets.language,
        count: sql<number>`count(*)::int`,
      })
      .from(snippets)
      .where(access.condition ?? undefined)
      .groupBy(snippets.language)
      .orderBy(desc(sql`count(*)`), asc(snippets.language))
      .limit(30);

    const tagRows = await db
      .select({
        name: tags.name,
        count: sql<number>`count(distinct ${snippetTags.snippetId})::int`,
      })
      .from(tags)
      .innerJoin(snippetTags, eq(tags.id, snippetTags.tagId))
      .innerJoin(snippets, eq(snippetTags.snippetId, snippets.id))
      .where(access.condition ?? undefined)
      .groupBy(tags.name)
      .orderBy(desc(sql`count(distinct ${snippetTags.snippetId})`), asc(tags.name))
      .limit(50);

    return {
      languages: languageRows.map((r) => ({ language: r.language, count: Number(r.count) })),
      tags: tagRows.map((r) => ({ name: r.name, count: Number(r.count) })),
    };
  } catch (error) {
    console.error('Failed to load search facets:', error);
    throw new Error('Database error loading search facets.', { cause: error });
  }
}
