import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { runSeed, SEED_IDS } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import {
  authorize,
  evaluateAuthorization,
  resolveEffectiveSnippetRole,
} from '../auth/authorize.ts';
import {
  resetGitHubOAuthProvider,
  setGitHubOAuthProvider,
} from '../auth/github-oauth.ts';
import { env } from '../config/env.ts';

describe('Phase 2 — Auth, Refresh Rotation & Reuse Detection, GitHub OAuth Popup & Central Authorization', () => {
  const app = createApp();
  const uniqueSuffix = crypto.randomBytes(4).toString('hex');
  const testEmail = `phase2_${uniqueSuffix}@codecollab.dev`;
  const testUsername = `phase2_user_${uniqueSuffix}`;
  let testUserId = '';

  beforeAll(async () => {
    await runSeed();
  });

  afterEach(() => {
    resetGitHubOAuthProvider();
  });

  it('registers a new user, sanitizes XSS in displayName, and blocks mass-assignment of globalRole', async () => {
    // 1. Rejects unknown fields like globalRole due to .strict()
    const massAssignAttempt = await request(app).post('/api/auth/register').send({
      email: testEmail,
      username: testUsername,
      displayName: 'Test Hacker',
      password: 'StrongPassword123!',
      globalRole: 'admin',
    });
    expect(massAssignAttempt.status).toBe(400);
    expect(massAssignAttempt.body.error.code).toBe('VALIDATION_ERROR');

    // 2. Valid registration with XSS script in displayName
    const res = await request(app).post('/api/auth/register').send({
      email: testEmail,
      username: testUsername,
      displayName: '<script>alert("xss")</script>Ada Lovelace',
      password: 'StrongPassword123!',
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.username).toBe(testUsername);
    expect(res.body.user.displayName).toBe('Ada Lovelace');
    expect(res.body.user.globalRole).toBe('editor');
    testUserId = res.body.user.id;

    // 3. Rejects duplicate email or username with 409
    const dupRes = await request(app).post('/api/auth/register').send({
      email: testEmail,
      username: `other_${uniqueSuffix}`,
      displayName: 'Duplicate Email',
      password: 'StrongPassword123!',
    });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('logs in, fetches /api/auth/me with Bearer token, rotates refresh token, and revokes entire family on reuse', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      identifier: testUsername,
      password: 'StrongPassword123!',
    });
    expect(loginRes.status).toBe(200);
    const token1Access = loginRes.body.accessToken as string;
    const token1Refresh = loginRes.body.refreshToken as string;

    // Verify /api/auth/me works with Bearer token
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token1Access}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.id).toBe(testUserId);

    // Rotate token1Refresh -> produces token2Refresh
    const refresh1 = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: token1Refresh });
    expect(refresh1.status).toBe(200);
    const token2Refresh = refresh1.body.refreshToken as string;
    expect(token2Refresh).not.toBe(token1Refresh);

    // REUSE DETECTION: Replay already-rotated token1Refresh -> must return 401 REFRESH_TOKEN_REUSED
    const reuseAttempt = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: token1Refresh });
    expect(reuseAttempt.status).toBe(401);
    expect(reuseAttempt.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // Now verify that token2Refresh (from the same family) was ALSO revoked by reuse detection!
    const familyRevokedCheck = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: token2Refresh });
    expect(familyRevokedCheck.status).toBe(401);
    expect(familyRevokedCheck.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('supports cookie transport mode (httpOnly cookies) when AUTH_TRANSPORT=cookie', async () => {
    const prevTransport = env.AUTH_TRANSPORT;
    try {
      (env as { AUTH_TRANSPORT: string }).AUTH_TRANSPORT = 'cookie';
      const loginCookieRes = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: 'elena@codecollab.dev',
          password: 'EditorPass123!',
        });

      expect(loginCookieRes.status).toBe(200);
      expect(loginCookieRes.body.transport).toBe('cookie');
      const setCookieHeaders = loginCookieRes.headers['set-cookie'];
      expect(setCookieHeaders).toBeDefined();
      const cookieArr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
      expect(cookieArr.some((c: string) => c.includes('cc_refresh_token=') && c.includes('HttpOnly'))).toBe(true);
      expect(cookieArr.some((c: string) => c.includes('cc_access_token=') && c.includes('HttpOnly'))).toBe(true);
    } finally {
      (env as { AUTH_TRANSPORT: string }).AUTH_TRANSPORT = prevTransport;
    }
  });

  it('updates profile, changes password (revoking active refresh sessions), and enforces admin-only role management', async () => {
    // Login as testUser (editor)
    const editorLogin = await request(app).post('/api/auth/login').send({
      identifier: testEmail,
      password: 'StrongPassword123!',
    });
    const editorToken = editorLogin.body.accessToken as string;
    const editorRefresh = editorLogin.body.refreshToken as string;

    // Update profile
    const patchProfile = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ displayName: 'Ada Byron King' });
    expect(patchProfile.status).toBe(200);
    expect(patchProfile.body.user.displayName).toBe('Ada Byron King');

    // Editor cannot change roles (403 FORBIDDEN)
    const forbiddenRoleChange = await request(app)
      .patch(`/api/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ globalRole: 'admin' });
    expect(forbiddenRoleChange.status).toBe(403);
    expect(forbiddenRoleChange.body.error.code).toBe('FORBIDDEN');

    // Login as seeded admin
    const adminLogin = await request(app).post('/api/auth/login').send({
      identifier: 'admin@codecollab.dev',
      password: 'AdminPass123!',
    });
    const adminToken = adminLogin.body.accessToken as string;

    // Admin can promote/demote testUser
    const roleChangeRes = await request(app)
      .patch(`/api/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ globalRole: 'viewer' });
    expect(roleChangeRes.status).toBe(200);
    expect(roleChangeRes.body.user.globalRole).toBe('viewer');

    // Restore back to editor
    await request(app)
      .patch(`/api/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ globalRole: 'editor' });

    // Cursor pagination on GET /api/users
    const listPage1 = await request(app)
      .get('/api/users?limit=2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listPage1.status).toBe(200);
    expect(listPage1.body.items.length).toBe(2);
    expect(listPage1.body.hasMore).toBe(true);
    expect(listPage1.body.nextCursor).toBeTruthy();

    const listPage2 = await request(app)
      .get(`/api/users?limit=2&cursor=${encodeURIComponent(listPage1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listPage2.status).toBe(200);
    expect(listPage2.body.items.length).toBeGreaterThanOrEqual(2);
    expect(listPage2.body.items[0].id).not.toBe(listPage1.body.items[0].id);

    // Change password revokes active refresh tokens
    const pwRes = await request(app)
      .post('/api/users/me/password')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        currentPassword: 'StrongPassword123!',
        newPassword: 'UpdatedPassword456!',
      });
    expect(pwRes.status).toBe(200);

    // Old refresh token is now revoked
    const refreshAfterPwChange = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: editorRefresh });
    expect(refreshAfterPwChange.status).toBe(401);

    // Clean up test user
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('completes GitHub OAuth popup flow with signed CSRF state, enforces exact origin allowlist, and links by email only when verified', async () => {
    // Disallowed wildcard-like origins must be rejected
    const disallowedOriginRes = await request(app).get(
      '/api/auth/github/url?origin=https://spoofed.run.app'
    );
    expect(disallowedOriginRes.status).toBe(400);
    expect(disallowedOriginRes.body.error.code).toBe('OAUTH_ORIGIN_NOT_ALLOWED');

    const agent = request.agent(app);

    const urlRes = await agent
      .get('/api/auth/github/url?origin=http://localhost:3000');
    expect(urlRes.status).toBe(200);
    expect(urlRes.body.url).toContain('https://github.com/login/oauth/authorize');
    expect(urlRes.body.state).toBeDefined();

    // Tampered state must be rejected with 400 OAUTH_INVALID_STATE
    const badStateRes = await agent
      .get('/api/auth/github/callback?code=mock_code&state=tampered.signature');
    expect(badStateRes.status).toBe(400);
    expect(badStateRes.text).toContain('OAUTH_INVALID_STATE');

    // Unverified GitHub email matching an existing user's email must NOT link (403 GITHUB_EMAIL_UNVERIFIED)
    const ghId = `gh_${uniqueSuffix}`;
    setGitHubOAuthProvider({
      async exchangeCodeForProfile(_code: string) {
        return {
          githubId: ghId,
          username: `spoof_${uniqueSuffix}`,
          displayName: 'Unverified Spoofer',
          email: 'elena@codecollab.dev',
          emailVerified: false,
          avatarUrl: null,
        };
      },
    });

    const unverifiedCallbackRes = await agent.get(
      `/api/auth/github/callback?code=unverified_gh_code&state=${encodeURIComponent(urlRes.body.state)}`
    );
    expect(unverifiedCallbackRes.text).toContain('GITHUB_EMAIL_UNVERIFIED');

    // Valid state with verified GitHub email succeeds
    // Since OAuth state is single-use, generate a fresh state with the agent
    const freshUrlRes = await agent
      .get('/api/auth/github/url?origin=http://localhost:3000');
    expect(freshUrlRes.status).toBe(200);

    setGitHubOAuthProvider({
      async exchangeCodeForProfile(_code: string) {
        return {
          githubId: ghId,
          username: `octocat_${uniqueSuffix}`,
          displayName: 'Mona Octocat',
          email: `octocat_${uniqueSuffix}@github.com`,
          emailVerified: true,
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        };
      },
    });

    const callbackRes = await agent
      .get(`/api/auth/github/callback?code=valid_gh_code&state=${encodeURIComponent(freshUrlRes.body.state)}`);
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.text).toContain('OAUTH_AUTH_SUCCESS');
    expect(callbackRes.text).toContain('/api/auth/oauth-popup.js');
    const popupScriptRes = await agent.get('/api/auth/oauth-popup.js');
    expect(popupScriptRes.status).toBe(200);
    expect(popupScriptRes.text).toContain('window.opener.postMessage');

    // Clean up created GitHub user
    await db.delete(users).where(eq(users.githubId, ghId));
  });

  it('enforces the central authorization module matrix across global roles, collaborator roles, and visibilities', () => {
    const adminActor = { id: 'u-admin', email: 'a@x.dev', username: 'admin', globalRole: 'admin' as const };
    const ownerEditor = { id: 'u-owner', email: 'o@x.dev', username: 'owner', globalRole: 'editor' as const };
    const collabEditor = { id: 'u-collab-ed', email: 'ce@x.dev', username: 'ce', globalRole: 'editor' as const };
    const collabViewer = { id: 'u-collab-vw', email: 'cv@x.dev', username: 'cv', globalRole: 'editor' as const };
    const globalViewer = { id: 'u-gviewer', email: 'gv@x.dev', username: 'gv', globalRole: 'viewer' as const };
    const strangerEditor = { id: 'u-stranger', email: 's@x.dev', username: 'stranger', globalRole: 'editor' as const };

    const privateSnippet = {
      id: 's-priv',
      ownerId: ownerEditor.id,
      visibility: 'private' as const,
    };

    const publicSnippet = {
      id: 's-pub',
      ownerId: ownerEditor.id,
      visibility: 'public' as const,
    };

    // 1. Global viewer cannot create snippets
    expect(evaluateAuthorization(globalViewer, 'snippet:create').allowed).toBe(false);
    expect(evaluateAuthorization(ownerEditor, 'snippet:create').allowed).toBe(true);

    // 2. Private snippet visibility rules
    expect(evaluateAuthorization(null, 'snippet:read', { snippet: privateSnippet }).allowed).toBe(false);
    expect(evaluateAuthorization(strangerEditor, 'snippet:read', { snippet: privateSnippet }).allowed).toBe(false);
    expect(
      evaluateAuthorization(collabViewer, 'snippet:read', {
        snippet: { ...privateSnippet, collaboratorRole: 'viewer' },
      }).allowed
    ).toBe(true);
    expect(evaluateAuthorization(adminActor, 'snippet:read', { snippet: privateSnippet }).allowed).toBe(true);

    // 3. Edit permissions: owner, collaborator:editor, and admin can edit; collaborator:viewer and global:viewer cannot
    expect(evaluateAuthorization(ownerEditor, 'snippet:edit', { snippet: privateSnippet }).allowed).toBe(true);
    expect(
      evaluateAuthorization(collabEditor, 'snippet:edit', {
        snippet: { ...privateSnippet, collaboratorRole: 'editor' },
      }).allowed
    ).toBe(true);
    expect(
      evaluateAuthorization(collabViewer, 'snippet:edit', {
        snippet: { ...privateSnippet, collaboratorRole: 'viewer' },
      }).allowed
    ).toBe(false);
    // Even if granted collaboratorRole='editor', a global 'viewer' is capped at read/comment-only
    expect(
      resolveEffectiveSnippetRole(globalViewer, { ...publicSnippet, collaboratorRole: 'editor' })
    ).toBe('viewer');
    expect(
      evaluateAuthorization(globalViewer, 'snippet:edit', {
        snippet: { ...publicSnippet, collaboratorRole: 'editor' },
      }).allowed
    ).toBe(false);

    // 4. Collaborator management & snippet deletion: owner and admin only, NOT collaborator:editor
    expect(
      evaluateAuthorization(collabEditor, 'snippet:delete', {
        snippet: { ...privateSnippet, collaboratorRole: 'editor' },
      }).allowed
    ).toBe(false);
    expect(evaluateAuthorization(ownerEditor, 'snippet:delete', { snippet: privateSnippet }).allowed).toBe(true);

    // 5. authorize() throws 401 for unauthenticated and 403 for forbidden
    expect(() => authorize(null, 'snippet:create')).toThrowError(/Authentication required/);
    expect(() => authorize(globalViewer, 'snippet:create')).toThrowError(/global viewer role/);
  });
});
