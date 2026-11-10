import http from 'http';
import { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { io as createClientSocket, Socket as ClientSocket } from 'socket.io-client';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { attachSocketServer } from '../realtime/socket-server.ts';
import { runSeed, SEED_IDS } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { snippets } from '../db/schema.ts';

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

    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });

    client.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
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

describe('Phase 7: Activity Feed over Internal EventBus, Persistence, Privacy Filtering & Socket Push', () => {
  const app = createApp();
  let httpServer: http.Server;
  let baseUrl = '';

  let elenaToken = '';
  let marcusToken = '';
  let victorToken = '';
  let publicSnippetId = '';
  let privateSnippetId = '';

  beforeAll(async () => {
    await runSeed();

    httpServer = http.createServer(app);
    attachSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    const [elenaRes, marcusRes, victorRes] = await Promise.all([
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'elena@codecollab.dev', password: 'EditorPass123!' }),
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'marcus@codecollab.dev', password: 'EditorPass123!' }),
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'victor@codecollab.dev', password: 'ViewerPass123!' }),
    ]);

    elenaToken = elenaRes.body.accessToken;
    marcusToken = marcusRes.body.accessToken;
    victorToken = victorRes.body.accessToken;
  });

  afterAll(async () => {
    if (publicSnippetId) {
      await db.delete(snippets).where(eq(snippets.id, publicSnippetId));
    }
    if (privateSnippetId) {
      await db.delete(snippets).where(eq(snippets.id, privateSnippetId));
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('1. records public domain events via domainEventBus, pushes live activity:new over Socket.io, and serves global public feed', async () => {
    const observerSocket = await connectSocket(baseUrl);

    try {
      const liveActivityPromise = waitForEvent<{
        id: string;
        type: string;
        snippetId: string;
        visibility: string;
        actor: { username: string };
      }>(observerSocket, 'activity:new');

      const createPublicRes = await request(app)
        .post('/api/snippets')
        .set('Authorization', `Bearer ${elenaToken}`)
        .send({
          title: 'Public EventBus Stream Utility',
          description: 'Typed event stream helper',
          language: 'typescript',
          visibility: 'public',
          content: 'export const stream = () => true;\n',
          tags: ['events', 'stream'],
        });
      expect(createPublicRes.status).toBe(201);
      publicSnippetId = createPublicRes.body.snippet.id;

      // Verify live Socket.io push on feed:global
      const pushedActivity = await liveActivityPromise;
      expect(pushedActivity.type).toBe('snippet.created');
      expect(pushedActivity.snippetId).toBe(publicSnippetId);
      expect(pushedActivity.visibility).toBe('public');
      expect(pushedActivity.actor.username).toBe('elena_dev');

      // Query GET /api/activities/global
      const globalFeedRes = await request(app)
        .get('/api/activities/global')
        .query({ limit: 10 });
      expect(globalFeedRes.status).toBe(200);
      expect(
        globalFeedRes.body.items.every(
          (item: { visibility: string }) => item.visibility === 'public'
        )
      ).toBe(true);
      expect(
        globalFeedRes.body.items.some(
          (item: { snippetId: string; type: string }) =>
            item.snippetId === publicSnippetId && item.type === 'snippet.created'
        )
      ).toBe(true);
    } finally {
      observerSocket.disconnect();
    }
  });

  it('2. strictly excludes private snippet activities from global feed and unauthorized user feeds', async () => {
    const createPrivateRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Classified Internal Encryption Keyring',
        description: 'Private snippet whose activity must never leak globally',
        language: 'typescript',
        visibility: 'private',
        content: 'export const INTERNAL_KEYRING = true;\n',
        tags: ['classified'],
      });
    expect(createPrivateRes.status).toBe(201);
    privateSnippetId = createPrivateRes.body.snippet.id;

    // 1. Global feed must NOT contain any private activity
    const globalRes = await request(app).get('/api/activities/global').query({ limit: 50 });
    expect(globalRes.status).toBe(200);
    expect(
      globalRes.body.items.some(
        (item: { snippetId: string }) => item.snippetId === privateSnippetId
      )
    ).toBe(false);

    // 2. Unrelated viewer (Victor) querying per-snippet activity on Elena's private snippet receives 403 FORBIDDEN
    const victorSnippetActivity = await request(app)
      .get(`/api/activities/snippets/${privateSnippetId}`)
      .set('Authorization', `Bearer ${victorToken}`);
    expect(victorSnippetActivity.status).toBe(403);

    // 3. Unrelated viewer (Victor) querying Elena's user activity feed does NOT see her private snippet activity
    const victorViewsElenaFeed = await request(app)
      .get(`/api/activities/users/${SEED_IDS.users.editor1}`)
      .set('Authorization', `Bearer ${victorToken}`)
      .query({ limit: 50 });
    expect(victorViewsElenaFeed.status).toBe(200);
    expect(
      victorViewsElenaFeed.body.items.some(
        (item: { snippetId: string }) => item.snippetId === privateSnippetId
      )
    ).toBe(false);

    // 4. Elena (owner) querying her own user activity feed and her private snippet feed DOES see her private activity
    const elenaSelfFeed = await request(app)
      .get(`/api/activities/users/${SEED_IDS.users.editor1}`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .query({ limit: 50 });
    expect(elenaSelfFeed.status).toBe(200);
    expect(
      elenaSelfFeed.body.items.some(
        (item: { snippetId: string }) => item.snippetId === privateSnippetId
      )
    ).toBe(true);
  });

  it('3. records full lifecycle events on a snippet (edited, collaborator.added, comment.added, comment.resolved) and paginates with cursors', async () => {
    // 1. Edit public snippet
    const editRes = await request(app)
      .patch(`/api/snippets/${publicSnippetId}`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        content: 'export const stream = () => true;\nexport const version = 2;\n',
        versionSummary: 'Add version export',
      });
    expect(editRes.status).toBe(200);

    // 2. Add Marcus as collaborator
    const collabRes = await request(app)
      .post(`/api/snippets/${publicSnippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ userId: SEED_IDS.users.editor2, role: 'editor' });
    expect([200, 201]).toContain(collabRes.status);

    // 3. Marcus adds a comment and resolves it
    const commentRes = await request(app)
      .post(`/api/snippets/${publicSnippetId}/comments`)
      .set('Authorization', `Bearer ${marcusToken}`)
      .send({ lineNumber: 2, body: 'Looks clean!' });
    expect(commentRes.status).toBe(201);

    const resolveRes = await request(app)
      .post(`/api/snippets/${publicSnippetId}/comments/${commentRes.body.comment.id}/resolve`)
      .set('Authorization', `Bearer ${marcusToken}`);
    expect(resolveRes.status).toBe(200);

    // Paginate through the snippet's activity feed 2 items at a time and verify zero duplicates
    const seenIds = new Set<string>();
    const seenTypes = new Set<string>();
    let cursor: string | undefined = undefined;

    while (true) {
      const pageRes = await request(app)
        .get(`/api/activities/snippets/${publicSnippetId}`)
        .query({ limit: 2, ...(cursor ? { cursor } : {}) });
      expect(pageRes.status).toBe(200);

      for (const item of pageRes.body.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
        seenTypes.add(item.type);
      }

      if (!pageRes.body.hasMore) {
        expect(pageRes.body.nextCursor).toBeNull();
        break;
      }
      cursor = pageRes.body.nextCursor;
    }

    expect(seenTypes.has('snippet.created')).toBe(true);
    expect(seenTypes.has('snippet.edited')).toBe(true);
    expect(seenTypes.has('collaborator.added')).toBe(true);
    expect(seenTypes.has('comment.added')).toBe(true);
    expect(seenTypes.has('comment.resolved')).toBe(true);
  });
});
