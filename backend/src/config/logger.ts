import pino from 'pino';
import { env } from './env.ts';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: {
    service: 'codecollab-backend',
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
    ],
    censor: '[REDACTED]',
  },
});

export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
