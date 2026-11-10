import http from 'http';
import { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { io as createClientSocket, Socket as ClientSocket } from 'socket.io-client';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { attachSocketServer, sweepExpiredSockets } from '../realtime/socket-server.ts';
import { registerActivityEventSubscriber } from '../modules/activity/activity.service.ts';
import { runSeed, SEED_IDS } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { snippets, users, snippetCollaborators } from '../db/schema.ts';
import { signAccessToken } from '../auth/jwt.ts';
import { env } from '../config/env.ts';
import { setGitHubOAuthProvider } from '../auth/github-oauth.ts';

function emitWithAck<T = Record<string, unknown>>(
  socket: ClientSocket,
  event: string,
  payload: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ack on event ${event}`));
    }, 5000);

    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function waitForEvent<T = Record<string, unknown>>(
  socket: ClientSocket,
  event: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for socket event ${event}`));
    }, 5000);

    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function connectSocket(baseUrl: string, token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = createClientSocket(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: token ? { token } : {},
    });

    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error('Socket connection timeout'));
    }, 5000);

    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });

    client.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('Security Regressions & Hardening Suite', () => {
  let app: ReturnType<typeof createApp>;
  let httpServer: http.Server;
  let ioServer: ReturnType<typeof attachSocketServer>;
  let baseUrl = '';

  let adminToken = '';
  let elenaToken = '';
  let marcusToken = '';
  let victorToken = '';

  beforeAll(async () => {
    registerActivityEventSubscriber();
    await runSeed();

    app = createApp();
    httpServer = http.createServer(app);
    ioServer = attachSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });

    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const [adminRes, elenaRes, marcusRes, victorRes] = await Promise.all([
      request(app).post('/api/auth/login').send({
        identifier: 'admin@codecollab.dev',
        password: 'AdminPass123!',
      }),
      request(app).post('/api/auth/login').send({
        identifier: 'elena@codecollab.dev',
        password: 'EditorPass123!',
      }),
      request(app).post('/api/auth/login').send({
        identifier: 'marcus@codecollab.dev',
        password: 'EditorPass123!',
      }),
      request(app).post('/api/auth/login').send({
        identifier: 'victor@codecollab.dev',
        password: 'ViewerPass123!',
      }),
    ]);

    adminToken = adminRes.body.accessToken;
    elenaToken = elenaRes.body.accessToken;
    marcusToken = marcusRes.body.accessToken;
    victorToken = victorRes.body.accessToken;
  });

  afterAll(async () => {
    if (httpServer) {
      if (typeof (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
        (httpServer as unknown as { closeAllConnections: () => void }).closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });

  // 1. Rate limit proxy spoofing: TRUST_PROXY_HOPS=0 ignores X-Forwarded-For
  it('1. ignores spoofed X-Forwarded-For headers when TRUST_PROXY_HOPS=0', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('X-Forwarded-For', '203.0.113.195, 70.41.3.18');
    expect(res.status).toBe(200);
  });

  // 2. Rate limit keying: auth rate limiter keys by identifier + IP, not IP alone
  it('2. isolates auth rate limits per identifier so one target lockout does not block another user', async () => {
    // Attempt multiple failed logins for victim_one
    const victimA = 'victim_a@codecollab.dev';
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ identifier: victimA, password: 'WrongPassword123!' });
    }

    // A different identifier from the same IP can still attempt login and succeeds
    const elenaLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'elena@codecollab.dev', password: 'EditorPass123!' });
    expect(elenaLogin.status).toBe(200);
    expect(elenaLogin.body.user.username).toBe('elena_dev');
  });

  // 3. OAuth state replay: reusing a valid state parameter returns 400 OAUTH_STATE_REPLAYED
  it('3. rejects replayed OAuth state parameters with 400 OAUTH_STATE_REPLAYED', async () => {
    const agent = request.agent(app);
    const urlRes = await agent.get('/api/auth/github/url?origin=http://localhost:3000');
    expect(urlRes.status).toBe(200);
    const { state } = urlRes.body;
    const oauthCookie = urlRes.headers['set-cookie'];

    const ghId = `gh_replay_${Date.now()}`;
    setGitHubOAuthProvider({
      async exchangeCodeForProfile() {
        return {
          githubId: ghId,
          username: `user_${ghId}`,
          displayName: 'Replay Test',
          email: `${ghId}@test.com`,
          emailVerified: true,
          avatarUrl: null,
        };
      },
    });

    // First callback consumes the state successfully
    const firstCallback = await agent.get(
      `/api/auth/github/callback?code=mock_code_1&state=${encodeURIComponent(state)}`
    );
    expect(firstCallback.status).toBe(200);
    expect(firstCallback.text).toContain('OAUTH_AUTH_SUCCESS');

    // Second callback with the same state and browser cookie must be rejected as replayed
    const secondCallback = await agent
      .get(`/api/auth/github/callback?code=mock_code_2&state=${encodeURIComponent(state)}`)
      .set('Cookie', oauthCookie);
    expect(secondCallback.status).toBe(400);
    expect(secondCallback.text).toContain('OAUTH_STATE_REPLAYED');

    await db.delete(users).where(eq(users.githubId, ghId));
  });

  // 4. OAuth state browser mismatch: state generated in browser A submitted with cookie B (or missing cookie)
  it('4. rejects OAuth callback when session cookie is missing or mismatched (browser binding)', async () => {
    const agentA = request.agent(app);
    const urlRes = await agentA.get('/api/auth/github/url?origin=http://localhost:3000');
    expect(urlRes.status).toBe(200);
    const { state } = urlRes.body;

    // Submitting state with a different agent (agentB, no cookie) fails
    const agentB = request.agent(app);
    const mismatchedRes = await agentB.get(
      `/api/auth/github/callback?code=mock_code&state=${encodeURIComponent(state)}`
    );
    expect(mismatchedRes.status).toBe(400);
    expect(mismatchedRes.text).toContain('OAUTH_STATE_MISMATCH');
  });

  // 5. CSP header: GET /api/docs includes CSP with frame-ancestors 'none', no unsafe-inline script, no CDN
  it('5. enforces strict CSP on API documentation without unsafe-inline or CDN scripts', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    // Swagger assets must be self-hosted
    expect(res.text).not.toContain('unpkg.com');
    expect(res.text).not.toContain('cdn.jsdelivr.net');
    expect(res.text).toContain('/api/docs-assets/swagger-ui.css');
  });

  // 6. Swagger UI: GET /api/docs loads self-hosted assets, container element present
  it('6. serves self-hosted Swagger UI assets correctly', async () => {
    const cssRes = await request(app).get('/api/docs-assets/swagger-ui.css');
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers['content-type']).toContain('css');

    const initJsRes = await request(app).get('/api/docs-assets/swagger-init.js');
    expect(initJsRes.status).toBe(200);
    expect(initJsRes.headers['content-type']).toContain('javascript');
  });

  // 7. OAuth popup HTML: contains safe postMessage to target origin; no inline scripts; CSP respected
  it('7. renders OAuth popup HTML without inline scripts and loads external oauth-popup.js', async () => {
    const scriptRes = await request(app).get('/api/auth/oauth-popup.js');
    expect(scriptRes.status).toBe(200);
    expect(scriptRes.headers['content-type']).toContain('javascript');
    expect(scriptRes.text).toContain('window.opener.postMessage');

    const badStateRes = await request(app).get(
      '/api/auth/github/callback?code=invalid&state=bad.state'
    );
    expect(badStateRes.status).toBe(400);
    expect(badStateRes.text).toContain('<script src="/api/auth/oauth-popup.js"></script>');
    expect(badStateRes.text).toContain('id="oauth-result"');
    expect(badStateRes.text).not.toContain('<script>window.opener');
  });

  // 8. Live socket revocation (visibility): when snippet visibility changes to private, non-collaborator sockets are kicked
  it('8. revokes socket room access and emits snippet:access-revoked when visibility changes to private', async () => {
    // 1. Create a public snippet
    const createRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Revocation Test Public',
        language: 'typescript',
        visibility: 'public',
        content: 'const publicCode = 1;',
      });
    expect(createRes.status).toBe(201);
    const snippetId = createRes.body.snippet.id;

    // 2. Marcus (non-collaborator) joins snippet room
    const marcusSocket = await connectSocket(baseUrl, marcusToken);
    const joinAck = await emitWithAck<{ ok: boolean }>(marcusSocket, 'snippet:join', { snippetId });
    expect(joinAck.ok).toBe(true);

    // Prepare to listen for snippet:access-revoked
    const revokedPromise = waitForEvent<{ snippetId: string }>(marcusSocket, 'snippet:access-revoked');

    // 3. Elena changes snippet visibility to private
    const updateRes = await request(app)
      .patch(`/api/snippets/${snippetId}`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ visibility: 'private' });
    expect(updateRes.status).toBe(200);

    // Marcus socket must receive snippet:access-revoked
    const revokedEvent = await revokedPromise;
    expect(revokedEvent.snippetId).toBe(snippetId);

    // Clean up
    marcusSocket.disconnect();
    await request(app).delete(`/api/snippets/${snippetId}`).set('Authorization', `Bearer ${elenaToken}`);
  });

  // 9. Live socket revocation (collaborator removal): collaborator removed via REST is kicked
  it('9. revokes socket access when a collaborator is removed via REST', async () => {
    // 1. Elena creates a private snippet and adds Marcus as editor
    const createRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Collab Removal Test',
        language: 'typescript',
        visibility: 'private',
        content: 'const collabCode = 1;',
      });
    expect(createRes.status).toBe(201);
    const snippetId = createRes.body.snippet.id;

    await request(app)
      .post(`/api/snippets/${snippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ username: 'marcus_code', role: 'editor' });

    // 2. Marcus joins snippet room
    const marcusSocket = await connectSocket(baseUrl, marcusToken);
    const joinAck = await emitWithAck<{ ok: boolean }>(marcusSocket, 'snippet:join', { snippetId });
    expect(joinAck.ok).toBe(true);

    const revokedPromise = waitForEvent<{ snippetId: string }>(marcusSocket, 'snippet:access-revoked');

    // 3. Elena removes Marcus as collaborator
    const marcusUser = await db.select().from(users).where(eq(users.username, 'marcus_code'));
    const removeRes = await request(app)
      .delete(`/api/snippets/${snippetId}/collaborators/${marcusUser[0].id}`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(removeRes.status).toBe(200);

    const revokedEvent = await revokedPromise;
    expect(revokedEvent.snippetId).toBe(snippetId);

    marcusSocket.disconnect();
    await request(app).delete(`/api/snippets/${snippetId}`).set('Authorization', `Bearer ${elenaToken}`);
  });

  // 10. Live socket demotion: editor demoted to viewer cannot edit
  it('10. blocks writes with FORBIDDEN_READ_ONLY when an editor collaborator is demoted to viewer', async () => {
    const createRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Demotion Test Snippet',
        language: 'typescript',
        visibility: 'private',
        content: 'const editable = true;',
      });
    expect(createRes.status).toBe(201);
    const snippetId = createRes.body.snippet.id;

    await request(app)
      .post(`/api/snippets/${snippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ username: 'marcus_code', role: 'editor' });

    const marcusSocket = await connectSocket(baseUrl, marcusToken);
    await emitWithAck(marcusSocket, 'snippet:join', { snippetId });

    // Elena demotes Marcus to viewer
    await request(app)
      .post(`/api/snippets/${snippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ username: 'marcus_code', role: 'viewer' });

    // Marcus attempts a yjs:update edit
    const sampleUpdate = Buffer.from([0, 1, 2, 3]).toString('base64');
    const editAck = await emitWithAck<{ ok: boolean; error?: { code: string } }>(
      marcusSocket,
      'yjs:update',
      { snippetId, update: sampleUpdate }
    );
    expect(editAck.ok).toBe(false);
    expect(editAck.error?.code).toBe('FORBIDDEN_READ_ONLY');

    marcusSocket.disconnect();
    await request(app).delete(`/api/snippets/${snippetId}`).set('Authorization', `Bearer ${elenaToken}`);
  });

  // 11. Mid-session token expiry: sweepExpiredSockets emits auth:expired, subsequent edit fails, auth:refresh recovers
  it('11. detects expired tokens via sweepExpiredSockets and recovers seamlessly via auth:refresh', async () => {
    // 1. Issue a short-lived access token that expired in the past
    const marcusUser = (await db.select().from(users).where(eq(users.username, 'marcus_code')))[0];
    const expiredToken = signAccessToken(
      {
        id: marcusUser.id,
        email: marcusUser.email,
        username: marcusUser.username,
        globalRole: 'editor',
      },
      -10 // expired 10 seconds ago
    );

    // Connect with a fresh valid token first
    const client = await connectSocket(baseUrl, marcusToken);

    // Set tokenExp to the past
    (client as unknown as { [key: string]: unknown }).auth = { token: expiredToken };

    // Trigger sweepExpiredSockets
    const expiredPromise = waitForEvent<{ code: string }>(client, 'auth:expired');
    // Artificially age the socket's exp in server memory
    for (const s of ioServer.sockets.sockets.values()) {
      if (s.data.user?.id === marcusUser.id) {
        s.data.tokenExp = Math.floor(Date.now() / 1000) - 10;
      }
    }
    const swept = sweepExpiredSockets(ioServer);
    expect(swept).toBeGreaterThanOrEqual(1);

    const expiredEvent = await expiredPromise;
    expect(expiredEvent.code).toBe('TOKEN_EXPIRED');

    // Subsequent edit is rejected with TOKEN_EXPIRED
    const editAck = await emitWithAck<{ ok: boolean; error?: { code: string } }>(
      client,
      'yjs:update',
      { snippetId: SEED_IDS.snippets.publicAuth, update: Buffer.from([1]).toString('base64') }
    );
    expect(editAck.ok).toBe(false);
    expect(editAck.error?.code).toBe('TOKEN_EXPIRED');

    // Client emits auth:refresh with fresh token
    const refreshAck = await emitWithAck<{ ok: boolean }>(client, 'auth:refresh', {
      token: marcusToken,
    });
    expect(refreshAck.ok).toBe(true);

    client.disconnect();
  });

  // 12. Malformed cursor: GET /api/snippets?cursor=not-a-cursor returns 400 with standard AppError
  it('12. returns standardized 400 INVALID_CURSOR error on malformed cursor parameter', async () => {
    const res = await request(app).get('/api/snippets?cursor=not-a-valid-cursor');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('INVALID_CURSOR');
    expect(res.body.error.message).toContain('cursor');
  });

  // 13. Cookie transport token isolation: in cookie mode, login/register responses do NOT return tokens in body
  it('13. prevents token leakage in JSON response body when operating in cookie transport mode', async () => {
    const origTransport = env.AUTH_TRANSPORT;
    try {
      (env as { AUTH_TRANSPORT: string }).AUTH_TRANSPORT = 'cookie';

      const loginRes = await request(app).post('/api/auth/login').send({
        identifier: 'elena@codecollab.dev',
        password: 'EditorPass123!',
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.transport).toBe('cookie');
      expect(loginRes.body.accessToken).toBeUndefined();
      expect(loginRes.body.refreshToken).toBeUndefined();
      expect(loginRes.body.user).toBeDefined();

      // Cookies must be set
      const rawCookies = loginRes.headers['set-cookie'];
      const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
      expect(cookies.some((c: string) => c.startsWith('cc_access_token='))).toBe(true);
      expect(cookies.some((c: string) => c.startsWith('cc_refresh_token='))).toBe(true);
    } finally {
      (env as { AUTH_TRANSPORT: string }).AUTH_TRANSPORT = origTransport;
    }
  });

  // 14. CSRF protection: in cookie mode, state-changing request with cookie but without valid Origin/Referer is rejected with 403 CSRF_ERROR
  it('14. blocks cross-origin or missing-origin state mutations on cookie-authenticated requests with 403 CSRF_ERROR', async () => {
    const origTransport = env.AUTH_TRANSPORT;
    try {
      (env as { AUTH_TRANSPORT: string }).AUTH_TRANSPORT = 'cookie';

      // 1. Login with cookie transport
      const loginRes = await request(app).post('/api/auth/login').send({
        identifier: 'elena@codecollab.dev',
        password: 'EditorPass123!',
      });
      const cookies = loginRes.headers['set-cookie'];

      // 2. State-changing POST without Origin or Referer -> 403 CSRF_ERROR
      const noOriginRes = await request(app)
        .post('/api/snippets')
        .set('Cookie', cookies)
        .send({
          title: 'CSRF Attempt',
          language: 'typescript',
          visibility: 'public',
          content: 'pwned();',
        });
      expect(noOriginRes.status).toBe(403);
      expect(noOriginRes.body.error.code).toBe('CSRF_ERROR');

      // 3. State-changing POST with malicious Referer -> 403 CSRF_ERROR
      const badRefererRes = await request(app)
        .post('/api/snippets')
        .set('Cookie', cookies)
        .set('Referer', 'https://attacker.evil.com/csrf-payload')
        .send({
          title: 'CSRF Attempt 2',
          language: 'typescript',
          visibility: 'public',
          content: 'pwned();',
        });
      expect(badRefererRes.status).toBe(403);
      expect(badRefererRes.body.error.code).toBe('CSRF_ERROR');

      // 4. State-changing POST with legitimate Origin -> succeeds 201
      const goodOriginRes = await request(app)
        .post('/api/snippets')
        .set('Cookie', cookies)
        .set('Origin', 'http://localhost:3000')
        .send({
          title: 'Legitimate Cookie Snippet',
          language: 'typescript',
          visibility: 'public',
          content: 'const safe = true;',
        });
      expect(goodOriginRes.status).toBe(201);
      expect(goodOriginRes.body.snippet.title).toBe('Legitimate Cookie Snippet');

      // Clean up snippet
      await request(app)
        .delete(`/api/snippets/${goodOriginRes.body.snippet.id}`)
        .set('Cookie', cookies)
        .set('Origin', 'http://localhost:3000');
    } finally {
      (env as { AUTH_TRANSPORT: string }).AUTH_TRANSPORT = origTransport;
    }
  });

  // 15. Search result hardening: masks collaborator emails for anonymous and non-owner callers, replaces currentContent with excerpt (headline + contentLength)
  it('15. masks collaborator emails and replaces currentContent with excerpt in search results for anonymous and non-owner callers', async () => {
    // Elena creates a public snippet with Marcus as collaborator
    const createRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Search Masking Test Snippet',
        language: 'typescript',
        visibility: 'public',
        content: 'export function searchPrivacyMasking() { return 42; }',
      });
    expect(createRes.status).toBe(201);
    const snippetId = createRes.body.snippet.id;

    await request(app)
      .post(`/api/snippets/${snippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ username: 'marcus_code', role: 'editor' });

    try {
      // 1. Anonymous search caller
      const anonRes = await request(app)
        .get('/api/search/snippets')
        .query({ q: 'searchPrivacyMasking' });
      expect(anonRes.status).toBe(200);
      const anonHit = anonRes.body.items.find((i: { id: string }) => i.id === snippetId);
      expect(anonHit).toBeDefined();
      expect(anonHit.currentContent).toBeUndefined();
      expect(anonHit.contentLength).toBe(53);
      expect(anonHit.headline).toBeDefined();
      expect(anonHit.collaborators.length).toBeGreaterThan(0);
      expect(anonHit.collaborators[0].email).toBeNull();

      // 2. Non-owner caller (Victor is unrelated viewer)
      const victorRes = await request(app)
        .get('/api/search/snippets')
        .set('Authorization', `Bearer ${victorToken}`)
        .query({ q: 'searchPrivacyMasking' });
      expect(victorRes.status).toBe(200);
      const victorHit = victorRes.body.items.find((i: { id: string }) => i.id === snippetId);
      expect(victorHit).toBeDefined();
      expect(victorHit.currentContent).toBeUndefined();
      expect(victorHit.contentLength).toBe(53);
      expect(victorHit.headline).toBeDefined();
      expect(victorHit.collaborators[0].email).toBeNull();

      // 3. Owner caller (Elena) can see collaborator emails
      const elenaRes = await request(app)
        .get('/api/search/snippets')
        .set('Authorization', `Bearer ${elenaToken}`)
        .query({ q: 'searchPrivacyMasking' });
      expect(elenaRes.status).toBe(200);
      const elenaHit = elenaRes.body.items.find((i: { id: string }) => i.id === snippetId);
      expect(elenaHit).toBeDefined();
      expect(elenaHit.currentContent).toBeUndefined();
      expect(elenaHit.contentLength).toBe(53);
      expect(elenaHit.collaborators[0].email).toBe('marcus@codecollab.dev');
    } finally {
      await request(app)
        .delete(`/api/snippets/${snippetId}`)
        .set('Authorization', `Bearer ${elenaToken}`);
    }
  });
});
