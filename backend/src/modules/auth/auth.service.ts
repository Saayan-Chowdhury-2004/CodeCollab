import crypto from 'crypto';
import { eq, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema.ts';
import { hashPassword, verifyPassword } from '../../auth/password.ts';
import { AuthenticatedUser, GlobalRole, signAccessToken } from '../../auth/jwt.ts';
import { issueRefreshTokenFamily, RefreshTokenMetadata } from '../../auth/refresh.ts';
import { GitHubProfile } from '../../auth/github-oauth.ts';
import { AppError } from '../../utils/errors.ts';
import { sanitizePlainText } from '../../utils/sanitize.ts';
import { env } from '../../config/env.ts';

export interface PublicUserDTO {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  githubId?: string | null;
  hasPassword?: boolean;
  globalRole: GlobalRole;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicUser(
  row: typeof users.$inferSelect,
  viewer?: Pick<AuthenticatedUser, 'id' | 'globalRole'> | null
): PublicUserDTO {
  const canViewEmail =
    viewer === undefined ||
    Boolean(viewer && (viewer.globalRole === 'admin' || viewer.id === row.id));

  return {
    id: row.id,
    email: canViewEmail ? row.email : null,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    githubId: canViewEmail ? row.githubId || null : undefined,
    hasPassword: canViewEmail ? Boolean(row.passwordHash) : undefined,
    globalRole: row.globalRole as GlobalRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function registerUser(
  input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  },
  meta?: RefreshTokenMetadata
) {
  const emailNormalized = input.email.trim().toLowerCase();
  const usernameNormalized = input.username.trim().toLowerCase();
  const cleanDisplayName = sanitizePlainText(input.displayName);

  if (!cleanDisplayName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Display name cannot be empty after sanitization');
  }

  let existing;
  try {
    existing = await db
      .select()
      .from(users)
      .where(or(eq(users.email, emailNormalized), eq(users.username, usernameNormalized)));
  } catch (error) {
    console.error('Database query failed checking existing user:', error);
    throw new Error('Database error during registration check.', { cause: error });
  }

  if (existing.length > 0) {
    const conflict = existing[0];
    if (conflict.email === emailNormalized) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
    }
    throw new AppError(409, 'USERNAME_ALREADY_EXISTS', 'This username is already taken');
  }

  const passwordHash = await hashPassword(input.password);

  let createdUser: typeof users.$inferSelect;
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        uid: `local-${crypto.randomUUID()}`,
        email: emailNormalized,
        username: usernameNormalized,
        displayName: cleanDisplayName,
        passwordHash,
        globalRole: 'editor', // Strictly fixed to 'editor' — prevents mass-assignment privilege escalation
      })
      .returning();
    createdUser = inserted;
  } catch (error) {
    console.error('Database insert failed creating user:', error);
    throw new Error('Failed to create user record.', { cause: error });
  }

  const publicUser = toPublicUser(createdUser);
  const accessToken = signAccessToken({
    id: createdUser.id,
    email: createdUser.email,
    username: createdUser.username,
    displayName: createdUser.displayName,
    globalRole: createdUser.globalRole as GlobalRole,
  });
  const refresh = await issueRefreshTokenFamily(createdUser.id, meta);

  return {
    user: publicUser,
    accessToken,
    refreshToken: refresh.rawRefreshToken,
  };
}

// Pre-computed valid 12-round bcrypt hash used to equalize response times when a user doesn't exist
const DUMMY_BCRYPT_HASH =
  '$2b$12$e8YqJj7bN3x2b4xK4mY9nO7QzB1v7c8d9e0f1a2b3c4d5e6f7a8b9';

export async function loginUser(
  input: {
    identifier: string;
    password: string;
  },
  meta?: RefreshTokenMetadata
) {
  const normalized = input.identifier.trim().toLowerCase();

  let userRow: typeof users.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(users)
      .where(or(eq(users.email, normalized), eq(users.username, normalized)));
    userRow = rows[0];
  } catch (error) {
    console.error('Database query failed during login:', error);
    throw new Error('Database error during login.', { cause: error });
  }

  if (!userRow || !userRow.passwordHash) {
    await verifyPassword(input.password, DUMMY_BCRYPT_HASH);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email/username or password');
  }

  const valid = await verifyPassword(input.password, userRow.passwordHash);
  if (!valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email/username or password');
  }

  const publicUser = toPublicUser(userRow);
  const accessToken = signAccessToken({
    id: userRow.id,
    email: userRow.email,
    username: userRow.username,
    displayName: userRow.displayName,
    globalRole: userRow.globalRole as GlobalRole,
  });
  const refresh = await issueRefreshTokenFamily(userRow.id, meta);

  return {
    user: publicUser,
    accessToken,
    refreshToken: refresh.rawRefreshToken,
  };
}

export async function getUserById(userId: string): Promise<PublicUserDTO> {
  let row: typeof users.$inferSelect | undefined;
  try {
    const rows = await db.select().from(users).where(eq(users.id, userId));
    row = rows[0];
  } catch (error) {
    console.error('Database query failed fetching user by ID:', error);
    throw new Error('Database error fetching user profile.', { cause: error });
  }

  if (!row) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return toPublicUser(row);
}

export async function upsertGitHubUser(
  profile: GitHubProfile,
  meta?: RefreshTokenMetadata
) {
  try {
    const existingByGh = await db
      .select()
      .from(users)
      .where(eq(users.githubId, profile.githubId));

    let targetUser = existingByGh[0];

    if (!targetUser) {
      const existingByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, profile.email.toLowerCase()));

      if (existingByEmail[0]) {
        if (!profile.emailVerified) {
          throw new AppError(
            403,
            'GITHUB_EMAIL_UNVERIFIED',
            'Cannot link GitHub account to existing user because the GitHub email address is not verified'
          );
        }

        // Do not silently link GitHub account to an existing local account.
        // Require password login or refuse with a clear message.
        throw new AppError(
          409,
          'ACCOUNT_COLLISION',
          'An account with this email already exists. Please sign in with your email and password first.'
        );
      }
    }

    if (!targetUser) {
      let baseUsername = profile.username
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 40);
      if (baseUsername.length < 3) {
        baseUsername = `gh_${profile.githubId.slice(0, 30)}`;
      }

      const usernameCheck = await db
        .select()
        .from(users)
        .where(eq(users.username, baseUsername));

      const finalUsername =
        usernameCheck.length > 0
          ? `${baseUsername.slice(0, 42)}_${crypto.randomBytes(2).toString('hex')}`
          : baseUsername;

      const emailToStore =
        profile.emailVerified && profile.email && !profile.email.includes('noreply')
          ? profile.email.toLowerCase()
          : `${finalUsername}@users.noreply.github.com`;

      const [inserted] = await db
        .insert(users)
        .values({
          uid: `github-${profile.githubId}`,
          email: emailToStore,
          username: finalUsername,
          displayName: sanitizePlainText(profile.displayName) || finalUsername,
          githubId: profile.githubId,
          avatarUrl: profile.avatarUrl,
          globalRole: 'editor',
        })
        .returning();
      targetUser = inserted;
    }

    const publicUser = toPublicUser(targetUser);
    const accessToken = signAccessToken(
      {
        id: targetUser.id,
        email: targetUser.email,
        username: targetUser.username,
        displayName: targetUser.displayName,
        globalRole: targetUser.globalRole as GlobalRole,
      },
      env.JWT_ACCESS_EXPIRES_IN_SECONDS,
      { amr: ['oauth', 'github'], authTime: Math.floor(Date.now() / 1000) }
    );
    const refresh = await issueRefreshTokenFamily(targetUser.id, meta);

    return {
      user: publicUser,
      accessToken,
      refreshToken: refresh.rawRefreshToken,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to upsert GitHub OAuth user:', error);
    throw new Error('Database error during GitHub OAuth sign-in.', { cause: error });
  }
}
