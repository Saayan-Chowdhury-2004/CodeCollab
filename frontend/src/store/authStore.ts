import { create } from 'zustand';
import {
  apiFetch,
  ApiClientError,
  AuthSessionResponse,
  refreshSessionTokens,
} from '../api/client.ts';
import {
  clearAuthSession,
  getAccessToken,
  getRefreshToken,
  setAuthSession,
} from '../api/transport.ts';
import { syncSocketAuth } from '../api/socket.ts';
import { formatApiError } from '../api/errors.ts';
import { UserDTO } from '../types/domain.ts';

// Same-origin fallback channel used by the OAuth popup page when window.opener is unavailable.
const OAUTH_CHANNEL_NAME = 'codecollab-oauth';
const OAUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1000;

export interface DemoAccountPreset {
  key: 'admin' | 'editor1' | 'editor2' | 'viewer';
  label: string;
  username: string;
  email: string;
  password: string;
  roleBadge: string;
}

export const DEMO_ACCOUNTS: DemoAccountPreset[] = [];

interface AuthState {
  user: UserDTO | null;
  bootstrapped: boolean;
  isLoading: boolean;
  error: string | null;
  oauthStatus: string | null;
  providers: { github: boolean; passwordLogin: boolean };

  clearError: () => void;
  bootstrapAuth: () => Promise<void>;
  fetchProviders: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<UserDTO>;
  register: (input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => Promise<UserDTO>;
  quickDemoLogin: (presetKey: DemoAccountPreset['key']) => Promise<UserDTO>;
  logout: () => Promise<void>;
  startGitHubOAuthPopup: () => Promise<void>;
  updateProfile: (input: {
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
    email?: string;
  }) => Promise<UserDTO>;
  changePassword: (input: {
    currentPassword?: string;
    newPassword: string;
  }) => Promise<void>;
  setUserDirect: (user: UserDTO | null) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  bootstrapped: false,
  isLoading: false,
  error: null,
  oauthStatus: null,
  providers: { github: false, passwordLogin: true },

  clearError: () => set({ error: null, oauthStatus: null }),

  setUserDirect: (user) => set({ user }),

  fetchProviders: async () => {
    try {
      const data = await apiFetch<{ github: boolean; passwordLogin: boolean }>(
        '/api/auth/providers'
      );
      set({ providers: data });
    } catch {
      set({ providers: { github: false, passwordLogin: true } });
    }
  },

  bootstrapAuth: async () => {
    if (get().bootstrapped) return;
    set({ isLoading: true, error: null });

    get().fetchProviders().catch(() => {});

    try {
      const existingAccess = getAccessToken();
      const existingRefresh = getRefreshToken();

      if (!existingAccess && existingRefresh) {
        const rotated = await refreshSessionTokens();
        if (rotated?.user) {
          syncSocketAuth();
          set({ user: rotated.user, bootstrapped: true, isLoading: false });
          return;
        }
      }

      if (getAccessToken()) {
        const res = await apiFetch<{ user: UserDTO }>('/api/auth/me');
        syncSocketAuth();
        set({ user: res.user, bootstrapped: true, isLoading: false });
        return;
      }

      set({ user: null, bootstrapped: true, isLoading: false });
    } catch {
      clearAuthSession();
      syncSocketAuth();
      set({ user: null, bootstrapped: true, isLoading: false });
    }
  },

  login: async (identifier, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiFetch<AuthSessionResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });

      setAuthSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      syncSocketAuth();
      set({ user: data.user, isLoading: false, error: null });
      return data.user;
    } catch (err) {
      const message = formatApiError(err, 'Failed to sign in');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  register: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiFetch<AuthSessionResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });

      setAuthSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      syncSocketAuth();
      set({ user: data.user, isLoading: false, error: null });
      return data.user;
    } catch (err) {
      const message = formatApiError(err, 'Registration failed');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  quickDemoLogin: async (presetKey) => {
    const preset = DEMO_ACCOUNTS.find((p) => p.key === presetKey);
    if (!preset) {
      throw new Error(`Unknown demo preset: ${presetKey}`);
    }
    return get().login(preset.email, preset.password);
  },

  logout: async () => {
    set({ isLoading: true, error: null });
    const refreshToken = getRefreshToken();
    try {
      await apiFetch('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        skipAuthRefresh: true,
      });
    } catch {
      // Ignore logout errors if token already expired
    } finally {
      clearAuthSession();
      syncSocketAuth();
      set({ user: null, isLoading: false, error: null });
    }
  },

  startGitHubOAuthPopup: async () => {
    set({ error: null, oauthStatus: 'Opening GitHub sign-in...' });
    try {
      const currentOrigin = window.location.origin;
      const startUrl = `/api/auth/github/start?origin=${encodeURIComponent(currentOrigin)}`;

      // Popup window is opened directly to /api/auth/github/start
      const popup = window.open(
        startUrl,
        'codecollab_github_oauth',
        'width=600,height=700,menubar=no,toolbar=no,location=yes,status=no'
      );

      if (!popup) {
        set({
          oauthStatus: null,
          error: 'Popup was blocked by your browser. Please allow popups for this site.',
        });
        return;
      }

      const expectedOrigin = new URL(
        import.meta.env.VITE_API_URL || window.location.origin,
        window.location.origin
      ).origin;

      let finished = false;
      let channel: BroadcastChannel | null = null;
      let flowTimeout: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        finished = true;
        window.removeEventListener('message', handleMessage);
        clearInterval(checkClosedInterval);
        if (flowTimeout) clearTimeout(flowTimeout);
        if (channel) {
          channel.onmessage = null;
          channel.close();
          channel = null;
        }
      };

      const handleResult = (raw: unknown) => {
        if (finished) return;

        const data = raw as
          | { type: 'OAUTH_AUTH_SUCCESS'; payload?: AuthSessionResponse }
          | { type: 'OAUTH_AUTH_ERROR'; error?: { code: string; message: string } }
          | undefined;

        if (!data || typeof data !== 'object' || !('type' in data)) {
          return;
        }

        if (data.type === 'OAUTH_AUTH_SUCCESS') {
          if (!data.payload?.accessToken || !data.payload.user) return;
          finish();
          setAuthSession({
            accessToken: data.payload.accessToken,
            refreshToken: data.payload.refreshToken,
          });
          syncSocketAuth();
          set({
            user: data.payload.user,
            oauthStatus: null,
            error: null,
          });
        } else if (data.type === 'OAUTH_AUTH_ERROR') {
          finish();
          set({
            oauthStatus: null,
            error: data.error?.message || 'GitHub sign-in could not be completed',
          });
        }
      };

      // Primary path: postMessage from the popup, with strict origin and source validation.
      const handleMessage = (event: MessageEvent) => {
        if (
          event.origin !== expectedOrigin &&
          event.origin !== window.location.origin
        ) {
          return;
        }

        if (event.source !== popup) {
          return;
        }

        handleResult(event.data);
      };

      window.addEventListener('message', handleMessage);

      // Fallback path: same-origin BroadcastChannel, used when the browser detached the popup
      // from this window (window.opener === null, popup.closed reads true).
      if (typeof BroadcastChannel === 'function') {
        channel = new BroadcastChannel(OAUTH_CHANNEL_NAME);
        channel.onmessage = (event: MessageEvent) => handleResult(event.data);
      }

      // Stop waiting once the OAuth state would have expired.
      flowTimeout = setTimeout(() => {
        if (!finished) {
          finish();
          set({ oauthStatus: null });
        }
      }, OAUTH_FLOW_TIMEOUT_MS);

      // If the popup closes without a result, reset the button after 1s without an error toast.
      // With the BroadcastChannel fallback we keep listening, because a detached popup can report
      // closed before the sign-in actually finishes.
      const checkClosedInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosedInterval);
          setTimeout(() => {
            if (!finished) set({ oauthStatus: null });
          }, 1000);
          if (!channel) {
            finish();
          }
        }
      }, 500);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Failed to initialize GitHub sign-in';
      set({ oauthStatus: null, error: message });
    }
  },

  updateProfile: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await apiFetch<{ user: UserDTO }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      set({ user: res.user, isLoading: false });
      return res.user;
    } catch (err) {
      const message = formatApiError(err, 'Failed to update profile');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  changePassword: async (input) => {
    set({ isLoading: true, error: null });
    try {
      await apiFetch<{ status: string }>('/api/users/me/password', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set({ isLoading: false, error: null });
    } catch (err) {
      const message = formatApiError(err, 'Failed to change password');
      set({ isLoading: false, error: message });
      throw err;
    }
  },
}));
