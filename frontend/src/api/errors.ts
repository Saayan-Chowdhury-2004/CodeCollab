// Pure helper (no imports) that turns API errors into messages a person can act on.

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  username: 'Username',
  displayName: 'Display name',
  password: 'Password',
  newPassword: 'New password',
  currentPassword: 'Current password',
  identifier: 'Email or username',
  avatarUrl: 'Avatar URL',
};

interface ValidationDetail {
  path?: unknown;
  message?: unknown;
}

/**
 * For validation errors (code VALIDATION_ERROR) returns "Field: reason" for every failing field.
 * For any other API error returns the server message. For anything else (network failures,
 * unexpected throws) returns the fallback.
 */
export function formatApiError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const apiErr = err as Error & { code?: unknown; details?: unknown };
  if (typeof apiErr.code !== 'string') return fallback;

  if (apiErr.code === 'VALIDATION_ERROR' && Array.isArray(apiErr.details)) {
    const parts: string[] = [];
    for (const raw of apiErr.details as ValidationDetail[]) {
      if (!raw || typeof raw.message !== 'string' || raw.message.length === 0) continue;
      const path = typeof raw.path === 'string' ? raw.path : '';
      const label = path ? (FIELD_LABELS[path] ?? path) : '';
      parts.push(label ? `${label}: ${raw.message}` : raw.message);
    }
    if (parts.length > 0) return parts.join(' • ');
  }

  return apiErr.message || fallback;
}
