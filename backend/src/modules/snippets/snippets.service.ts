import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import { diffLines } from 'diff';
import { db } from '../../db/index.ts';
import {
  snippets,
  snippetVersions,
  snippetCollaborators,
  tags,
  snippetTags,
  users,
} from '../../db/schema.ts';
import {
  CollaboratorRole,
  EffectiveSnippetRole,
  resolveEffectiveSnippetRole,
  SnippetAuthorizationResource,
  SnippetVisibility,
} from '../../auth/authorize.ts';
import { AuthenticatedUser } from '../../auth/jwt.ts';
import { AppError } from '../../utils/errors.ts';
import { sanitizePlainText } from '../../utils/sanitize.ts';
import {
  decodeCursor,
  decodeDateCursor,
  decodeNumericCursor,
  encodeCursor,
  PaginatedResult,
} from '../../utils/pagination.ts';
import { domainEventBus } from '../activity/event-bus.ts';
import { createAndDispatchNotification } from '../notifications/notifications.service.ts';
import { yjsRoomHub } from '../../realtime/yjs-room-hub.ts';
import { getIO } from '../../realtime/socket-server.ts';

export interface SnippetCollaboratorDTO {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  role: CollaboratorRole;
  addedById: string | null;
  createdAt: Date;
}

export interface SnippetVersionDTO {
  id: string;
  snippetId: string;
  versionNumber: number;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  content: string;
  summary: string;
  source: string;
  createdAt: Date;
}

export interface SnippetVersionSummaryDTO {
  id: string;
  snippetId: string;
  versionNumber: number;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  contentLength: number;
  summary: string;
  source: string;
  createdAt: Date;
}

export interface SnippetSummaryDTO {
  id: string;
  title: string;
  description: string;
  language: string;
  visibility: SnippetVisibility;
  ownerId: string;
  owner: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  currentContent?: string;
  contentLength: number;
  currentVersionId: string | null;
  latestVersionNumber: number;
  tags: string[];
  collaborators: SnippetCollaboratorDTO[];
  effectiveRole: EffectiveSnippetRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface SnippetDetailDTO extends SnippetSummaryDTO {
  currentContent: string;
}

export interface DiffLineDTO {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface SnippetDiffDTO {
  snippetId: string;
  fromVersion: {
    id: string;
    versionNumber: number;
    summary: string;
    createdAt: Date;
  };
  toVersion: {
    id: string;
    versionNumber: number;
    summary: string;
    createdAt: Date;
  };
  stats: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
  lines: DiffLineDTO[];
}

export function normalizeTagList(rawTags: string[] = []): string[] {
  const unique = new Set<string>();
  for (const raw of rawTags) {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_+#.-]/g, '')
      .slice(0, 48);
    if (cleaned.length > 0) {
      unique.add(cleaned);
    }
  }
  return Array.from(unique).slice(0, 15);
}

type DbExecutor = Pick<typeof db, 'delete' | 'insert'>;

export async function syncSnippetTags(
  snippetId: string,
  normalizedTags: string[],
  executor: DbExecutor = db
): Promise<void> {
  try {
    await executor.delete(snippetTags).where(eq(snippetTags.snippetId, snippetId));

    if (normalizedTags.length === 0) {
      return;
    }

    for (const tagName of normalizedTags) {
      const [tagRow] = await executor
        .insert(tags)
        .values({ name: tagName })
        .onConflictDoUpdate({
          target: tags.name,
          set: { name: tagName },
        })
        .returning();

      await executor
        .insert(snippetTags)
        .values({ snippetId, tagId: tagRow.id })
        .onConflictDoNothing();
    }
  } catch (error) {
    console.error('Failed to sync snippet tags:', error);
    throw new Error('Database error syncing snippet tags.', { cause: error });
  }
}

export async function loadSnippetAuthContext(
  snippetId: string,
  actor: AuthenticatedUser | null | undefined
): Promise<{
  snippetRow: typeof snippets.$inferSelect;
  authResource: SnippetAuthorizationResource;
}> {
  let snippetRow: typeof snippets.$inferSelect | undefined;
  try {
    const rows = await db.select().from(snippets).where(eq(snippets.id, snippetId));
    snippetRow = rows[0];
  } catch (error) {
    console.error('Database query failed loading snippet:', error);
    throw new Error('Database error loading snippet.', { cause: error });
  }

  if (!snippetRow) {
    throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
  }

  let collaboratorRole: CollaboratorRole | null = null;
  if (actor) {
    try {
      const collabRows = await db
        .select()
        .from(snippetCollaborators)
        .where(
          and(
            eq(snippetCollaborators.snippetId, snippetId),
            eq(snippetCollaborators.userId, actor.id)
          )
        );
      if (collabRows[0]) {
        collaboratorRole = collabRows[0].role as CollaboratorRole;
      }
    } catch (error) {
      console.error('Database query failed checking collaborator role:', error);
      throw new Error('Database error loading collaborator role.', { cause: error });
    }
  }

  return {
    snippetRow,
    authResource: {
      id: snippetRow.id,
      ownerId: snippetRow.ownerId,
      visibility: snippetRow.visibility as SnippetVisibility,
      collaboratorRole,
    },
  };
}

export async function hydrateSnippetDetail(
  snippetRow: typeof snippets.$inferSelect,
  actor: AuthenticatedUser | null | undefined,
  authResource?: SnippetAuthorizationResource
): Promise<SnippetDetailDTO> {
  try {
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, snippetRow.ownerId));

    const collabJoined = await db
      .select({
        id: snippetCollaborators.id,
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
      .where(eq(snippetCollaborators.snippetId, snippetRow.id))
      .orderBy(asc(snippetCollaborators.createdAt));

    const tagRows = await db
      .select({ name: tags.name })
      .from(snippetTags)
      .innerJoin(tags, eq(snippetTags.tagId, tags.id))
      .where(eq(snippetTags.snippetId, snippetRow.id))
      .orderBy(asc(tags.name));

    const resolvedAuthResource: SnippetAuthorizationResource = authResource || {
      id: snippetRow.id,
      ownerId: snippetRow.ownerId,
      visibility: snippetRow.visibility as SnippetVisibility,
      collaboratorRole:
        (actor &&
          (collabJoined.find((c) => c.userId === actor.id)?.role as CollaboratorRole | undefined)) ||
        null,
    };

    const effectiveRole = resolveEffectiveSnippetRole(actor, resolvedAuthResource);

    // Security: Hide collaborator emails from everyone except snippet owner or global admin
    const canViewCollaboratorEmails = Boolean(
      actor && (actor.globalRole === 'admin' || actor.id === snippetRow.ownerId)
    );

    return {
      id: snippetRow.id,
      title: snippetRow.title,
      description: snippetRow.description,
      language: snippetRow.language,
      visibility: snippetRow.visibility as SnippetVisibility,
      ownerId: snippetRow.ownerId,
      owner: {
        id: ownerRow?.id || snippetRow.ownerId,
        username: ownerRow?.username || 'unknown',
        displayName: ownerRow?.displayName || 'Unknown User',
        avatarUrl: ownerRow?.avatarUrl || null,
      },
      currentContent: snippetRow.currentContent,
      contentLength: snippetRow.currentContent ? snippetRow.currentContent.length : 0,
      currentVersionId: snippetRow.currentVersionId,
      latestVersionNumber: snippetRow.latestVersionNumber,
      tags: tagRows.map((t) => t.name),
      collaborators: collabJoined.map((c) => ({
        id: c.id,
        userId: c.userId,
        username: c.username,
        displayName: c.displayName,
        email: canViewCollaboratorEmails ? c.email : null,
        avatarUrl: c.avatarUrl,
        role: c.role as CollaboratorRole,
        addedById: c.addedById,
        createdAt: c.createdAt,
      })),
      effectiveRole,
      createdAt: snippetRow.createdAt,
      updatedAt: snippetRow.updatedAt,
    };
  } catch (error) {
    console.error('Failed to hydrate snippet detail:', error);
    throw new Error('Database error hydrating snippet detail.', { cause: error });
  }
}

/**
 * P2-1: Batch loads relations (owners, tags, collaborators) for a page of snippets
 * using inArray queries, eliminating the N+1 query problem and omitting currentContent.
 */
export async function batchHydrateSnippetSummaries(
  snippetRows: Array<typeof snippets.$inferSelect>,
  actor: AuthenticatedUser | null | undefined
): Promise<SnippetSummaryDTO[]> {
  if (snippetRows.length === 0) return [];

  const snippetIds = snippetRows.map((r) => r.id);
  const ownerIds = Array.from(new Set(snippetRows.map((r) => r.ownerId)));

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
  const collabsBySnippet = new Map<string, typeof collabRows>();
  for (const c of collabRows) {
    const list = collabsBySnippet.get(c.snippetId) || [];
    list.push(c);
    collabsBySnippet.set(c.snippetId, list);
  }

  const tagsBySnippet = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsBySnippet.get(t.snippetId) || [];
    list.push(t.name);
    tagsBySnippet.set(t.snippetId, list);
  }

  return snippetRows.map((row) => {
    const collabs = collabsBySnippet.get(row.id) || [];
    const canViewCollaboratorEmails = Boolean(
      actor && (actor.globalRole === 'admin' || actor.id === row.ownerId)
    );
    const myCollab = actor ? collabs.find((c) => c.userId === actor.id) : null;
    const authResource: SnippetAuthorizationResource = {
      id: row.id,
      ownerId: row.ownerId,
      visibility: row.visibility as SnippetVisibility,
      collaboratorRole: (myCollab?.role as CollaboratorRole) || null,
    };
    const effectiveRole = resolveEffectiveSnippetRole(actor, authResource);

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      language: row.language,
      visibility: row.visibility as SnippetVisibility,
      ownerId: row.ownerId,
      owner: ownerMap.get(row.ownerId) || {
        id: row.ownerId,
        username: 'unknown',
        displayName: 'Unknown User',
        avatarUrl: null,
      },
      currentVersionId: row.currentVersionId,
      latestVersionNumber: row.latestVersionNumber,
      contentLength: row.currentContent ? row.currentContent.length : 0,
      tags: tagsBySnippet.get(row.id) || [],
      collaborators: collabs.map((c) => ({
        id: c.id,
        userId: c.userId,
        username: c.username,
        displayName: c.displayName,
        email: canViewCollaboratorEmails ? c.email : null,
        avatarUrl: c.avatarUrl,
        role: c.role as CollaboratorRole,
        addedById: c.addedById,
        createdAt: c.createdAt,
      })),
      effectiveRole,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function createSnippet(
  actor: AuthenticatedUser,
  input: {
    title: string;
    description?: string;
    language: string;
    visibility: SnippetVisibility;
    content: string;
    tags?: string[];
  }
): Promise<SnippetDetailDTO> {
  const cleanTitle = sanitizePlainText(input.title);
  if (!cleanTitle) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Snippet title cannot be empty');
  }
  const cleanDescription = sanitizePlainText(input.description || '');
  const normalizedTags = normalizeTagList(input.tags || []);
  const tagsText = normalizedTags.join(' ');
  const languageNormalized = input.language.trim().toLowerCase() || 'typescript';

  try {
    const updatedSnippet = await db.transaction(async (tx) => {
      const [insertedSnippet] = await tx
        .insert(snippets)
        .values({
          title: cleanTitle,
          description: cleanDescription,
          language: languageNormalized,
          visibility: input.visibility,
          ownerId: actor.id,
          currentContent: input.content,
          latestVersionNumber: 1,
          tagsText,
          searchVector: sql`
            setweight(to_tsvector('english', coalesce(${cleanTitle}, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(${tagsText}, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(${input.content}, '')), 'C')
          `,
        })
        .returning();

      const [initialVersion] = await tx
        .insert(snippetVersions)
        .values({
          snippetId: insertedSnippet.id,
          versionNumber: 1,
          authorId: actor.id,
          content: input.content,
          summary: 'Initial version',
          source: 'initial',
        })
        .returning();

      const [withVersionId] = await tx
        .update(snippets)
        .set({ currentVersionId: initialVersion.id })
        .where(eq(snippets.id, insertedSnippet.id))
        .returning();

      await syncSnippetTags(withVersionId.id, normalizedTags, tx);
      return withVersionId;
    });

    domainEventBus.emitActivity({
      actorId: actor.id,
      type: 'snippet.created',
      snippetId: updatedSnippet.id,
      visibility: updatedSnippet.visibility as SnippetVisibility,
      metadata: {
        title: updatedSnippet.title,
        language: updatedSnippet.language,
      },
    });

    return hydrateSnippetDetail(updatedSnippet, actor, {
      id: updatedSnippet.id,
      ownerId: updatedSnippet.ownerId,
      visibility: updatedSnippet.visibility as SnippetVisibility,
      collaboratorRole: null,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to create snippet:', error);
    throw new Error('Database error creating snippet.', { cause: error });
  }
}

export async function listSnippetsPaginated(
  actor: AuthenticatedUser | null | undefined,
  params: {
    cursor?: string;
    limit: number;
    visibility?: SnippetVisibility;
    language?: string;
    authorId?: string;
    tag?: string;
    scope?: 'public' | 'mine' | 'collaborated' | 'all';
    sort?: 'newest' | 'oldest' | 'updated';
  }
): Promise<PaginatedResult<SnippetSummaryDTO>> {
  try {
    const conditions = [];

    const scope = params.scope || 'all';
    if (!actor) {
      conditions.push(eq(snippets.visibility, 'public'));
    } else if (scope === 'public') {
      conditions.push(eq(snippets.visibility, 'public'));
    } else if (scope === 'mine') {
      conditions.push(eq(snippets.ownerId, actor.id));
    } else if (scope === 'collaborated') {
      const collabRows = await db
        .select({ snippetId: snippetCollaborators.snippetId })
        .from(snippetCollaborators)
        .where(eq(snippetCollaborators.userId, actor.id));
      const ids = collabRows.map((r) => r.snippetId);
      if (ids.length === 0) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      conditions.push(inArray(snippets.id, ids));
    } else if (actor.globalRole !== 'admin') {
      const collabRows = await db
        .select({ snippetId: snippetCollaborators.snippetId })
        .from(snippetCollaborators)
        .where(eq(snippetCollaborators.userId, actor.id));
      const collabIds = collabRows.map((r) => r.snippetId);
      if (collabIds.length > 0) {
        conditions.push(
          or(
            eq(snippets.visibility, 'public'),
            eq(snippets.ownerId, actor.id),
            inArray(snippets.id, collabIds)
          )
        );
      } else {
        conditions.push(
          or(eq(snippets.visibility, 'public'), eq(snippets.ownerId, actor.id))
        );
      }
    }

    if (params.visibility) {
      if (!actor && params.visibility !== 'public') {
        return { items: [], nextCursor: null, hasMore: false };
      }
      conditions.push(eq(snippets.visibility, params.visibility));
    }

    if (params.language) {
      conditions.push(eq(snippets.language, params.language.trim().toLowerCase()));
    }

    if (params.authorId) {
      conditions.push(eq(snippets.ownerId, params.authorId));
    }

    if (params.tag) {
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

    const sortMode = params.sort || 'newest';
    const sortColumn = sortMode === 'updated' ? snippets.updatedAt : snippets.createdAt;

    if (params.cursor) {
      const decoded = decodeDateCursor(params.cursor);
      const cursorDate = decoded.sortValue;
      if (sortMode === 'oldest') {
        conditions.push(
          or(
            gt(sortColumn, cursorDate),
            and(eq(sortColumn, cursorDate), gt(snippets.id, decoded.id))
          )
        );
      } else {
        conditions.push(
          or(
            lt(sortColumn, cursorDate),
            and(eq(sortColumn, cursorDate), lt(snippets.id, decoded.id))
          )
        );
      }
    }

    const orderByClauses =
      sortMode === 'oldest'
        ? [asc(sortColumn), asc(snippets.id)]
        : [desc(sortColumn), desc(snippets.id)];

    const rows = await db
      .select()
      .from(snippets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderByClauses)
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;
    const last = slice[slice.length - 1];

    const hydrated = await batchHydrateSnippetSummaries(slice, actor);

    return {
      items: hydrated,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              sortValue: (sortMode === 'updated' ? last.updatedAt : last.createdAt).toISOString(),
              id: last.id,
            })
          : null,
      hasMore,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to list snippets:', error);
    throw new Error('Database error listing snippets.', { cause: error });
  }
}

export async function updateSnippet(
  actor: AuthenticatedUser,
  snippetRow: typeof snippets.$inferSelect,
  authResource: SnippetAuthorizationResource,
  input: {
    title?: string;
    description?: string;
    language?: string;
    visibility?: SnippetVisibility;
    content?: string;
    tags?: string[];
    versionSummary?: string;
  }
): Promise<SnippetDetailDTO> {
  const nextTitle =
    input.title !== undefined ? sanitizePlainText(input.title) : snippetRow.title;
  if (!nextTitle) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Snippet title cannot be empty');
  }

  const nextDescription =
    input.description !== undefined
      ? sanitizePlainText(input.description)
      : snippetRow.description;
  const nextLanguage =
    input.language !== undefined
      ? input.language.trim().toLowerCase()
      : snippetRow.language;
  const nextVisibility = input.visibility ?? (snippetRow.visibility as SnippetVisibility);
  const nextContent = input.content !== undefined ? input.content : snippetRow.currentContent;

  let nextTagsText = snippetRow.tagsText;
  let normalizedTags: string[] | null = null;
  if (input.tags !== undefined) {
    normalizedTags = normalizeTagList(input.tags);
    nextTagsText = normalizedTags.join(' ');
  }

  const activeRoom = yjsRoomHub.getRoom(snippetRow.id);
  const baseVersionNumber = activeRoom
    ? Math.max(snippetRow.latestVersionNumber, activeRoom.latestVersionNumber)
    : snippetRow.latestVersionNumber;
  const currentRoomOrDbContent = activeRoom
    ? yjsRoomHub.getRoomContent(activeRoom)
    : snippetRow.currentContent;

  const contentChanged =
    input.content !== undefined && input.content !== currentRoomOrDbContent;

  let nextYjsState = snippetRow.yjsState;
  let broadcastUpdateBase64: string | undefined;

  if (contentChanged) {
    const prepared = yjsRoomHub.prepareRestContentUpdate(snippetRow.id, nextContent);
    nextYjsState = prepared.yjsStateBase64;
    broadcastUpdateBase64 = prepared.broadcastUpdateBase64;
  }

  try {
    const { updatedSnippet, createdVersionDTO, nextVersionNumber } = await db.transaction(
      async (tx) => {
        // P2-2: Lock the snippet row to serialize version allocation
        await tx.execute(
          sql`SELECT id, latest_version_number FROM snippets WHERE id = ${snippetRow.id} FOR UPDATE`
        );

        let nextVersionId = snippetRow.currentVersionId;
        let versionNum = baseVersionNumber;
        let versionDto: SnippetVersionDTO | undefined;

        if (contentChanged) {
          const [maxVerRow] = await tx
            .select({ maxVer: sql<number>`coalesce(max(${snippetVersions.versionNumber}), 0)` })
            .from(snippetVersions)
            .where(eq(snippetVersions.snippetId, snippetRow.id));
          versionNum = Math.max(baseVersionNumber, Number(maxVerRow.maxVer)) + 1;
          const summaryText =
            sanitizePlainText(input.versionSummary || `Updated to v${versionNum}`) ||
            `Updated to v${versionNum}`;

          const [createdVer] = await tx
            .insert(snippetVersions)
            .values({
              snippetId: snippetRow.id,
              versionNumber: versionNum,
              authorId: actor.id,
              content: nextContent,
              yjsState: nextYjsState,
              summary: summaryText,
              source: 'manual',
            })
            .returning();

          nextVersionId = createdVer.id;
          versionDto = {
            id: createdVer.id,
            snippetId: createdVer.snippetId,
            versionNumber: createdVer.versionNumber,
            authorId: actor.id,
            authorUsername: actor.username,
            authorDisplayName: actor.displayName || actor.username,
            content: createdVer.content,
            summary: createdVer.summary,
            source: createdVer.source,
            createdAt: createdVer.createdAt,
          };
        }

        const [updated] = await tx
          .update(snippets)
          .set({
            title: nextTitle,
            description: nextDescription,
            language: nextLanguage,
            visibility: nextVisibility,
            currentContent: nextContent,
            currentVersionId: nextVersionId,
            latestVersionNumber: versionNum,
            yjsState: nextYjsState,
            tagsText: nextTagsText,
            searchVector: sql`
              setweight(to_tsvector('english', coalesce(${nextTitle}, '')), 'A') ||
              setweight(to_tsvector('english', coalesce(${nextTagsText}, '')), 'B') ||
              setweight(to_tsvector('english', coalesce(${nextContent}, '')), 'C')
            `,
            updatedAt: new Date(),
          })
          .where(eq(snippets.id, snippetRow.id))
          .returning();

        if (normalizedTags !== null) {
          await syncSnippetTags(snippetRow.id, normalizedTags, tx);
        }

        return {
          updatedSnippet: updated,
          createdVersionDTO: versionDto,
          nextVersionNumber: versionNum,
        };
      }
    );

    const hydrated = await hydrateSnippetDetail(updatedSnippet, actor, {
      ...authResource,
      visibility: nextVisibility,
    });

    // Apply through yjsRoomHub so active Y.Doc, version number, title, and tags stay synchronized & broadcast
    await yjsRoomHub.syncRoomFromRestMutation({
      snippetId: updatedSnippet.id,
      title: updatedSnippet.title,
      visibility: nextVisibility,
      tags: hydrated.tags,
      tagsText: updatedSnippet.tagsText,
      content: updatedSnippet.currentContent,
      currentVersionId: updatedSnippet.currentVersionId,
      latestVersionNumber: updatedSnippet.latestVersionNumber,
      actorId: actor.id,
      actorUsername: actor.username,
      contentChanged,
      broadcastUpdateBase64,
      createdVersion: createdVersionDTO,
    });

    domainEventBus.emitActivity({
      actorId: actor.id,
      type: 'snippet.edited',
      snippetId: updatedSnippet.id,
      visibility: updatedSnippet.visibility as SnippetVisibility,
      metadata: {
        title: updatedSnippet.title,
        versionNumber: nextVersionNumber,
        contentChanged,
      },
    });

    if (nextVisibility === 'private' && snippetRow.visibility !== 'private') {
      await yjsRoomHub.revokeSnippetAccess(snippetRow.id, {
        visibilityChanged: true,
        reason: 'Snippet visibility changed to private',
      });
    }

    return hydrated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to update snippet:', error);
    throw new Error('Database error updating snippet.', { cause: error });
  }
}

export async function deleteSnippetById(
  actor: AuthenticatedUser,
  snippetRow: typeof snippets.$inferSelect
): Promise<void> {
  try {
    domainEventBus.emitActivity({
      actorId: actor.id,
      type: 'snippet.deleted',
      snippetId: null,
      visibility: snippetRow.visibility as SnippetVisibility,
      metadata: {
        deletedSnippetId: snippetRow.id,
        title: snippetRow.title,
      },
    });

    await db.delete(snippets).where(eq(snippets.id, snippetRow.id));
  } catch (error) {
    console.error('Failed to delete snippet:', error);
    throw new Error('Database error deleting snippet.', { cause: error });
  }
}

export async function listSnippetVersionsPaginated(
  snippetId: string,
  params: { cursor?: string; limit: number }
): Promise<PaginatedResult<SnippetVersionSummaryDTO>> {
  try {
    const conditions = [eq(snippetVersions.snippetId, snippetId)];

    if (params.cursor) {
      const decoded = decodeNumericCursor(params.cursor);
      const cursorVersionNum = decoded.sortValue;
      conditions.push(lt(snippetVersions.versionNumber, cursorVersionNum));
    }

    const rows = await db
      .select({
        id: snippetVersions.id,
        snippetId: snippetVersions.snippetId,
        versionNumber: snippetVersions.versionNumber,
        authorId: snippetVersions.authorId,
        contentLength: sql<number>`length(${snippetVersions.content})`,
        summary: snippetVersions.summary,
        source: snippetVersions.source,
        createdAt: snippetVersions.createdAt,
        authorUsername: users.username,
        authorDisplayName: users.displayName,
      })
      .from(snippetVersions)
      .leftJoin(users, eq(snippetVersions.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(snippetVersions.versionNumber))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;
    const last = slice[slice.length - 1];

    return {
      items: slice,
      nextCursor:
        hasMore && last
          ? encodeCursor({ sortValue: last.versionNumber, id: last.id })
          : null,
      hasMore,
    };
  } catch (error) {
    console.error('Failed to list snippet versions:', error);
    throw new Error('Database error listing snippet versions.', { cause: error });
  }
}

export async function getSnippetVersionDetail(
  snippetId: string,
  versionId: string
): Promise<SnippetVersionDTO> {
  try {
    const rows = await db
      .select({
        id: snippetVersions.id,
        snippetId: snippetVersions.snippetId,
        versionNumber: snippetVersions.versionNumber,
        authorId: snippetVersions.authorId,
        content: snippetVersions.content,
        summary: snippetVersions.summary,
        source: snippetVersions.source,
        createdAt: snippetVersions.createdAt,
        authorUsername: users.username,
        authorDisplayName: users.displayName,
      })
      .from(snippetVersions)
      .leftJoin(users, eq(snippetVersions.authorId, users.id))
      .where(
        and(
          eq(snippetVersions.snippetId, snippetId),
          eq(snippetVersions.id, versionId)
        )
      );

    const versionRow = rows[0];
    if (!versionRow) {
      throw new AppError(404, 'VERSION_NOT_FOUND', 'Version not found');
    }

    return versionRow;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to get snippet version detail:', error);
    throw new Error('Database error getting snippet version detail.', { cause: error });
  }
}

export async function createSnippetVersionSnapshot(
  actor: AuthenticatedUser,
  snippetRow: typeof snippets.$inferSelect,
  input: {
    content?: string;
    summary?: string;
    source?: 'manual' | 'autosave' | 'restore';
    yjsState?: string | null;
  }
): Promise<SnippetVersionDTO> {
  const activeRoom = yjsRoomHub.getRoom(snippetRow.id);
  const currentBaselineContent = activeRoom
    ? yjsRoomHub.getRoomContent(activeRoom)
    : snippetRow.currentContent;
  const nextContent = input.content !== undefined ? input.content : currentBaselineContent;
  const baseVersionNum = activeRoom
    ? Math.max(snippetRow.latestVersionNumber, activeRoom.latestVersionNumber)
    : snippetRow.latestVersionNumber;
  const cleanSummary =
    sanitizePlainText(input.summary || '') || `Version snapshot`;

  const contentChanged = nextContent !== currentBaselineContent || input.source === 'restore';
  const prepared = yjsRoomHub.prepareRestContentUpdate(snippetRow.id, nextContent);
  const nextYjsState =
    input.yjsState !== undefined && input.yjsState !== null
      ? input.yjsState
      : prepared.yjsStateBase64;

  try {
    const createdVersion = await db.transaction(async (tx) => {
      // P2-2: Lock the snippet row to serialize version allocation
      await tx.execute(
        sql`SELECT id, latest_version_number FROM snippets WHERE id = ${snippetRow.id} FOR UPDATE`
      );

      const [maxVerRow] = await tx
        .select({ maxVer: sql<number>`coalesce(max(${snippetVersions.versionNumber}), 0)` })
        .from(snippetVersions)
        .where(eq(snippetVersions.snippetId, snippetRow.id));
      const nextVer = Math.max(baseVersionNum, Number(maxVerRow.maxVer)) + 1;
      const finalSummary =
        cleanSummary === 'Version snapshot' ? `Version ${nextVer} snapshot` : cleanSummary;

      const [inserted] = await tx
        .insert(snippetVersions)
        .values({
          snippetId: snippetRow.id,
          versionNumber: nextVer,
          authorId: actor.id,
          content: nextContent,
          yjsState: nextYjsState,
          summary: finalSummary,
          source: input.source || 'manual',
        })
        .returning();

      await tx
        .update(snippets)
        .set({
          currentContent: nextContent,
          currentVersionId: inserted.id,
          latestVersionNumber: nextVer,
          yjsState: nextYjsState,
          searchVector: sql`
            setweight(to_tsvector('english', coalesce(${snippetRow.title}, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(${snippetRow.tagsText}, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(${nextContent}, '')), 'C')
          `,
          updatedAt: new Date(),
        })
        .where(eq(snippets.id, snippetRow.id));

      return inserted;
    });

    const versionDto: SnippetVersionDTO = {
      id: createdVersion.id,
      snippetId: createdVersion.snippetId,
      versionNumber: createdVersion.versionNumber,
      authorId: actor.id,
      authorUsername: actor.username,
      authorDisplayName: actor.displayName || actor.username,
      content: createdVersion.content,
      summary: createdVersion.summary,
      source: createdVersion.source,
      createdAt: createdVersion.createdAt,
    };

    const tagsArray = snippetRow.tagsText
      ? snippetRow.tagsText.split(' ').filter(Boolean)
      : [];

    await yjsRoomHub.syncRoomFromRestMutation({
      snippetId: snippetRow.id,
      title: snippetRow.title,
      visibility: snippetRow.visibility as SnippetVisibility,
      tags: tagsArray,
      tagsText: snippetRow.tagsText,
      content: nextContent,
      currentVersionId: createdVersion.id,
      latestVersionNumber: createdVersion.versionNumber,
      actorId: actor.id,
      actorUsername: actor.username,
      contentChanged,
      broadcastUpdateBase64: prepared.broadcastUpdateBase64,
      createdVersion: versionDto,
    });

    domainEventBus.emitActivity({
      actorId: actor.id,
      type: 'snippet.edited',
      snippetId: snippetRow.id,
      visibility: snippetRow.visibility as SnippetVisibility,
      metadata: {
        title: snippetRow.title,
        versionNumber: createdVersion.versionNumber,
        summary: cleanSummary,
        source: input.source || 'manual',
      },
    });

    return versionDto;
  } catch (error) {
    console.error('Failed to create snippet version:', error);
    throw new Error('Database error creating snippet version.', { cause: error });
  }
}

export async function restoreSnippetVersion(
  actor: AuthenticatedUser,
  snippetRow: typeof snippets.$inferSelect,
  authResource: SnippetAuthorizationResource,
  targetVersionId: string
): Promise<{ snippet: SnippetDetailDTO; restoredVersion: SnippetVersionDTO }> {
  let targetVersion: typeof snippetVersions.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(snippetVersions)
      .where(
        and(
          eq(snippetVersions.id, targetVersionId),
          eq(snippetVersions.snippetId, snippetRow.id)
        )
      );
    targetVersion = rows[0];
  } catch (error) {
    console.error('Database query failed loading version for restore:', error);
    throw new Error('Database error loading version.', { cause: error });
  }

  if (!targetVersion) {
    throw new AppError(404, 'VERSION_NOT_FOUND', 'Target version not found for this snippet');
  }

  const restoredVersion = await createSnippetVersionSnapshot(actor, snippetRow, {
    content: targetVersion.content,
    summary: `Restored from v${targetVersion.versionNumber}`,
    source: 'restore',
  });

  const [freshSnippet] = await db
    .select()
    .from(snippets)
    .where(eq(snippets.id, snippetRow.id));

  const hydrated = await hydrateSnippetDetail(freshSnippet, actor, authResource);
  return {
    snippet: hydrated,
    restoredVersion,
  };
}

export async function computeSnippetVersionDiff(
  snippetId: string,
  fromVersionId: string,
  toVersionId: string
): Promise<SnippetDiffDTO> {
  let versionRows: Array<typeof snippetVersions.$inferSelect>;
  try {
    versionRows = await db
      .select()
      .from(snippetVersions)
      .where(
        and(
          eq(snippetVersions.snippetId, snippetId),
          inArray(snippetVersions.id, [fromVersionId, toVersionId])
        )
      );
  } catch (error) {
    console.error('Database query failed fetching versions for diff:', error);
    throw new Error('Database error fetching versions for diff.', { cause: error });
  }

  const fromVer = versionRows.find((v) => v.id === fromVersionId);
  const toVer = versionRows.find((v) => v.id === toVersionId);

  if (!fromVer || !toVer) {
    throw new AppError(404, 'VERSION_NOT_FOUND', 'One or both versions were not found for this snippet');
  }

  const changes = diffLines(fromVer.content, toVer.content);
  const lines: DiffLineDTO[] = [];
  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;

  for (const part of changes) {
    const rawLines = part.value.replace(/\n$/, '').split('\n');
    if (part.value === '') continue;

    for (const lineText of rawLines) {
      if (part.added) {
        additions += 1;
        lines.push({
          type: 'added',
          content: lineText,
          oldLineNumber: null,
          newLineNumber: newLine++,
        });
      } else if (part.removed) {
        deletions += 1;
        lines.push({
          type: 'removed',
          content: lineText,
          oldLineNumber: oldLine++,
          newLineNumber: null,
        });
      } else {
        unchanged += 1;
        lines.push({
          type: 'unchanged',
          content: lineText,
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
        });
      }
    }
  }

  return {
    snippetId,
    fromVersion: {
      id: fromVer.id,
      versionNumber: fromVer.versionNumber,
      summary: fromVer.summary,
      createdAt: fromVer.createdAt,
    },
    toVersion: {
      id: toVer.id,
      versionNumber: toVer.versionNumber,
      summary: toVer.summary,
      createdAt: toVer.createdAt,
    },
    stats: {
      additions,
      deletions,
      unchanged,
    },
    lines,
  };
}

export async function addOrUpdateCollaborator(
  actor: AuthenticatedUser,
  snippetRow: typeof snippets.$inferSelect,
  input: {
    userId?: string;
    username?: string;
    email?: string;
    role: CollaboratorRole;
  }
): Promise<SnippetCollaboratorDTO> {
  let targetUser: typeof users.$inferSelect | undefined;
  try {
    if (input.userId) {
      const rows = await db.select().from(users).where(eq(users.id, input.userId));
      targetUser = rows[0];
    } else if (input.username) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.username, input.username.trim().toLowerCase()));
      targetUser = rows[0];
    } else if (input.email) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email.trim().toLowerCase()));
      targetUser = rows[0];
    }
  } catch (error) {
    console.error('Database query failed looking up collaborator target user:', error);
    throw new Error('Database error looking up target user.', { cause: error });
  }

  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target collaborator user not found');
  }

  if (targetUser.id === snippetRow.ownerId) {
    throw new AppError(
      400,
      'OWNER_CANNOT_BE_COLLABORATOR',
      'The snippet owner already has full ownership permissions'
    );
  }

  try {
    const [upserted] = await db
      .insert(snippetCollaborators)
      .values({
        snippetId: snippetRow.id,
        userId: targetUser.id,
        role: input.role,
        addedById: actor.id,
      })
      .onConflictDoUpdate({
        target: [snippetCollaborators.snippetId, snippetCollaborators.userId],
        set: {
          role: input.role,
          addedById: actor.id,
        },
      })
      .returning();

    yjsRoomHub.invalidateCachedRolesForSnippet(snippetRow.id);
    await yjsRoomHub.revokeSnippetAccess(snippetRow.id, {
      demotedUserId: targetUser.id,
      newRole: input.role,
    });

    domainEventBus.emitActivity({
      actorId: actor.id,
      type: 'collaborator.added',
      snippetId: snippetRow.id,
      visibility: snippetRow.visibility as SnippetVisibility,
      metadata: {
        collaboratorUserId: targetUser.id,
        collaboratorUsername: targetUser.username,
        role: input.role,
        snippetTitle: snippetRow.title,
      },
    });

    await createAndDispatchNotification({
      recipientId: targetUser.id,
      actorId: actor.id,
      type: 'collaborator.added',
      snippetId: snippetRow.id,
      title: `Added as ${input.role} on "${snippetRow.title}"`,
      message: `${actor.username} granted you ${input.role} access to snippet "${snippetRow.title}".`,
    });

    const io = getIO();
    if (io) {
      io.to(`snippet:${snippetRow.id}`).emit('snippet:collaborators-updated', {
        snippetId: snippetRow.id,
      });
      io.to(`user:${targetUser.id}`).emit('snippet:collaborator-updated', {
        snippetId: snippetRow.id,
        role: input.role,
      });
    }

    return {
      id: upserted.id,
      userId: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      email: targetUser.email,
      avatarUrl: targetUser.avatarUrl,
      role: upserted.role as CollaboratorRole,
      addedById: upserted.addedById,
      createdAt: upserted.createdAt,
    };
  } catch (error) {
    console.error('Failed to add or update collaborator:', error);
    throw new Error('Database error updating collaborator.', { cause: error });
  }
}

export async function removeCollaborator(
  snippetId: string,
  targetUserId: string
): Promise<void> {
  try {
    const deleted = await db
      .delete(snippetCollaborators)
      .where(
        and(
          eq(snippetCollaborators.snippetId, snippetId),
          eq(snippetCollaborators.userId, targetUserId)
        )
      )
      .returning();

    if (deleted.length === 0) {
      throw new AppError(404, 'COLLABORATOR_NOT_FOUND', 'Collaborator record not found on this snippet');
    }

    yjsRoomHub.invalidateCachedRolesForSnippet(snippetId);
    await yjsRoomHub.revokeSnippetAccess(snippetId, {
      removedUserId: targetUserId,
      reason: 'Collaborator removed',
    });

    const io = getIO();
    if (io) {
      io.to(`snippet:${snippetId}`).emit('snippet:collaborators-updated', {
        snippetId,
      });
      io.to(`user:${targetUserId}`).emit('snippet:collaborator-removed', {
        snippetId,
      });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to remove collaborator:', error);
    throw new Error('Database error removing collaborator.', { cause: error });
  }
}
