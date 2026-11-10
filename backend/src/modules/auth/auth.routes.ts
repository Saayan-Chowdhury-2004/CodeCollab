import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateRequest } from '../../middleware/validate.ts';
import { authRateLimiter, authIpRateLimiter } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/authenticate.ts';
import { authorize } from '../../auth/authorize.ts';
import {
  clearAuthTokens,
  extractRefreshToken,
  sendAuthTokens,
} from '../../auth/transport.ts';
import {
  revokeRefreshTokenFamilyByToken,
  rotateRefreshToken,
} from '../../auth/refresh.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import {
  buildGitHubAuthorizeUrl,
  getGitHubOAuthProvider,
  renderOAuthPopupHtml,
  verifyOAuthState,
} from '../../auth/github-oauth.ts';
import { consumeOAuthState } from '../../auth/oauth-state-store.ts';
import {
  getUserById,
  loginUser,
  registerUser,
  upsertGitHubUser,
} from './auth.service.ts';
import { AppError } from '../../utils/errors.ts';
import { env, isGitHubConfigured } from '../../config/env.ts';
import { logger } from '../../config/logger.ts';

export const authRouter = Router();

// The OAuth popup pages (start errors and the callback) must not force a browsing-context-group
// switch, otherwise window.opener becomes null and the popup cannot hand the session back to the
// app window. Helmet's app-wide COOP (same-origin-allow-popups) only matches an opener that sends
// the same header, which a static host such as nginx does not. unsafe-none is retained by both
// kinds of opener. These pages carry no framing risk (frame-ancestors stays 'none').
function popupOpenerPolicy(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  next();
}

const registerBodySchema = z
  .object({
    email: z.string().email('Valid email address is required').max(255),
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, underscores, and hyphens'),
    displayName: z.string().min(1, 'Display name is required').max(120),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      ),
  })
  .strict();

const loginBodySchema = z
  .object({
    identifier: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((data) => Boolean(data.identifier || data.email || data.username), {
    message: 'Either identifier, email, or username is required',
    path: ['identifier'],
  });

const refreshBodySchema = z.object({
  refreshToken: z.string().min(16).optional(),
});

const githubUrlQuerySchema = z.object({
  origin: z.string().optional(),
});

const githubStartQuerySchema = z.object({
  origin: z.string().optional(),
});

const githubCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

// GET /api/auth/providers
authRouter.get('/providers', (_req: Request, res: Response) => {
  return res.status(200).json({
    github: isGitHubConfigured(),
    passwordLogin: true,
  });
});

// POST /api/auth/register
authRouter.post(
  '/register',
  authIpRateLimiter,
  authRateLimiter,
  validateRequest({ body: registerBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await registerUser(req.body, {
        userAgent: req.header('user-agent'),
        ipAddress: req.ip,
      });
      return sendAuthTokens(req, res, result, 201);
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/auth/login
authRouter.post(
  '/login',
  authIpRateLimiter,
  authRateLimiter,
  validateRequest({ body: loginBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = req.body.identifier || req.body.email || req.body.username;
      const result = await loginUser(
        { identifier, password: req.body.password },
        {
          userAgent: req.header('user-agent'),
          ipAddress: req.ip,
        }
      );
      return sendAuthTokens(req, res, result, 200);
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/auth/refresh
authRouter.post(
  '/refresh',
  authRateLimiter,
  validateRequest({ body: refreshBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawToken = extractRefreshToken(req);
      if (!rawToken) {
        throw new AppError(401, 'MISSING_REFRESH_TOKEN', 'Refresh token is required');
      }

      const rotated = await rotateRefreshToken(
        rawToken,
        {
          userAgent: req.header('user-agent'),
          ipAddress: req.ip,
        },
        req.log
      );

      const accessToken = signAccessToken(rotated.user);
      return sendAuthTokens(
        req,
        res,
        {
          accessToken,
          refreshToken: rotated.rawRefreshToken,
          user: rotated.user,
        },
        200
      );
    } catch (error) {
      clearAuthTokens(req, res);
      return next(error);
    }
  }
);

// POST /api/auth/logout
authRouter.post(
  '/logout',
  validateRequest({ body: refreshBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawToken = extractRefreshToken(req);
      if (rawToken) {
        await revokeRefreshTokenFamilyByToken(rawToken);
      }
      clearAuthTokens(req, res);
      return res.status(200).json({ status: 'logged_out' });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/auth/me
authRouter.get(
  '/me',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      authorize(req.user, 'auth:authenticated');
      const user = await getUserById(req.user!.id);
      return res.status(200).json({ user });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/auth/oauth-popup.js
authRouter.get('/oauth-popup.js', (_req: Request, res: Response) => {
  const filePath = path.resolve(import.meta.dirname, '../../auth/oauth-popup.js');
  res.type('application/javascript').sendFile(filePath);
});

// GET /api/auth/github/start
authRouter.get(
  '/github/start',
  popupOpenerPolicy,
  authIpRateLimiter,
  authRateLimiter,
  validateRequest({ query: githubStartQuerySchema }),
  async (req: Request, res: Response) => {
    const origin =
      (typeof req.query.origin === 'string' && req.query.origin) ||
      req.header('origin') ||
      env.APP_URL;

    if (!isGitHubConfigured()) {
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin: origin,
        error: {
          code: 'GITHUB_OAUTH_UNCONFIGURED',
          message: 'GitHub sign-in is not configured on this server.',
        },
      });
      return res.status(503).type('html').send(html);
    }

    try {
      const result = await buildGitHubAuthorizeUrl(origin);
      res.cookie('cc_oauth_state', result.nonce, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.COOKIE_SECURE,
        path: '/api/auth',
        maxAge: 10 * 60 * 1000,
      });
      return res.redirect(302, result.url);
    } catch (error) {
      const appErr =
        error instanceof AppError
          ? error
          : new AppError(400, 'OAUTH_START_FAILED', (error as Error).message);
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin: origin,
        error: { code: appErr.code, message: appErr.message },
      });
      return res.status(appErr.statusCode).type('html').send(html);
    }
  }
);

// GET /api/auth/github/url
authRouter.get(
  '/github/url',
  authIpRateLimiter,
  authRateLimiter,
  validateRequest({ query: githubUrlQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const origin =
        (typeof req.query.origin === 'string' && req.query.origin) ||
        req.header('origin') ||
        env.APP_URL;
      const result = await buildGitHubAuthorizeUrl(origin);
      res.cookie('cc_oauth_state', result.nonce, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.COOKIE_SECURE,
        path: '/api/auth',
        maxAge: 10 * 60 * 1000,
      });
      return res.status(200).json({
        url: result.url,
        state: result.state,
        redirectUri: result.redirectUri,
      });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/auth/github/callback
authRouter.get(
  ['/github/callback', '/github/callback/'],
  popupOpenerPolicy,
  authIpRateLimiter,
  authRateLimiter,
  validateRequest({ query: githubCallbackQuerySchema }),
  async (req: Request, res: Response) => {
    const errorParam = req.query.error ? String(req.query.error) : undefined;
    const errorDesc = req.query.error_description ? String(req.query.error_description) : undefined;
    const code = req.query.code ? String(req.query.code) : undefined;
    const state = req.query.state ? String(req.query.state) : undefined;

    if (errorParam) {
      res.clearCookie('cc_oauth_state', { path: '/api/auth' });
      let targetOrigin = env.APP_URL;
      if (state) {
        try {
          const verified = verifyOAuthState(state);
          targetOrigin = verified.origin;
        } catch {
          // ignore
        }
      }
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin,
        error: {
          code: 'GITHUB_ACCESS_DENIED',
          message: errorDesc || 'GitHub sign-in was cancelled or access was denied.',
        },
      });
      return res.status(400).type('html').send(html);
    }

    if (!code || !state) {
      res.clearCookie('cc_oauth_state', { path: '/api/auth' });
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin: env.APP_URL,
        error: {
          code: 'OAUTH_MISSING_PARAMETERS',
          message: 'Missing OAuth authorization code or state parameter',
        },
      });
      return res.status(400).type('html').send(html);
    }

    let statePayload;
    try {
      statePayload = verifyOAuthState(state);
    } catch (err) {
      const appErr =
        err instanceof AppError
          ? err
          : new AppError(400, 'OAUTH_INVALID_STATE', 'Invalid OAuth state');
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin: env.APP_URL,
        error: { code: appErr.code, message: appErr.message },
      });
      return res.status(appErr.statusCode).type('html').send(html);
    }

    // Cookie binding check (browser-bound nonce)
    const cookieNonce = req.cookies?.cc_oauth_state;
    if (!cookieNonce || cookieNonce !== statePayload.nonce) {
      res.clearCookie('cc_oauth_state', { path: '/api/auth' });
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin: statePayload.origin,
        error: { code: 'OAUTH_STATE_MISMATCH', message: 'OAuth browser session mismatch' },
      });
      return res.status(400).type('html').send(html);
    }

    // Single-use check (atomic DB consume)
    const consumed = await consumeOAuthState(statePayload);
    if (!consumed) {
      res.clearCookie('cc_oauth_state', { path: '/api/auth' });
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin: statePayload.origin,
        error: {
          code: 'OAUTH_STATE_REPLAYED',
          message: 'This sign-in link was already used or expired',
        },
      });
      return res.status(400).type('html').send(html);
    }

    res.clearCookie('cc_oauth_state', { path: '/api/auth' });

    try {
      const provider = getGitHubOAuthProvider();
      const profile = await provider.exchangeCodeForProfile(code, env.githubCallbackUrlResolved);
      const session = await upsertGitHubUser(profile, {
        userAgent: req.header('user-agent'),
        ipAddress: req.ip,
      });

      const html = renderOAuthPopupHtml({
        ok: true,
        targetOrigin: statePayload.origin,
        payload: session,
      });
      return res.status(200).type('html').send(html);
    } catch (err) {
      logger.error({ err }, 'GitHub OAuth callback failed');
      const appErr =
        err instanceof AppError
          ? err
          : new AppError(502, 'GITHUB_OAUTH_FAILED', (err as Error).message);
      const html = renderOAuthPopupHtml({
        ok: false,
        targetOrigin: statePayload.origin,
        error: { code: appErr.code, message: appErr.message },
      });
      return res.status(appErr.statusCode).type('html').send(html);
    }
  }
);
