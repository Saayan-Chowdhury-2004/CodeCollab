import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  comments,
  snippets,
  snippetCollaborators,
  snippetVersions,
  users,
} from '../../db/schema.ts';
import {
  authorize,
  CollaboratorRole,
  SnippetAuthorizationResource,
  SnippetVisibility,
} from '../../auth/authorize.ts';
import { AuthenticatedUser } from '../../auth/jwt.ts';
import { AppError } from '../../utils/errors.ts';
import { sanitizePlainText } from '../../utils/sanitize.ts';
import { domainEventBus } from '../activity/event-bus.ts';
import { createAndDispatchNotification } from '../notifications/notifications.service.ts';
import { getIO } from '../../realtime/socket-server.ts';

export interface CommentAuthorDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CommentDTO {
  id: string;
  snippetId: string;
  authorId: string;
  author: CommentAuthorDTO;
  parentId: string | null;
  lineNumber: number;
  versionId: string;
  anchorLineText: string;
  currentLineText: string | null;
  isOutdated: boolean;
  body: string;
  resolved: boolean;
  resolvedById: string | null;
  resolvedBy: CommentAuthorDTO | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  replies: CommentDTO[];
}

async function loadSnippetContext(
  snippetId: string,
  actor: AuthenticatedUser | null | undefined
): Promise<{
  snippetRow: typeof snippets.$inferSelect;
  authResource: SnippetAuthorizationResource;
}> {
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

export function extractLineText(content: string, lineNumber: number): string | null {
  if (lineNumber < 1) return null;
  const lines = content.split(/\r?\n/);
  if (lineNumber > lines.length) return null;
  return lines[lineNumber - 1];
}

export function computeIsOutdated(
  anchorLineText: string,
  currentContent: string,
  lineNumber: number
): { isOutdated: boolean; currentLineText: string | null } {
  const currentLineText = extractLineText(currentContent, lineNumber);
  if (currentLineText === null) {
    return { isOutdated: true, currentLineText: null };
  }
  const isOutdated = currentLineText.trim() !== anchorLineText.trim();
  return { isOutdated, currentLineText };
}

async function hydrateCommentDTOs(
  commentRows: Array<typeof comments.$inferSelect>,
  currentSnippetContent: string
): Promise<CommentDTO[]> {
  if (commentRows.length === 0) {
    return [];
  }

  const userIds = new Set<string>();
  for (const row of commentRows) {
    userIds.add(row.authorId);
    if (row.resolvedById) {
      userIds.add(row.resolvedById);
    }
  }

  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(inArray(users.id, Array.from(userIds)));

  const userMap = new Map<string, CommentAuthorDTO>(
    userRows.map((u) => [
      u.id,
      {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
      },
    ])
  );

  const dtoMap = new Map<string, CommentDTO>();
  for (const row of commentRows) {
    const author = userMap.get(row.authorId) || {
      id: row.authorId,
      username: 'unknown',
      displayName: 'Unknown User',
      avatarUrl: null,
    };
    const resolvedBy = row.resolvedById ? userMap.get(row.resolvedById) || null : null;
    const { isOutdated, currentLineText } = computeIsOutdated(
      row.anchorLineText,
      currentSnippetContent,
      row.lineNumber
    );

    dtoMap.set(row.id, {
      id: row.id,
      snippetId: row.snippetId,
      authorId: row.authorId,
      author,
      parentId: row.parentId,
      lineNumber: row.lineNumber,
      versionId: row.versionId,
      anchorLineText: row.anchorLineText,
      currentLineText,
      isOutdated,
      body: row.body,
      resolved: row.resolved,
      resolvedById: row.resolvedById,
      resolvedBy,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      replies: [],
    });
  }

  const rootThreads: CommentDTO[] = [];
  for (const dto of dtoMap.values()) {
    if (dto.parentId && dtoMap.has(dto.parentId)) {
      dtoMap.get(dto.parentId)!.replies.push(dto);
    } else {
      rootThreads.push(dto);
    }
  }

  return rootThreads;
}

export async function listSnippetComments(
  actor: AuthenticatedUser | null | undefined,
  snippetId: string
): Promise<{ threads: CommentDTO[]; totalComments: number }> {
  const { snippetRow, authResource } = await loadSnippetContext(snippetId, actor);
  authorize(actor, 'snippet:read', { snippet: authResource });

  const allRows = await db
    .select()
    .from(comments)
    .where(eq(comments.snippetId, snippetId))
    .orderBy(asc(comments.lineNumber), asc(comments.createdAt), asc(comments.id));

  const threads = await hydrateCommentDTOs(allRows, snippetRow.currentContent);
  return {
    threads,
    totalComments: allRows.length,
  };
}

export async function createSnippetComment(
  actor: AuthenticatedUser | null | undefined,
  snippetId: string,
  input: {
    lineNumber?: number;
    versionId?: string;
    parentId?: string | null;
    body: string;
  }
): Promise<CommentDTO> {
  const { snippetRow, authResource } = await loadSnippetContext(snippetId, actor);
  authorize(actor, 'comment:create', { snippet: authResource });

  const cleanBody = sanitizePlainText(input.body);
  if (!cleanBody) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Comment body cannot be empty');
  }

  let parentRow: typeof comments.$inferSelect | undefined;
  if (input.parentId) {
    const [foundParent] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, input.parentId), eq(comments.snippetId, snippetId)));
    if (!foundParent) {
      throw new AppError(
        404,
        'PARENT_COMMENT_NOT_FOUND',
        'Parent comment not found on this snippet'
      );
    }
    parentRow = foundParent;
  }

  const resolvedLineNumber = input.lineNumber ?? parentRow?.lineNumber ?? 1;
  if (resolvedLineNumber < 1) {
    throw new AppError(400, 'VALIDATION_ERROR', 'lineNumber must be >= 1');
  }

  let resolvedVersionId =
    input.versionId || parentRow?.versionId || snippetRow.currentVersionId || '';

  let versionContent = snippetRow.currentContent;
  if (resolvedVersionId) {
    const [verRow] = await db
      .select()
      .from(snippetVersions)
      .where(
        and(
          eq(snippetVersions.id, resolvedVersionId),
          eq(snippetVersions.snippetId, snippetId)
        )
      );
    if (!verRow) {
      throw new AppError(404, 'VERSION_NOT_FOUND', 'Target snippet version not found');
    }
    versionContent = verRow.content;
  } else {
    const [latestVer] = await db
      .select()
      .from(snippetVersions)
      .where(eq(snippetVersions.snippetId, snippetId))
      .orderBy(asc(snippetVersions.versionNumber));
    if (!latestVer) {
      throw new AppError(500, 'MISSING_SNIPPET_VERSION', 'Snippet has no version records');
    }
    resolvedVersionId = latestVer.id;
    versionContent = latestVer.content;
  }

  let anchorLineText = parentRow?.anchorLineText;
  if (anchorLineText === undefined) {
    const extracted = extractLineText(versionContent, resolvedLineNumber);
    if (extracted === null) {
      throw new AppError(
        400,
        'INVALID_LINE_NUMBER',
        `Line ${resolvedLineNumber} exceeds snippet line count`
      );
    }
    anchorLineText = extracted;
  }

  const [inserted] = await db
    .insert(comments)
    .values({
      snippetId,
      authorId: actor!.id,
      parentId: parentRow ? parentRow.id : null,
      lineNumber: resolvedLineNumber,
      versionId: resolvedVersionId,
      anchorLineText,
      body: cleanBody,
      resolved: false,
    })
    .returning();

  const [hydrated] = await hydrateCommentDTOs([inserted], snippetRow.currentContent);

  // Emit activity event
  domainEventBus.emitActivity({
    actorId: actor!.id,
    type: 'comment.added',
    snippetId,
    visibility: snippetRow.visibility as SnippetVisibility,
    metadata: {
      commentId: inserted.id,
      lineNumber: inserted.lineNumber,
      parentId: inserted.parentId,
      snippetTitle: snippetRow.title,
      excerpt: cleanBody.slice(0, 100),
    },
  });

  // Notify snippet owner and/or parent comment author
  const notifiedUserIds = new Set<string>();
  if (parentRow && parentRow.authorId !== actor!.id) {
    notifiedUserIds.add(parentRow.authorId);
    await createAndDispatchNotification({
      recipientId: parentRow.authorId,
      actorId: actor!.id,
      type: 'comment.reply',
      snippetId,
      commentId: inserted.id,
      title: `New reply on "${snippetRow.title}" (Line ${inserted.lineNumber})`,
      message: `${actor!.username} replied to your comment on line ${inserted.lineNumber}: "${cleanBody}"`,
    });
  }

  if (snippetRow.ownerId !== actor!.id && !notifiedUserIds.has(snippetRow.ownerId)) {
    await createAndDispatchNotification({
      recipientId: snippetRow.ownerId,
      actorId: actor!.id,
      type: 'comment.added',
      snippetId,
      commentId: inserted.id,
      title: `New review comment on "${snippetRow.title}" (Line ${inserted.lineNumber})`,
      message: `${actor!.username} commented on line ${inserted.lineNumber}: "${cleanBody}"`,
    });
  }

  // Broadcast live socket event to snippet room
  const io = getIO();
  if (io) {
    io.to(`snippet:${snippetId}`).emit('comment:created', {
      snippetId,
      comment: hydrated,
    });
  }

  return hydrated;
}

export async function updateSnippetComment(
  actor: AuthenticatedUser | null | undefined,
  snippetId: string,
  commentId: string,
  body: string
): Promise<CommentDTO> {
  const { snippetRow, authResource } = await loadSnippetContext(snippetId, actor);

  const [existing] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.snippetId, snippetId)));

  if (!existing) {
    throw new AppError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
  }

  authorize(actor, 'comment:edit', {
    snippet: authResource,
    comment: { id: existing.id, authorId: existing.authorId },
  });

  const cleanBody = sanitizePlainText(body);
  if (!cleanBody) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Comment body cannot be empty');
  }

  const [updated] = await db
    .update(comments)
    .set({
      body: cleanBody,
      updatedAt: new Date(),
    })
    .where(eq(comments.id, commentId))
    .returning();

  const [hydrated] = await hydrateCommentDTOs([updated], snippetRow.currentContent);

  const io = getIO();
  if (io) {
    io.to(`snippet:${snippetId}`).emit('comment:updated', {
      snippetId,
      comment: hydrated,
    });
  }

  return hydrated;
}

export async function setSnippetCommentResolvedState(
  actor: AuthenticatedUser | null | undefined,
  snippetId: string,
  commentId: string,
  resolved: boolean
): Promise<CommentDTO> {
  const { snippetRow, authResource } = await loadSnippetContext(snippetId, actor);

  const [existing] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.snippetId, snippetId)));

  if (!existing) {
    throw new AppError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
  }

  authorize(actor, 'comment:resolve', {
    snippet: authResource,
    comment: { id: existing.id, authorId: existing.authorId },
  });

  const [updated] = await db
    .update(comments)
    .set({
      resolved,
      resolvedById: resolved ? actor!.id : null,
      resolvedAt: resolved ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(comments.id, commentId))
    .returning();

  const [hydrated] = await hydrateCommentDTOs([updated], snippetRow.currentContent);

  if (resolved) {
    domainEventBus.emitActivity({
      actorId: actor!.id,
      type: 'comment.resolved',
      snippetId,
      visibility: snippetRow.visibility as SnippetVisibility,
      metadata: {
        commentId: updated.id,
        lineNumber: updated.lineNumber,
        snippetTitle: snippetRow.title,
      },
    });

    if (existing.authorId !== actor!.id) {
      await createAndDispatchNotification({
        recipientId: existing.authorId,
        actorId: actor!.id,
        type: 'comment.resolved',
        snippetId,
        commentId: updated.id,
        title: `Thread resolved on "${snippetRow.title}" (Line ${updated.lineNumber})`,
        message: `${actor!.username} marked your review thread on line ${updated.lineNumber} as resolved.`,
      });
    }
  }

  const io = getIO();
  if (io) {
    io.to(`snippet:${snippetId}`).emit('comment:resolved', {
      snippetId,
      comment: hydrated,
    });
  }

  return hydrated;
}

export async function deleteSnippetComment(
  actor: AuthenticatedUser | null | undefined,
  snippetId: string,
  commentId: string
): Promise<void> {
  const { authResource } = await loadSnippetContext(snippetId, actor);

  const [existing] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.snippetId, snippetId)));

  if (!existing) {
    throw new AppError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
  }

  authorize(actor, 'comment:delete', {
    snippet: authResource,
    comment: { id: existing.id, authorId: existing.authorId },
  });

  await db.delete(comments).where(eq(comments.id, commentId));

  const io = getIO();
  if (io) {
    io.to(`snippet:${snippetId}`).emit('comment:deleted', {
      snippetId,
      commentId,
    });
  }
}
