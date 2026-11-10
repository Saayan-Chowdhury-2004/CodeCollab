import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { runSeed, SEED_IDS } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { env } from '../config/env.ts';
import {
  setGitHubOAuthProvider,
  resetGitHubOAuthProvider,
  buildGitHubAuthorizeUrl,
  verifyOAuthState,
  GitHubOAuthProvider,
} from '../auth/github-oauth.ts';
import { signAccessToken } from '../auth/jwt.ts';

describe('GitHub OAuth & Providers Flow', () => {
  const app = createApp();

  beforeAll(async () => {
    (env as unknown as { GITHUB_CLIENT_ID: string }).GITHUB_CLIENT_ID = 'test_github_client_id_123';
    (env as unknown as { GITHUB_CLIENT_SECRET: string }).GITHUB_CLIENT_SECRET = 'test_github_client_secret_456';
    await runSeed();
  });

  afterAll(() => {
    resetGitHubOAuthProvider();
  });

  // 1. Providers endpoint
  it('1. GET /api/auth/providers returns configuration without leaking secrets or IDs', async () => {
    const origId = env.GITHUB_CLIENT_ID;
    const origSecret = env.GITHUB_CLIENT_SECRET;
    try {
      (env as unknown as { GITHUB_CLIENT_ID: string }).GITHUB_CLIENT_ID = '';
      (env as unknown as { GITHUB_CLIENT_SECRET: string }).GITHUB_CLIENT_SECRET = '';

      const unconfiguredRes = await request(app).get('/api/auth/providers');
      expect(unconfiguredRes.status).toBe(200);
      expect(unconfiguredRes.body).toEqual({
        github: false,
        passwordLogin: true,
      });

      (env as unknown as { GITHUB_CLIENT_ID: string }).GITHUB_CLIENT_ID = 'test_github_client_id_123';
      (env as unknown as { GITHUB_CLIENT_SECRET: string }).GITHUB_CLIENT_SECRET = 'test_github_client_secret_456';

      const configuredRes = await request(app).get('/api/auth/providers');
      expect(configuredRes.status).toBe(200);
      expect(configuredRes.body).toEqual({
        github: true,
        passwordLogin: true,
      });
      // Strict leak prevention
      expect(configuredRes.body.GITHUB_CLIENT_ID).toBeUndefined();
      expect(configuredRes.body.GITHUB_CLIENT_SECRET).toBeUndefined();
      expect(configuredRes.body.clientId).toBeUndefined();
      expect(configuredRes.body.clientSecret).toBeUndefined();
    } finally {
      (env as unknown as { GITHUB_CLIENT_ID: string }).GITHUB_CLIENT_ID = origId;
      (env as unknown as { GITHUB_CLIENT_SECRET: string }).GITHUB_CLIENT_SECRET = origSecret;
    }
  });

  // 2. Start endpoint
  it('2. GET /api/auth/github/start sets cc_oauth_state cookie on path /api/auth and 302 redirects to GitHub', async () => {
    const res = await request(app)
      .get('/api/auth/github/start')
      .query({ origin: 'http://localhost:3000' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://github.com/login/oauth/authorize');
    expect(res.headers.location).toContain('client_id=');
    expect(res.headers.location).toContain('state=');

    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
    const stateCookie = cookies.find((c) => c.startsWith('cc_oauth_state='));
    expect(stateCookie).toBeDefined();
    expect(stateCookie).toContain('Path=/api/auth');
    expect(stateCookie).toContain('HttpOnly');
    expect(stateCookie).toContain('SameSite=Lax');
  });

  it('3. GET /api/auth/github/start rejects unallowed origins with 400 friendly HTML', async () => {
    const res = await request(app)
      .get('/api/auth/github/start')
      .query({ origin: 'https://attacker.evil.com' });

    expect(res.status).toBe(400);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Sign-in Failed');
    expect(res.text).toContain('Close window');
    expect(res.text).not.toContain('stack');
  });

  // 4. Callback handling: user denial
  it('4. GET /api/auth/github/callback handles ?error=access_denied gracefully with friendly HTML popup', async () => {
    const res = await request(app)
      .get('/api/auth/github/callback')
      .query({
        error: 'access_denied',
        error_description: 'The user has denied your application access.',
      });

    expect(res.status).toBe(400);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Sign-in Failed');
    expect(res.text).toContain('Close window');
    expect(res.text).toContain('GitHub sign-in was cancelled or access was denied');
    expect(res.text).not.toContain('stack');
    // Cookie cleared
    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
    expect(cookies.some((c) => c.includes('cc_oauth_state=;') || c.includes('Max-Age=0'))).toBe(true);
  });

  // 5. Successful OAuth flow creates user with role editor, never admin
  it('5. creates a new user with global role editor (never admin) and sets session', async () => {
    const authStart = await buildGitHubAuthorizeUrl('http://localhost:3000');

    const mockProvider: GitHubOAuthProvider = {
      async exchangeCodeForProfile() {
        return {
          githubId: 'gh_user_998877',
          username: 'brand_new_gh_dev',
          displayName: 'Brand New Developer',
          email: 'gh_dev_new@example.com',
          emailVerified: true,
          avatarUrl: 'https://avatars.githubusercontent.com/u/998877',
        };
      },
    };
    setGitHubOAuthProvider(mockProvider);

    const res = await request(app)
      .get('/api/auth/github/callback')
      .set('Cookie', [`cc_oauth_state=${authStart.nonce}`])
      .query({
        code: 'valid_mock_code_123',
        state: authStart.state,
      });

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Sign-in Complete');

    // Verify DB user role
    const createdUser = (
      await db.select().from(users).where(eq(users.githubId, 'gh_user_998877'))
    )[0];
    expect(createdUser).toBeDefined();
    expect(createdUser.globalRole).toBe('editor');
    expect(createdUser.username).toBe('brand_new_gh_dev');
    expect(createdUser.email).toBe('gh_dev_new@example.com');
  });

  // 6. Verified email collision prevents silent auto-linking
  it('6. rejects silent auto-linking when verified GitHub email matches existing local account', async () => {
    const authStart = await buildGitHubAuthorizeUrl('http://localhost:3000');

    // SEED_IDS user Elena has email elena@codecollab.dev
    const mockProvider: GitHubOAuthProvider = {
      async exchangeCodeForProfile() {
        return {
          githubId: 'gh_attacker_or_separate_123',
          username: 'elena_impersonator',
          displayName: 'Elena Impersonator',
          email: 'elena@codecollab.dev', // Matches existing local account
          emailVerified: true,
          avatarUrl: null,
        };
      },
    };
    setGitHubOAuthProvider(mockProvider);

    const res = await request(app)
      .get('/api/auth/github/callback')
      .set('Cookie', [`cc_oauth_state=${authStart.nonce}`])
      .query({
        code: 'valid_mock_code_collision',
        state: authStart.state,
      });

    expect(res.status).toBe(409);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Sign-in Failed');
    expect(res.text).toContain('An account with this email already exists');
    expect(res.text).toContain('Close window');
  });

  // 7. Hidden or unverified email creates user with noreply placeholder email
  it('7. creates user with noreply placeholder email when GitHub email is unverified or hidden', async () => {
    const authStart = await buildGitHubAuthorizeUrl('http://localhost:3000');

    const mockProvider: GitHubOAuthProvider = {
      async exchangeCodeForProfile() {
        return {
          githubId: 'gh_hidden_email_user_44',
          username: 'hidden_email_coder',
          displayName: 'Hidden Email Coder',
          email: 'some_unverified@example.com',
          emailVerified: false, // Unverified!
          avatarUrl: null,
        };
      },
    };
    setGitHubOAuthProvider(mockProvider);

    const res = await request(app)
      .get('/api/auth/github/callback')
      .set('Cookie', [`cc_oauth_state=${authStart.nonce}`])
      .query({
        code: 'valid_mock_code_hidden',
        state: authStart.state,
      });

    expect(res.status).toBe(200);
    const createdUser = (
      await db.select().from(users).where(eq(users.githubId, 'gh_hidden_email_user_44'))
    )[0];
    expect(createdUser).toBeDefined();
    expect(createdUser.email).toContain('@users.noreply.github.com');
  });

  // 8. Single-use replay protection
  it('8. rejects replayed OAuth state tokens with friendly popup HTML', async () => {
    const authStart = await buildGitHubAuthorizeUrl('http://localhost:3000');

    const mockProvider: GitHubOAuthProvider = {
      async exchangeCodeForProfile() {
        return {
          githubId: 'gh_replay_tester_55',
          username: 'replay_tester',
          displayName: 'Replay Tester',
          email: 'replay_tester@example.com',
          emailVerified: true,
          avatarUrl: null,
        };
      },
    };
    setGitHubOAuthProvider(mockProvider);

    // First use succeeds
    const res1 = await request(app)
      .get('/api/auth/github/callback')
      .set('Cookie', [`cc_oauth_state=${authStart.nonce}`])
      .query({
        code: 'code_first_use',
        state: authStart.state,
      });
    expect(res1.status).toBe(200);

    // Second use with identical state is rejected as replayed
    const res2 = await request(app)
      .get('/api/auth/github/callback')
      .set('Cookie', [`cc_oauth_state=${authStart.nonce}`])
      .query({
        code: 'code_second_use',
        state: authStart.state,
      });
    expect(res2.status).toBe(400);
    expect(res2.type).toBe('text/html');
    expect(res2.text).toContain('Sign-in Failed');
    expect(res2.text).toContain('already been used or expired');
  });

  // 9. Initial password setting on OAuth-only account requires recent auth (<= 300s)
  it('9. enforces 5-minute recent auth requirement when OAuth-only account sets local password', async () => {
    // Create an oauth-only user without password
    const userRes = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        uid: `test-oauth-${Date.now()}`,
        email: `oauth_pwd_test_${Date.now()}@example.com`,
        username: `oauth_pwd_${Date.now()}`,
        displayName: 'OAuth Password Tester',
        githubId: `gh_pwd_test_${Date.now()}`,
        globalRole: 'editor',
        passwordHash: null,
      })
      .returning();
    const oauthUser = userRes[0];
    expect(oauthUser).toBeDefined();
    expect(oauthUser.passwordHash).toBeNull();

    // 1. Token with authTime > 300s ago -> rejected with 401 REAUTH_REQUIRED
    const staleAuthTime = Math.floor(Date.now() / 1000) - 350;
    const staleToken = signAccessToken({
      id: oauthUser.id,
      email: oauthUser.email,
      username: oauthUser.username,
      globalRole: oauthUser.globalRole as 'editor' | 'admin' | 'viewer',
      authTime: staleAuthTime,
    });

    const staleRes = await request(app)
      .post('/api/users/me/password')
      .set('Authorization', `Bearer ${staleToken}`)
      .send({ newPassword: 'FreshPassword123!' });

    expect(staleRes.status).toBe(401);
    expect(staleRes.body.error.code).toBe('REAUTH_REQUIRED');

    // 2. Token with recent authTime (< 300s) -> succeeds
    const recentAuthTime = Math.floor(Date.now() / 1000) - 30;
    const freshToken = signAccessToken({
      id: oauthUser.id,
      email: oauthUser.email,
      username: oauthUser.username,
      globalRole: oauthUser.globalRole as 'editor' | 'admin' | 'viewer',
      authTime: recentAuthTime,
    });

    const freshRes = await request(app)
      .post('/api/users/me/password')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ newPassword: 'FreshPassword123!' });

    expect(freshRes.status).toBe(200);
    expect(freshRes.body.status).toBe('password_updated');

    // Verify DB has passwordHash now
    const updatedUser = (
      await db.select().from(users).where(eq(users.id, oauthUser.id))
    )[0];
    expect(updatedUser.passwordHash).not.toBeNull();
  });
});
