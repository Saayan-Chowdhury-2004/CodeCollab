import { Request, Response } from 'express';
import { env } from '../config/env.ts';

export type AuthTransportMode = 'bearer' | 'cookie';

export const ACCESS_COOKIE_NAME = 'cc_access_token';
export const REFRESH_COOKIE_NAME = 'cc_refresh_token';

export function getEffectiveTransport(_req?: Request): AuthTransportMode {
  return env.AUTH_TRANSPORT;
}

export function extractAccessToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const transport = getEffectiveTransport(req);
  if (transport === 'cookie' && req.cookies?.[ACCESS_COOKIE_NAME]) {
    return String(req.cookies[ACCESS_COOKIE_NAME]);
  }

  return null;
}

export function extractRefreshToken(req: Request): string | null {
  const transport = getEffectiveTransport(req);
  if (transport === 'cookie' && req.cookies?.[REFRESH_COOKIE_NAME]) {
    return String(req.cookies[REFRESH_COOKIE_NAME]);
  }
  if (typeof req.body?.refreshToken === 'string' && req.body.refreshToken.trim()) {
    return req.body.refreshToken.trim();
  }
  if (req.cookies?.[REFRESH_COOKIE_NAME]) {
    return String(req.cookies[REFRESH_COOKIE_NAME]);
  }
  return null;
}

export function sendAuthTokens<TUser>(
  req: Request,
  res: Response,
  payload: { accessToken: string; refreshToken: string; user: TUser },
  statusCode = 200
) {
  const transport = getEffectiveTransport(req);

  if (transport === 'cookie') {
    const refreshMaxAgeMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
    const accessMaxAgeMs = env.JWT_ACCESS_EXPIRES_IN_SECONDS * 1000;

    res.cookie(REFRESH_COOKIE_NAME, payload.refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: '/api/auth',
      maxAge: refreshMaxAgeMs,
    });

    res.cookie(ACCESS_COOKIE_NAME, payload.accessToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: '/',
      maxAge: accessMaxAgeMs,
    });
    return res.status(statusCode).json({
      transport: 'cookie',
      user: payload.user,
    });
  }

  return res.status(statusCode).json({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    transport: 'bearer',
    user: payload.user,
  });
}

export function clearAuthTokens(req: Request, res: Response) {
  const transport = getEffectiveTransport(req);
  if (transport === 'cookie' || req.cookies?.[REFRESH_COOKIE_NAME]) {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: '/api/auth',
    });
    res.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: '/',
    });
  }
}
