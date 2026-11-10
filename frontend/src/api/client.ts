import {
  buildAuthHeaders,
  clearAuthSession,
  getRefreshToken,
  setAuthSession,
} from './transport.ts';
import { UserDTO } from '../types/domain.ts';

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken?: string;
  user: UserDTO;
  authTransport?: 'bearer' | 'cookie';
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let inFlightRefreshPromise: Promise<AuthSessionResponse | null> | null = null;

/**
 * Single-flight refresh token rotation.
 * Deduplicates concurrent refresh attempts so parallel 401 responses never trigger
 * false-positive refresh token reuse detection.
 */
export async function refreshSessionTokens(): Promise<AuthSessionResponse | null> {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    try {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });

      if (!response.ok) {
        clearAuthSession();
        return null;
      }

      const data = (await response.json()) as AuthSessionResponse;
      if (data.accessToken) {
        setAuthSession({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? refreshToken,
        });
        return data;
      }

      clearAuthSession();
      return null;
    } catch {
      return null;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

export interface ApiFetchOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  skipAuthRefresh?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const { headers: extraHeaders, skipAuthRefresh, ...restInit } = options;

  const makeRequest = async () => {
    const headers = buildAuthHeaders({
      ...(restInit.body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    });

    return fetch(url, {
      ...restInit,
      credentials: 'include',
      headers,
    });
  };

  let response = await makeRequest();

  // Automatically attempt refresh rotation on 401 once
  if (
    response.status === 401 &&
    !skipAuthRefresh &&
    !path.includes('/api/auth/login') &&
    !path.includes('/api/auth/register') &&
    !path.includes('/api/auth/refresh')
  ) {
    const refreshed = await refreshSessionTokens();
    if (refreshed?.accessToken) {
      response = await makeRequest();
    }
  }

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errObj =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code?: string; message?: string; details?: unknown } }).error
        : null;

    throw new ApiClientError(
      response.status,
      errObj?.code || `HTTP_${response.status}`,
      errObj?.message || `Request failed with status ${response.status}`,
      errObj?.details
    );
  }

  return payload as T;
}
