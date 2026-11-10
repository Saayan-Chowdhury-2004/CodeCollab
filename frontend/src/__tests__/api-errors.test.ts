import { describe, expect, it } from 'vitest';
import { formatApiError } from '../api/errors.ts';

class FakeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

describe('formatApiError', () => {
  it('lists every failing field with a readable label for validation errors', () => {
    const err = new FakeApiError('VALIDATION_ERROR', 'Invalid request payload or parameters', [
      {
        path: 'password',
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
      },
      { path: 'username', message: 'Username must be at least 3 characters' },
    ]);
    expect(formatApiError(err, 'Registration failed')).toBe(
      'Password: Password must contain at least one uppercase letter, one lowercase letter, and one number • Username: Username must be at least 3 characters'
    );
  });

  it('falls back to the server message when validation details are missing or empty', () => {
    expect(formatApiError(new FakeApiError('VALIDATION_ERROR', 'Invalid request', []), 'x')).toBe(
      'Invalid request'
    );
    expect(formatApiError(new FakeApiError('VALIDATION_ERROR', 'Invalid request'), 'x')).toBe(
      'Invalid request'
    );
  });

  it('returns the server message for other API errors', () => {
    expect(formatApiError(new FakeApiError('INVALID_CREDENTIALS', 'Wrong email or password'), 'x')).toBe(
      'Wrong email or password'
    );
  });

  it('uses the fallback for network failures and non-error values', () => {
    expect(formatApiError(new TypeError('Failed to fetch'), 'Registration failed')).toBe(
      'Registration failed'
    );
    expect(formatApiError('boom', 'Registration failed')).toBe('Registration failed');
    expect(formatApiError(undefined, 'Registration failed')).toBe('Registration failed');
  });

  it('uses the raw path when a field has no friendly label and skips entries without a message', () => {
    const err = new FakeApiError('VALIDATION_ERROR', 'Invalid', [
      { path: 'tags.0', message: 'Too long' },
      { path: 'title' },
      null,
    ]);
    expect(formatApiError(err, 'x')).toBe('tags.0: Too long');
  });
});
