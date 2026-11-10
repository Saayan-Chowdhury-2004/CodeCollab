import { and, count, desc, eq, ilike, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema.ts';
import { hashPassword, verifyPassword } from '../../auth/password.ts';
import { AuthenticatedUser, GlobalRole } from '../../auth/jwt.ts';
import { revokeAllUserRefreshTokens } from '../../auth/refresh.ts';
import { AppError } from '../../utils/errors.ts';
import { sanitizePlainText } from '../../utils/sanitize.ts';
import { decodeDateCursor, encodeCursor, PaginatedResult } from '../../utils/pagination.ts';
import { PublicUserDTO, toPublicUser } from '../auth/auth.service.ts';
import { yjsRoomHub } from '../../realtime/yjs-room-hub.ts';

export async function updateMyProfile(
  userId: string,
  updates: {
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
    email?: string;
  }
): Promise<PublicUserDTO> {
  const setPayload: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (updates.email !== undefined) {
    const normalizedEmail = updates.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Valid email address is required');
    }
    try {
      const existing = await db
        .select()
        .from(users)
        .where(and(eq(users.email, normalizedEmail), ne(users.id, userId)));
      if (existing.length > 0) {
        throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'Email is already in use');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('Database query failed checking email uniqueness:', error);
      throw new Error('Database error checking email.', { cause: error });
    }
    setPayload.email = normalizedEmail;
  }

  if (updates.displayName !== undefined) {
    const clean = sanitizePlainText(updates.displayName);
    if (!clean) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Display name cannot be empty');
    }
    setPayload.displayName = clean;
  }

  if (updates.username !== undefined) {
    const normalizedUsername = updates.username.trim().toLowerCase();
    try {
      const existing = await db
        .select()
        .from(users)
        .where(and(eq(users.username, normalizedUsername), ne(users.id, userId)));
      if (existing.length > 0) {
        throw new AppError(409, 'USERNAME_ALREADY_EXISTS', 'Username is already in use');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('Database query failed checking username uniqueness:', error);
      throw new Error('Database error checking username.', { cause: error });
    }
    setPayload.username = normalizedUsername;
  }

  if (updates.avatarUrl !== undefined) {
    setPayload.avatarUrl = updates.avatarUrl ? updates.avatarUrl.trim() : null;
  }

  try {
    const [updated] = await db
      .update(users)
      .set(setPayload)
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return toPublicUser(updated);
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Database update failed updating user profile:', error);
    throw new Error('Failed to update user profile.', { cause: error });
  }
}

export async function changeMyPassword(
  userId: string,
  input: { currentPassword?: string; newPassword: string },
  actor?: AuthenticatedUser | null
): Promise<void> {
  let userRow: typeof users.$inferSelect | undefined;
  try {
    const rows = await db.select().from(users).where(eq(users.id, userId));
    userRow = rows[0];
  } catch (error) {
    console.error('Database query failed fetching user for password change:', error);
    throw new Error('Database error fetching user.', { cause: error });
  }

  if (!userRow) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  if (userRow.passwordHash) {
    if (!input.currentPassword) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Current password is required');
    }
    const matches = await verifyPassword(input.currentPassword, userRow.passwordHash);
    if (!matches) {
      throw new AppError(401, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }
  } else {
    // P2-4: OAuth-only account setting local password: require recent authentication within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const authTime = actor?.authTime;
    if (!authTime || now - authTime > 300) {
      throw new AppError(
        401,
        'REAUTH_REQUIRED',
        'Recent authentication is required to set an initial password on an OAuth-linked account'
      );
    }
  }

  const newHash = await hashPassword(input.newPassword);

  try {
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('Database update failed changing password:', error);
    throw new Error('Failed to update password.', { cause: error });
  }

  // Revoke all refresh tokens on password change for security
  await revokeAllUserRefreshTokens(userId);
}

export async function listUsersPaginated(
  params: {
    cursor?: string;
    limit: number;
    q?: string;
  },
  actor?: AuthenticatedUser | null
): Promise<PaginatedResult<PublicUserDTO>> {
  const conditions = [];
  const isAdmin = actor?.globalRole === 'admin';

  if (params.q && params.q.trim()) {
    const searchTerms = params.q.trim();
    const ilikePattern = `%${searchTerms}%`;
    if (isAdmin) {
      conditions.push(
        or(
          ilike(users.username, ilikePattern),
          ilike(users.displayName, ilikePattern),
          ilike(users.email, ilikePattern),
          sql`to_tsvector('simple', coalesce(${users.username}, '') || ' ' || coalesce(${users.email}, '') || ' ' || coalesce(${users.displayName}, '')) @@ websearch_to_tsquery('simple', ${searchTerms})`
        )
      );
    } else {
      conditions.push(
        or(
          ilike(users.username, ilikePattern),
          ilike(users.displayName, ilikePattern),
          sql`to_tsvector('simple', coalesce(${users.username}, '') || ' ' || coalesce(${users.displayName}, '')) @@ websearch_to_tsquery('simple', ${searchTerms})`
        )
      );
    }
  }

  if (params.cursor) {
    const decoded = decodeDateCursor(params.cursor);
    const cursorDate = decoded.sortValue;
    conditions.push(
      or(
        lt(users.createdAt, cursorDate),
        and(eq(users.createdAt, cursorDate), lt(users.id, decoded.id))
      )
    );
  }

  try {
    const rows = await db
      .select()
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;
    const last = slice[slice.length - 1];

    return {
      items: slice.map((u) => toPublicUser(u, actor ?? null)),
      nextCursor:
        hasMore && last
          ? encodeCursor({ sortValue: last.createdAt.toISOString(), id: last.id })
          : null,
      hasMore,
    };
  } catch (error) {
    console.error('Database query failed listing users:', error);
    throw new Error('Failed to list users.', { cause: error });
  }
}

export async function updateUserGlobalRole(
  actorId: string,
  targetUserId: string,
  newRole: GlobalRole
): Promise<PublicUserDTO> {
  let targetUser: typeof users.$inferSelect | undefined;
  try {
    const rows = await db.select().from(users).where(eq(users.id, targetUserId));
    targetUser = rows[0];
  } catch (error) {
    console.error('Database query failed fetching target user:', error);
    throw new Error('Database error fetching target user.', { cause: error });
  }

  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target user not found');
  }

  // Prevent demoting the last remaining admin
  if (targetUser.globalRole === 'admin' && newRole !== 'admin') {
    const [adminCountRow] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.globalRole, 'admin'));
    if (Number(adminCountRow?.value ?? 0) <= 1) {
      throw new AppError(
        400,
        'LAST_ADMIN_PROTECTED',
        'Cannot demote the last remaining administrator'
      );
    }
    if (actorId === targetUserId) {
      throw new AppError(
        400,
        'SELF_DEMOTION_FORBIDDEN',
        'Admins cannot demote their own global role'
      );
    }
  }

  try {
    const [updated] = await db
      .update(users)
      .set({ globalRole: newRole, updatedAt: new Date() })
      .where(eq(users.id, targetUserId))
      .returning();

    yjsRoomHub.invalidateCachedRolesForUser(targetUserId);

    return toPublicUser(updated);
  } catch (error) {
    console.error('Database update failed updating user role:', error);
    throw new Error('Failed to update user role.', { cause: error });
  }
}
