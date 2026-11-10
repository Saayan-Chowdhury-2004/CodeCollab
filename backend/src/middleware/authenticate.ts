import { Request, Response, NextFunction } from 'express';
import { extractAccessToken } from '../auth/transport.ts';
import { AuthenticatedUser, verifyAccessToken } from '../auth/jwt.ts';
import { authorize } from '../auth/authorize.ts';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser | null;
    }
  }
}

/**
 * Extracts and verifies the JWT access token if present.
 * - If no token is present, sets `req.user = null` and continues.
 * - If a token is present and valid, populates `req.user`.
 * - If a token is present but expired or invalid, passes 401 AppError to errorHandler.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      username: decoded.username,
      globalRole: decoded.globalRole,
      authTime: decoded.authTime,
      amr: decoded.amr,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Requires an authenticated user via the central `authorize` module.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  optionalAuth(req, res, (err) => {
    if (err) return next(err);
    try {
      authorize(req.user, 'auth:authenticated');
      return next();
    } catch (authErr) {
      return next(authErr);
    }
  });
}
