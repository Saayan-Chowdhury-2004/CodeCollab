import { and, desc, eq, inArray, lt, or, SQL } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activities,
  snippets,
  snippetCollaborators,
  users,
} from '../../db/schema.ts';
import {
  authorize,
  CollaboratorRole,
  SnippetVisibility,
} from '../../auth/authorize.ts';
import { AuthenticatedUser } from '../../auth/jwt.ts';
import { AppError } from '../../utils/errors.ts';
import { decodeDateCursor, encodeCursor, PaginatedResult } from '../../utils/pagination.ts';
import { getIO } from '../../realtime/socket-server.ts';
import {
  ActivityEventType,
  DomainActivityEvent,
  domainEventBus,
} from './event-bus.ts';

export interface ActivityDTO {
  id: string;
  actorId: string;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  type: ActivityEventType;
  snippetId: string | null;
  visibility: SnippetVisibility;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export async function recordAndBroadcastActivity(
  event: DomainActivityEvent
): Promise<ActivityDTO | null> {
  try {
    const [actorRow] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, event.actorId));

    if (!actorRow) {
      return null;
    }

    const [inserted] = await db
      .insert(activities)
      .values({
        actorId: event.actorId,
        type: event.type,
        snippetId: event.snippetId,
        visibility: event.visibility,
        metadata: event.metadata || {},
      })
      .returning();

    const dto: ActivityDTO = {
      id: inserted.id,
      actorId: inserted.actorId,
      actor: {
        id: actorRow.id,
        username: actorRow.username,
        displayName: actorRow.displayName,
        avatarUrl: actorRow.avatarUrl,
      },
      type: inserted.type as ActivityEventType,
      snippetId: inserted.snippetId,
      visibility: inserted.visibility as SnippetVisibility,
      metadata: (inserted.metadata as Record<string, unknown>) || {},
      createdAt: inserted.createdAt,
    };

    const io = getIO();
    if (io) {
      // Only broadcast public activities to the global feed room
      if (dto.visibility === 'public') {
        io.to('feed:global').emit('activity:new', dto);
      }
      if (dto.snippetId) {
        io.to(`snippet:${dto.snippetId}`).emit('activity:new', dto);
      }
      io.to(`user:${dto.actorId}`).emit('activity:new', dto);
    }

    return dto;
  } catch (error) {
    console.error('Failed to persist domain activity event:', error);
    return null;
  }
}

// Register listener on the singleton domainEventBus once
let listenerRegistered = false;
export function registerActivityEventSubscriber(): void {
  if (listenerRegistered) return;
  listenerRegistered = true;
  domainEventBus.onActivity(async (event) => {
    await recordAndBroadcastActivity(event);
  });
}

// Ensure subscriber is active when module is imported
registerActivityEventSubscriber();

async function queryPaginatedActivities(
  baseCondition: SQL | undefined,
  params: {
    cursor?: string;
    limit: number;
    type?: ActivityEventType;
  }
): Promise<PaginatedResult<ActivityDTO>> {
  await domainEventBus.flush();

  const conditions: SQL[] = [];
  if (baseCondition) {
    conditions.push(baseCondition);
  }
  if (params.type) {
    conditions.push(eq(activities.type, params.type));
  }

  if (params.cursor) {
    const decoded = decodeDateCursor(params.cursor);
    const cursorDate = decoded.sortValue;
    conditions.push(
      or(
        lt(activities.createdAt, cursorDate),
        and(eq(activities.createdAt, cursorDate), lt(activities.id, decoded.id))
      )!
    );
  }

  const rows = await db
    .select({
      activity: activities,
      actorId: users.id,
      actorUsername: users.username,
      actorDisplayName: users.displayName,
      actorAvatarUrl: users.avatarUrl,
    })
    .from(activities)
    .innerJoin(users, eq(activities.actorId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const slice = hasMore ? rows.slice(0, params.limit) : rows;
  const last = slice[slice.length - 1];

  const items: ActivityDTO[] = slice.map((r) => ({
    id: r.activity.id,
    actorId: r.activity.actorId,
    actor: {
      id: r.actorId,
      username: r.actorUsername,
      displayName: r.actorDisplayName,
      avatarUrl: r.actorAvatarUrl,
    },
    type: r.activity.type as ActivityEventType,
    snippetId: r.activity.snippetId,
    visibility: r.activity.visibility as SnippetVisibility,
    metadata: (r.activity.metadata as Record<string, unknown>) || {},
    createdAt: r.activity.createdAt,
  }));

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            sortValue: last.activity.createdAt.toISOString(),
            id: last.activity.id,
          })
        : null,
    hasMore,
  };
}

/**
 * Global activity feed: strictly returns public activities only (visibility = 'public').
 * Private and unlisted snippet events never appear in the global feed.
 */
export async function listGlobalActivitiesPaginated(params: {
  cursor?: string;
  limit: number;
  type?: ActivityEventType;
}): Promise<PaginatedResult<ActivityDTO>> {
  return queryPaginatedActivities(eq(activities.visibility, 'public'), params);
}

/**
 * Per-snippet activity feed: enforces central `snippet:read` authorization on the target snippet.
 */
export async function listSnippetActivitiesPaginated(
  actor: AuthenticatedUser | null | undefined,
  snippetId: string,
  params: {
    cursor?: string;
    limit: number;
    type?: ActivityEventType;
  }
): Promise<PaginatedResult<ActivityDTO>> {
  await domainEventBus.flush();

  const [snippetRow] = await db
    .select()
    .from(snippets)
    .where(eq(snippets.id, snippetId));

  if (!snippetRow) {
    throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
  }

  let collaboratorRole: CollaboratorRole | null = null;
  if (actor) {
    const [collabRow] = await db
      .select({ role: snippetCollaborators.role })
      .from(snippetCollaborators)
      .where(
        and(
          eq(snippetCollaborators.snippetId, snippetId),
          eq(snippetCollaborators.userId, actor.id)
        )
      );
    collaboratorRole = (collabRow?.role as CollaboratorRole | undefined) || null;
  }

  authorize(actor, 'snippet:read', {
    snippet: {
      id: snippetRow.id,
      ownerId: snippetRow.ownerId,
      visibility: snippetRow.visibility as SnippetVisibility,
      collaboratorRole,
    },
  });

  return queryPaginatedActivities(eq(activities.snippetId, snippetId), params);
}

/**
 * Per-user activity feed:
 * - Self or admin sees all activities performed by `targetUserId`.
 * - Anonymous users see only `visibility = 'public'` activities by `targetUserId`.
 * - Other authenticated users see `visibility = 'public'` activities OR activities on snippets
 *   they own or collaborate on.
 */
export async function listUserActivitiesPaginated(
  actor: AuthenticatedUser | null | undefined,
  targetUserId: string,
  params: {
    cursor?: string;
    limit: number;
    type?: ActivityEventType;
  }
): Promise<PaginatedResult<ActivityDTO>> {
  await domainEventBus.flush();

  const [targetUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetUserId));

  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const actorMatch = eq(activities.actorId, targetUserId);

  if (!actor) {
    return queryPaginatedActivities(
      and(actorMatch, eq(activities.visibility, 'public')),
      params
    );
  }

  if (actor.id === targetUserId || actor.globalRole === 'admin') {
    return queryPaginatedActivities(actorMatch, params);
  }

  const [ownedRows, collabRows] = await Promise.all([
    db
      .select({ id: snippets.id })
      .from(snippets)
      .where(eq(snippets.ownerId, actor.id)),
    db
      .select({ snippetId: snippetCollaborators.snippetId })
      .from(snippetCollaborators)
      .where(eq(snippetCollaborators.userId, actor.id)),
  ]);

  const accessibleSnippetIds = Array.from(
    new Set([...ownedRows.map((r) => r.id), ...collabRows.map((r) => r.snippetId)])
  );

  const visibilityCondition =
    accessibleSnippetIds.length > 0
      ? or(
          eq(activities.visibility, 'public'),
          inArray(activities.snippetId, accessibleSnippetIds)
        )!
      : eq(activities.visibility, 'public');

  return queryPaginatedActivities(and(actorMatch, visibilityCondition), params);
}
