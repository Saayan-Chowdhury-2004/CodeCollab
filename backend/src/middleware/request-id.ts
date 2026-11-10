import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { createRequestLogger } from '../config/logger.ts';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: pino.Logger;
    }
  }
}

const SAFE_REQ_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId =
    incoming && SAFE_REQ_ID_REGEX.test(incoming) ? incoming : crypto.randomUUID();

  req.requestId = requestId;
  req.log = createRequestLogger(requestId);
  res.setHeader('x-request-id', requestId);

  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    req.log.info(
      {
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      },
      'HTTP request completed'
    );
  });

  next();
}
