import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, formatErrorResponse } from '../utils/errors.ts';
import { logger } from '../config/logger.ts';

export function notFoundHandler(req: Request, res: Response) {
  res
    .status(404)
    .json(
      formatErrorResponse(
        'NOT_FOUND',
        `Route ${req.method} ${req.originalUrl} not found`
      )
    );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const reqLogger = req.log || logger.child({ requestId: req.requestId || 'unknown' });

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      reqLogger.error({ err, code: err.code }, err.message);
    } else {
      reqLogger.warn({ code: err.code, details: err.details }, err.message);
    }
    return res
      .status(err.statusCode)
      .json(formatErrorResponse(err.code, err.message, err.details));
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    reqLogger.warn({ details }, 'Request validation failed');
    return res
      .status(400)
      .json(formatErrorResponse('VALIDATION_ERROR', 'Invalid request payload or parameters', details));
  }

  if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
    reqLogger.warn('Malformed JSON body');
    return res
      .status(400)
      .json(formatErrorResponse('MALFORMED_JSON', 'Malformed JSON in request body'));
  }

  reqLogger.error({ err }, 'Unhandled internal server error');
  return res
    .status(500)
    .json(formatErrorResponse('INTERNAL_SERVER_ERROR', 'An unexpected internal error occurred'));
}
