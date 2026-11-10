import crypto from 'crypto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import pino from 'pino';
import { db } from '../db/index.ts';
import { refreshTokens, users } from '../db/schema.ts';
import { env } from '../config/env.ts';
import { AppError } from '../utils/errors.ts';
import { logger as defaultLogger } from '../config/logger.ts';
import { GlobalRole } from './jwt.ts';

export function hashRefreshToken(
  rawToken: string,
  secret = env.JWT_REFRESH_SECRET
): string {
  return crypto
    .createHash('sha256')
    .update(`${rawToken}:${secret}`)
    .digest('hex');
}

export function generateOpaqueRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface RefreshTokenMetadata {
  userAgent?: string;
  ipAddress?: string;
}

export async function issueRefreshTokenFamily(
  userId: string,
  meta?: RefreshTokenMetadata,
  existingFamilyId?: string
) {
  try {
    const rawRefreshToken = generateOpaqueRefreshToken();
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const familyId = existingFamilyId || crypto.randomUUID();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const [record] = await db
      .insert(refreshTokens)
      .values({
        userId,
        tokenHash,
        familyId,
        expiresAt,
        userAgent: meta?.userAgent || null,
        ipAddress: meta?.ipAddress || null,
      })
      .returning();

    return {
      rawRefreshToken,
      familyId,
      record,
    };
  } catch (error) {
    console.error('Failed to issue refresh token:', error);
    throw new Error('Failed to issue refresh token.', { cause: error });
  }
}

export async function rotateRefreshToken(
  rawRefreshToken: string,
  meta?: RefreshTokenMetadata,
  reqLogger: pino.Logger = defaultLogger
) {
  const tokenHash = hashRefreshToken(rawRefreshToken);

  let existing;
  try {
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    existing = rows[0];

    if (!existing && env.JWT_REFRESH_SECRET_PREVIOUS) {
      const prevHash = hashRefreshToken(rawRefreshToken, env.JWT_REFRESH_SECRET_PREVIOUS);
      const prevRows = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, prevHash));
      existing = prevRows[0];
    }
  } catch (error) {
    console.error('Failed to lookup refresh token:', error);
    throw new Error('Database error during refresh token lookup.', { cause: error });
  }

  if (!existing) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or unrecognized');
  }

  // Reuse Detection: if this token was already revoked/rotated, revoke the entire family!
  if (existing.revokedAt !== null) {
    try {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.familyId, existing.familyId),
            isNull(refreshTokens.revokedAt)
          )
        );
    } catch (error) {
      console.error('Failed to revoke compromised refresh token family:', error);
      throw new Error('Database error revoking token family.', { cause: error });
    }

    reqLogger.warn(
      {
        userId: existing.userId,
        familyId: existing.familyId,
        reusedTokenId: existing.id,
      },
      'Refresh token reuse detected — revoked entire token family'
    );

    throw new AppError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Refresh token reuse detected. Entire session family has been revoked for security.'
    );
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    try {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, existing.id));
    } catch (error) {
      console.error('Failed to mark expired refresh token:', error);
    }
    throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token has expired');
  }

  // Issue replacement token in the same family and mark old token revoked
  const next = await issueRefreshTokenFamily(existing.userId, meta, existing.familyId);

  try {
    await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        replacedById: next.record.id,
      })
      .where(eq(refreshTokens.id, existing.id));

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, existing.userId));

    if (!user) {
      throw new AppError(401, 'USER_NOT_FOUND', 'User associated with refresh token no longer exists');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        globalRole: user.globalRole as GlobalRole,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      rawRefreshToken: next.rawRefreshToken,
      familyId: next.familyId,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to rotate refresh token:', error);
    throw new Error('Database error during refresh token rotation.', { cause: error });
  }
}

export async function revokeRefreshTokenFamilyByToken(rawRefreshToken: string): Promise<boolean> {
  try {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const [existing] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));

    if (!existing) {
      return false;
    }

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, existing.familyId),
          isNull(refreshTokens.revokedAt)
        )
      );

    return true;
  } catch (error) {
    console.error('Failed to revoke refresh token family:', error);
    throw new Error('Database error revoking refresh token.', { cause: error });
  }
}

export async function revokeAllUserRefreshTokens(
  userId: string,
  exceptFamilyId?: string
): Promise<void> {
  try {
    const condition = exceptFamilyId
      ? and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          ne(refreshTokens.familyId, exceptFamilyId)
        )
      : and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt));

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(condition);
  } catch (error) {
    console.error('Failed to revoke user refresh tokens:', error);
    throw new Error('Database error revoking user sessions.', { cause: error });
  }
}
