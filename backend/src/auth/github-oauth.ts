import crypto from 'crypto';
import { env, isAllowedOrigin } from '../config/env.ts';
import { AppError } from '../utils/errors.ts';

export interface GitHubProfile {
  githubId: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  avatarUrl: string | null;
}

export interface GitHubOAuthProvider {
  exchangeCodeForProfile(code: string, redirectUri: string): Promise<GitHubProfile>;
}

class LiveGitHubOAuthProvider implements GitHubOAuthProvider {
  async exchangeCodeForProfile(code: string, redirectUri: string): Promise<GitHubProfile> {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      throw new AppError(
        503,
        'GITHUB_OAUTH_UNCONFIGURED',
        'GitHub OAuth client credentials (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET) are not configured'
      );
    }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      throw new AppError(502, 'GITHUB_TOKEN_EXCHANGE_FAILED', 'Failed to exchange code with GitHub');
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw new AppError(
        401,
        'GITHUB_INVALID_CODE',
        tokenData.error || 'GitHub rejected the authorization code'
      );
    }

    const ghHeaders = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CodeCollab-Platform',
    };

    const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders });
    if (!userRes.ok) {
      throw new AppError(502, 'GITHUB_PROFILE_FETCH_FAILED', 'Failed to fetch GitHub user profile');
    }

    const ghUser = (await userRes.json()) as {
      id: number;
      login: string;
      name?: string | null;
      email?: string | null;
      avatar_url?: string | null;
    };

    let primaryEmail = '';
    let emailVerified = false;

    const emailsRes = await fetch('https://api.github.com/user/emails', { headers: ghHeaders });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const verifiedPrimary = emails.find((e) => e.primary && e.verified);
      const anyVerified = emails.find((e) => e.verified);
      const chosen = verifiedPrimary || anyVerified;
      if (chosen) {
        primaryEmail = chosen.email;
        emailVerified = true;
      } else if (emails[0]) {
        primaryEmail = emails[0].email;
        emailVerified = false;
      }
    }

    if (!primaryEmail) {
      primaryEmail = ghUser.email || `${ghUser.login}@users.noreply.github.com`;
      emailVerified = false;
    }

    return {
      githubId: String(ghUser.id),
      username: ghUser.login,
      displayName: ghUser.name || ghUser.login,
      email: primaryEmail.toLowerCase(),
      emailVerified,
      avatarUrl: ghUser.avatar_url || null,
    };
  }
}

let activeGitHubProvider: GitHubOAuthProvider = new LiveGitHubOAuthProvider();

export function setGitHubOAuthProvider(provider: GitHubOAuthProvider) {
  activeGitHubProvider = provider;
}

export function getGitHubOAuthProvider(): GitHubOAuthProvider {
  return activeGitHubProvider;
}

export function resetGitHubOAuthProvider() {
  activeGitHubProvider = new LiveGitHubOAuthProvider();
}

import { rememberOAuthState } from './oauth-state-store.ts';

export interface OAuthStatePayload {
  nonce: string;
  origin: string;
  exp: number;
}

export function isAllowedOAuthOrigin(origin: string): boolean {
  return isAllowedOrigin(origin, env.oauthAllowedOriginList);
}

export async function issueOAuthState(
  origin: string
): Promise<{ state: string; nonce: string; payload: OAuthStatePayload }> {
  const normalizedOrigin = origin ? origin.trim().replace(/\/$/, '') : env.APP_URL.replace(/\/$/, '');
  if (!isAllowedOAuthOrigin(normalizedOrigin)) {
    throw new AppError(400, 'OAUTH_ORIGIN_NOT_ALLOWED', `OAuth origin ${origin} is not in allowlist`);
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload: OAuthStatePayload = {
    nonce,
    origin: normalizedOrigin,
    exp: Date.now() + 10 * 60 * 1000, // 10 minutes
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(encoded)
    .digest('base64url');
  const state = `${encoded}.${sig}`;
  await rememberOAuthState(payload);
  return { state, nonce, payload };
}

export function signOAuthState(origin: string): string {
  const normalizedOrigin = origin ? origin.trim().replace(/\/$/, '') : env.APP_URL.replace(/\/$/, '');
  if (!isAllowedOAuthOrigin(normalizedOrigin)) {
    throw new AppError(400, 'OAUTH_ORIGIN_NOT_ALLOWED', `OAuth origin ${origin} is not in allowlist`);
  }
  const payload: OAuthStatePayload = {
    nonce: crypto.randomBytes(16).toString('hex'),
    origin: normalizedOrigin,
    exp: Date.now() + 10 * 60 * 1000, // 10 minutes
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(stateToken: string): OAuthStatePayload {
  const parts = stateToken.split('.');
  if (parts.length !== 2) {
    throw new AppError(400, 'OAUTH_INVALID_STATE', 'Malformed OAuth CSRF state parameter');
  }
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new AppError(400, 'OAUTH_INVALID_STATE', 'Invalid OAuth CSRF state signature');
  }

  let parsed: OAuthStatePayload;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    throw new AppError(400, 'OAUTH_INVALID_STATE', 'Corrupted OAuth state payload');
  }

  if (parsed.exp <= Date.now()) {
    throw new AppError(400, 'OAUTH_STATE_EXPIRED', 'OAuth state parameter has expired');
  }

  if (!isAllowedOAuthOrigin(parsed.origin)) {
    throw new AppError(400, 'OAUTH_ORIGIN_NOT_ALLOWED', 'OAuth state origin is not allowed');
  }

  return parsed;
}

export async function buildGitHubAuthorizeUrl(
  origin: string
): Promise<{ url: string; state: string; redirectUri: string; nonce: string }> {
  const { state, nonce } = await issueOAuthState(origin);
  const redirectUri = env.githubCallbackUrlResolved;
  const clientId = env.GITHUB_CLIENT_ID || 'unconfigured-github-client-id';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state,
  });

  return {
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    state,
    redirectUri,
    nonce,
  };
}

export function renderOAuthPopupHtml(result: {
  ok: boolean;
  targetOrigin: string;
  payload?: unknown;
  error?: { code: string; message: string };
}): string {
  const safeTargetOrigin = isAllowedOAuthOrigin(result.targetOrigin)
    ? result.targetOrigin.trim().replace(/\/$/, '')
    : env.APP_URL.replace(/\/$/, '');

  let humanMessage = 'Authentication complete. Closing window...';
  if (!result.ok) {
    const code = result.error?.code;
    if (code === 'OAUTH_STATE_REPLAYED') {
      humanMessage = 'This sign-in link has already been used or expired. Please try signing in again.';
    } else if (code === 'OAUTH_STATE_MISMATCH') {
      humanMessage = 'OAuth browser session mismatch. Please try signing in again.';
    } else if (code === 'GITHUB_ACCESS_DENIED') {
      humanMessage = 'GitHub sign-in was cancelled or access was denied.';
    } else if (code === 'ACCOUNT_COLLISION' || code === 'GITHUB_EMAIL_UNVERIFIED') {
      humanMessage = result.error?.message || 'An account with this email already exists. Please sign in with your password.';
    } else if (code === 'GITHUB_OAUTH_UNCONFIGURED') {
      humanMessage = 'GitHub sign-in is not configured on this server.';
    } else if (code === 'GITHUB_TOKEN_EXCHANGE_FAILED' || code === 'GITHUB_INVALID_CODE') {
      humanMessage = 'Failed to authenticate with GitHub. Please try again.';
    } else {
      humanMessage = result.error?.message || 'Authentication could not be completed. Please try again.';
    }
  }

  const messageObject = result.ok
    ? { type: 'OAUTH_AUTH_SUCCESS', payload: result.payload }
    : { type: 'OAUTH_AUTH_ERROR', error: { code: result.error?.code, message: humanMessage } };

  const data = {
    msg: messageObject,
    targetOrigin: safeTargetOrigin,
  };
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GitHub Authentication</title>
    <style>
      body {
        margin: 0;
        padding: 32px 20px;
        background: #0b0f19;
        color: #f1f5f9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 80vh;
        box-sizing: border-box;
      }
      .card {
        background: #111827;
        border: 1px solid #1f293d;
        border-radius: 12px;
        padding: 24px;
        max-width: 400px;
        width: 100%;
        text-align: center;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      }
      h2 {
        margin: 0 0 12px 0;
        font-size: 16px;
        font-weight: 600;
        color: ${result.ok ? '#10b981' : '#f87171'};
      }
      p {
        margin: 0 0 20px 0;
        font-size: 13px;
        color: #94a3b8;
        line-height: 1.5;
      }
      button {
        background: #1f2937;
        color: #f1f5f9;
        border: 1px solid #374151;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        font-weight: 500;
      }
      button:hover {
        background: #374151;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${result.ok ? 'Sign-in Complete' : 'Sign-in Failed'}</h2>
      <p id="status">${humanMessage}</p>
      ${!result.ok ? '<button type="button" onclick="window.close()">Close window</button>' : ''}
    </div>
    <script type="application/json" id="oauth-result">${serialized}</script>
    <script src="/api/auth/oauth-popup.js"></script>
  </body>
</html>`;
}
