/**
 * Client-side token transport module.
 * - Access token is kept strictly in memory (module closure variable).
 * - Refresh token is kept in sessionStorage (never localStorage) when in bearer mode.
 * - Supports AUTH_TRANSPORT = 'bearer' | 'cookie'.
 */

export type ClientAuthTransport = 'bearer' | 'cookie';

const REFRESH_STORAGE_KEY = 'cc_refresh_token';

let inMemoryAccessToken: string | null = null;

export function getClientAuthTransport(): ClientAuthTransport {
  const mode = import.meta.env.VITE_AUTH_TRANSPORT;
  return mode === 'cookie' ? 'cookie' : 'bearer';
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getRefreshToken(): string | null {
  try {
    return window.sessionStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthSession(tokens: { accessToken: string; refreshToken?: string | null }): void {
  inMemoryAccessToken = tokens.accessToken;
  try {
    if (tokens.refreshToken) {
      window.sessionStorage.setItem(REFRESH_STORAGE_KEY, tokens.refreshToken);
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
}

export function clearAuthSession(): void {
  inMemoryAccessToken = null;
  try {
    window.sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function buildAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    ...extraHeaders,
  };
  if (inMemoryAccessToken) {
    headers['Authorization'] = `Bearer ${inMemoryAccessToken}`;
  }
  return headers;
}
