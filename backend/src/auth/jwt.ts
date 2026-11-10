import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import { AppError } from '../utils/errors.ts';

export type GlobalRole = 'admin' | 'editor' | 'viewer';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  globalRole: GlobalRole;
  authTime?: number;
  amr?: string[];
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  username: string;
  globalRole: GlobalRole;
  authTime?: number;
  amr?: string[];
  iat?: number;
  exp?: number;
}

export function signAccessToken(
  user: AuthenticatedUser,
  expiresInSeconds: number = env.JWT_ACCESS_EXPIRES_IN_SECONDS,
  options?: { amr?: string[]; authTime?: number }
): string {
  const authTime = options?.authTime ?? user.authTime ?? Math.floor(Date.now() / 1000);
  const amr = options?.amr ?? user.amr ?? ['password'];

  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    username: user.username,
    globalRole: user.globalRole,
    authTime,
    amr,
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as AccessTokenPayload & { iat: number; exp: number };
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired');
    }
    if (env.JWT_ACCESS_SECRET_PREVIOUS) {
      try {
        const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET_PREVIOUS, {
          algorithms: ['HS256'],
        }) as AccessTokenPayload & { iat: number; exp: number };
        return decoded;
      } catch (prevErr) {
        if (prevErr instanceof jwt.TokenExpiredError) {
          throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired');
        }
      }
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or malformed access token');
  }
}
