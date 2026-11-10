import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { formatErrorResponse } from '../utils/errors.ts';
import { env } from '../config/env.ts';

export function authRateLimitKeyGenerator(req: any): string {
  const ip = ipKeyGenerator(req);
  const rawId = req.body?.identifier ?? req.body?.email ?? req.body?.username;
  let identifierHash = 'none';
  if (typeof rawId === 'string' && rawId.trim().length > 0) {
    identifierHash = crypto
      .createHash('sha256')
      .update(rawId.trim().toLowerCase())
      .digest('hex')
      .slice(0, 16);
  }
  return `${ip}:${identifierHash}`;
}

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.API_RATE_LIMIT_MAX ?? (env.NODE_ENV === 'test' ? 1000 : 120),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true },
  handler: (_req, res) => {
    res
      .status(429)
      .json(formatErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests, please try again shortly.'));
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.AUTH_RATE_LIMIT_MAX ?? (env.NODE_ENV === 'test' ? 500 : 25),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: { trustProxy: true },
  keyGenerator: authRateLimitKeyGenerator,
  handler: (_req, res) => {
    res
      .status(429)
      .json(
        formatErrorResponse(
          'AUTH_RATE_LIMIT_EXCEEDED',
          'Too many authentication attempts, please wait before retrying.'
        )
      );
  },
});

export const authIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'test' ? 1000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true },
  handler: (_req, res) => {
    res
      .status(429)
      .json(
        formatErrorResponse(
          'AUTH_RATE_LIMIT_EXCEEDED',
          'Too many authentication requests from this IP address, please wait before retrying.'
        )
      );
  },
});
