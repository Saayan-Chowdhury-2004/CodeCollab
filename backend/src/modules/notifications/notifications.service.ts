import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { notifications, users } from '../../db/schema.ts';
import { AppError } from '../../utils/errors.ts';
import { decodeDateCursor, encodeCursor, PaginatedResult } from '../../utils/pagination.ts';
import { getIO } from '../../realtime/socket-server.ts';
import { mailService } from './mail.service.ts';

export type NotificationType =
  | 'comment.added'
  | 'comment.reply'
  | 'comment.resolved'
  | 'collaborator.added';

export interface NotificationDTO {
  id: string;
  recipientId: string;
  actorId: string | null;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  type: NotificationType;
  snippetId: string | null;
  commentId: string | null;
  title: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationsPageDTO extends PaginatedResult<NotificationDTO> {
  unreadCount: number;
}

export async function createAndDispatchNotification(input: {
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  snippetId?: string | null;
  commentId?: string | null;
  title: string;
  message: string;
}): Promise<NotificationDTO | null> {
  // Never notify a user about their own action
  if (input.actorId && input.recipientId === input.actorId) {
    return null;
  }

  try {
    const [recipientRow] = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, input.recipientId));

    if (!recipientRow) {
      return null;
    }

    let actorRow:
      | {
          id: string;
          username: string;
          displayName: string;
          avatarUrl: string | null;
        }
      | undefined;

    if (input.actorId) {
      const [foundActor] = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, input.actorId));
      actorRow = foundActor;
    }

    const [inserted] = await db
      .insert(notifications)
      .values({
        recipientId: input.recipientId,
        actorId: input.actorId,
        type: input.type,
        snippetId: input.snippetId ?? null,
        commentId: input.commentId ?? null,
        title: input.title,
        message: input.message,
      })
      .returning();

    const dto: NotificationDTO = {
      id: inserted.id,
      recipientId: inserted.recipientId,
      actorId: inserted.actorId,
      actor: actorRow || null,
      type: inserted.type as NotificationType,
      snippetId: inserted.snippetId,
      commentId: inserted.commentId,
      title: inserted.title,
      message: inserted.message,
      readAt: inserted.readAt,
      createdAt: inserted.createdAt,
    };

    // Push live in-app notification over Socket.io if user is connected
    const io = getIO();
    if (io) {
      io.to(`user:${input.recipientId}`).emit('notification:new', dto);
    }

    // Dispatch email notification via swappable MailService (ConsoleMailService by default)
    await mailService.sendMail({
      to: recipientRow.email,
      subject: `[CodeCollab] ${input.title}`,
      text: `Hi ${recipientRow.displayName},\n\n${input.message}\n\n— CodeCollab Platform`,
      metadata: {
        notificationId: inserted.id,
        type: input.type,
        snippetId: input.snippetId ?? null,
        commentId: input.commentId ?? null,
      },
    });

    return dto;
  } catch (error) {
    console.error('Failed to create and dispatch notification:', error);
    return null;
  }
}

export async function listUserNotificationsPaginated(
  userId: string,
  params: {
    cursor?: string;
    limit: number;
    unreadOnly?: boolean;
  }
): Promise<NotificationsPageDTO> {
  try {
    const conditions = [eq(notifications.recipientId, userId)];
    if (params.unreadOnly) {
      conditions.push(isNull(notifications.readAt));
    }

    if (params.cursor) {
      const decoded = decodeDateCursor(params.cursor);
      const cursorDate = decoded.sortValue;
      conditions.push(
        or(
          lt(notifications.createdAt, cursorDate),
          and(eq(notifications.createdAt, cursorDate), lt(notifications.id, decoded.id))
        )!
      );
    }

    const [rows, [unreadRow]] = await Promise.all([
      db
        .select({
          notification: notifications,
          actorId: users.id,
          actorUsername: users.username,
          actorDisplayName: users.displayName,
          actorAvatarUrl: users.avatarUrl,
        })
        .from(notifications)
        .leftJoin(users, eq(notifications.actorId, users.id))
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(params.limit + 1),
      db
        .select({ value: count() })
        .from(notifications)
        .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt))),
    ]);

    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;
    const last = slice[slice.length - 1];

    const items: NotificationDTO[] = slice.map((r) => ({
      id: r.notification.id,
      recipientId: r.notification.recipientId,
      actorId: r.notification.actorId,
      actor: r.actorId
        ? {
            id: r.actorId,
            username: r.actorUsername || 'unknown',
            displayName: r.actorDisplayName || 'Unknown User',
            avatarUrl: r.actorAvatarUrl || null,
          }
        : null,
      type: r.notification.type as NotificationType,
      snippetId: r.notification.snippetId,
      commentId: r.notification.commentId,
      title: r.notification.title,
      message: r.notification.message,
      readAt: r.notification.readAt,
      createdAt: r.notification.createdAt,
    }));

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              sortValue: last.notification.createdAt.toISOString(),
              id: last.notification.id,
            })
          : null,
      hasMore,
      unreadCount: Number(unreadRow?.value ?? 0),
    };
  } catch (error) {
    console.error('Database query failed listing notifications:', error);
    throw new Error('Failed to list notifications.', { cause: error });
  }
}

export async function markNotificationAsRead(
  userId: string,
  notificationId: string
): Promise<NotificationDTO> {
  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientId, userId)));

  if (!existing) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }

  const readAt = existing.readAt || new Date();
  const [updated] = await db
    .update(notifications)
    .set({ readAt })
    .where(eq(notifications.id, notificationId))
    .returning();

  return {
    id: updated.id,
    recipientId: updated.recipientId,
    actorId: updated.actorId,
    actor: null,
    type: updated.type as NotificationType,
    snippetId: updated.snippetId,
    commentId: updated.commentId,
    title: updated.title,
    message: updated.message,
    readAt: updated.readAt,
    createdAt: updated.createdAt,
  };
}

export async function markAllUserNotificationsAsRead(userId: string): Promise<{ updatedCount: number }> {
  const updatedRows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });

  return { updatedCount: updatedRows.length };
}
