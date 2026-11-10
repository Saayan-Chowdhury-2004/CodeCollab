import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env, isAllowedOrigin, logOptionalFeaturesStatus } from './config/env.ts';
import { logger } from './config/logger.ts';
import { requestIdMiddleware } from './middleware/request-id.ts';
import { apiRateLimiter } from './middleware/rate-limit.ts';
import { errorHandler, notFoundHandler } from './middleware/error-handler.ts';
import { checkDatabaseHealth, pingDatabase } from './db/health.ts';
import { csrfProtection } from './middleware/csrf.ts';
import { optionalAuth } from './middleware/authenticate.ts';
import { AppError } from './utils/errors.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { usersRouter } from './modules/users/users.routes.ts';
import { snippetsRouter } from './modules/snippets/snippets.routes.ts';
import { searchRouter } from './modules/search/search.routes.ts';
import { commentsRouter } from './modules/comments/comments.routes.ts';
import { notificationsRouter } from './modules/notifications/notifications.routes.ts';
import { activityRouter } from './modules/activity/activity.routes.ts';
import { docsRouter } from './docs/openapi.ts';

function parseCspList(raw: string, fallback: string[]): string[] {
  const items = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export function createApp(): Express {
  logOptionalFeaturesStatus(env, (obj, msg) => logger.info(obj, msg));

  const app = express();

  app.set('trust proxy', env.TRUST_PROXY_HOPS > 0 ? env.TRUST_PROXY_HOPS : false);

  const frameAncestors = parseCspList(env.CSP_FRAME_ANCESTORS, ["'none'"]);
  const scriptSrc = parseCspList(env.CSP_SCRIPT_SRC, ["'self'"]);
  const styleSrc = parseCspList(env.CSP_STYLE_SRC, ["'self'", "'unsafe-inline'"]);
  const connectSrc = parseCspList(env.CSP_CONNECT_SRC, ["'self'", 'ws:', 'wss:']);

  // Strict-by-default, env-configurable CSP, COOP, and frame-ancestors
  app.use(
    helmet({
      frameguard: frameAncestors.includes("'none'") ? { action: 'deny' } : false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc,
          styleSrc,
          fontSrc: ["'self'", 'data:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc,
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS with strict exact-match allowlist from env
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }
        if (isAllowedOrigin(origin, env.corsOriginList)) {
          return callback(null, true);
        }
        return callback(
          new AppError(403, 'CORS_NOT_ALLOWED', `Origin ${origin} is not in CORS allowlist`)
        );
      },
      credentials: true,
      exposedHeaders: ['x-request-id'],
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);
  app.use(csrfProtection);
  app.use('/api', apiRateLimiter);

  // Liveness health endpoint
  app.get('/api/health', async (req: Request, res: Response) => {
    try {
      const isLive = await pingDatabase();
      if (!isLive) {
        return res.status(503).json({
          status: 'degraded',
          db: 'disconnected',
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        });
      }
      return res.status(200).json({
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      });
    } catch {
      return res.status(503).json({
        status: 'degraded',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      });
    }
  });

  // Detailed readiness check (table counts), guarded by admin auth or internal secret
  app.get('/api/health/ready', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const secretHeader = req.header('x-health-secret');
      const isAuthorizedSecret = env.HEALTH_CHECK_SECRET && secretHeader === env.HEALTH_CHECK_SECRET;
      const isAdmin = req.user?.globalRole === 'admin';

      if (env.NODE_ENV === 'production' && !isAdmin && !isAuthorizedSecret) {
        throw new AppError(403, 'FORBIDDEN', 'Access to readiness metrics is restricted');
      }

      const dbSummary = await checkDatabaseHealth();
      return res.status(200).json({
        status: 'ok',
        db: dbSummary.connected ? 'connected' : 'disconnected',
        counts: dbSummary.counts,
        authTransport: env.AUTH_TRANSPORT,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      });
    } catch (error) {
      return next(error);
    }
  });

  // OpenAPI 3.0 / Swagger UI Documentation (/api/docs and /api/docs.json)
  app.use('/api', docsRouter);

  // Domain API routers
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/snippets/:snippetId/comments', commentsRouter);
  app.use('/api/snippets', snippetsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/activities', activityRouter);

  // Catch-all for unknown /api/* routes
  app.use('/api', notFoundHandler);

  // Global error handler
  app.use(errorHandler);

  return app;
}
