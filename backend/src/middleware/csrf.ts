import { Request, Response, NextFunction } from 'express';
import { env, isAllowedOrigin } from '../config/env.ts';
import { AppError } from '../utils/errors.ts';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../auth/transport.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * P1-2: CSRF protection for cookie-authenticated mutating requests.
 * Exempts safe methods (GET, HEAD, OPTIONS) and Bearer-token requests (immune to CSRF).
 * For state-changing requests using cookie authentication, strictly validates Origin/Referer.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Requests using Bearer authorization header cannot be forged across origins by browsers
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return next();
  }

  // If request does not carry auth cookies, it is unauthenticated; route auth guards will handle it
  const hasAuthCookie = Boolean(
    req.cookies?.[ACCESS_COOKIE_NAME] || req.cookies?.[REFRESH_COOKIE_NAME]
  );
  if (!hasAuthCookie) {
    return next();
  }

  const origin = req.header('origin');
  const referer = req.header('referer');

  let candidateOrigin: string | null = null;
  if (origin) {
    candidateOrigin = origin;
  } else if (referer) {
    try {
      candidateOrigin = new URL(referer).origin;
    } catch {
      return next(new AppError(403, 'CSRF_ERROR', 'Invalid referer header on state-changing request'));
    }
  }

  if (!candidateOrigin) {
    return next(
      new AppError(
        403,
        'CSRF_ERROR',
        'State-changing cookie-authenticated request must provide Origin or Referer header'
      )
    );
  }

  if (!isAllowedOrigin(candidateOrigin, env.corsOriginList)) {
    return next(
      new AppError(403, 'CSRF_ERROR', `Origin ${candidateOrigin} is not allowed for state mutation`)
    );
  }

  return next();
}

