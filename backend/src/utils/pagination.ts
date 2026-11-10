import { z } from 'zod';
import { AppError } from './errors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CursorPayload {
  sortValue: string | number;
  id: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.id !== 'string' ||
      !UUID_REGEX.test(parsed.id) ||
      (typeof parsed.sortValue !== 'string' && typeof parsed.sortValue !== 'number')
    ) {
      throw new Error('Malformed cursor structure');
    }
    return parsed as CursorPayload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'INVALID_CURSOR', 'Provided pagination cursor is invalid');
  }
}

export function decodeDateCursor(cursor: string): { id: string; sortValue: Date } {
  const decoded = decodeCursor(cursor);
  const date = new Date(decoded.sortValue);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'INVALID_CURSOR', 'Provided pagination cursor is invalid');
  }
  return { id: decoded.id, sortValue: date };
}

export function decodeNumericCursor(cursor: string): { id: string; sortValue: number } {
  const decoded = decodeCursor(cursor);
  const num = typeof decoded.sortValue === 'number' ? decoded.sortValue : Number(decoded.sortValue);
  if (!Number.isFinite(num)) {
    throw new AppError(400, 'INVALID_CURSOR', 'Provided pagination cursor is invalid');
  }
  return { id: decoded.id, sortValue: num };
}
