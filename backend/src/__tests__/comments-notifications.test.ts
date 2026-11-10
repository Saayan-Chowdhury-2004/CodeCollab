import http from 'http';
import { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { io as createClientSocket, Socket as ClientSocket } from 'socket.io-client';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { attachSocketServer } from '../realtime/socket-server.ts';
import { runSeed } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { snippets } from '../db/schema.ts';
import { consoleMailService } from '../modules/notifications/mail.service.ts';

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

describe('Phase 6: Line-Anchored Threaded Comments, Resolve Flow, Outdated Markers, MailService & Notifications', () => {
  const app = createApp();
  let httpServer: http.Server;
  let baseUrl = '';

  let elenaToken = ''; // Owner of test snippet
  let marcusToken = ''; // Comment author
  let victorToken = ''; // Unrelated viewer
  let testSnippetId = '';
  let rootCommentId = '';
  let replyCommentId = '';

  beforeAll(async () => {
    await runSeed();
    consoleMailService.clearSentMessages();

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

    const createRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Payment Signature Validator',
        description: 'HMAC webhook verification helper',
        language: 'typescript',
        visibility: 'public',
        content: [
          'import crypto from "crypto";',
          'export function verifyWebhook(payload: string, sig: string, secret: string) {',
          '  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");',
          '  return expected === sig;',
          '}',
        ].join('\n'),
        tags: ['security', 'hmac'],
      });
    expect(createRes.status).toBe(201);
    testSnippetId = createRes.body.snippet.id;
  });

  afterAll(async () => {
    if (testSnippetId) {
      await db.delete(snippets).where(eq(snippets.id, testSnippetId));
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('1. creates line-anchored comments and threaded replies, broadcasts live socket events, and dispatches ConsoleMailService + in-app notifications', async () => {
    const elenaSocket = await connectSocket(baseUrl, elenaToken);

    try {
      // Elena joins the snippet room to receive live comment events and also listens on her user notification room
      await new Promise<void>((resolve) => {
        elenaSocket.emit('snippet:join', { snippetId: testSnippetId }, () => resolve());
      });

      const commentCreatedPromise = waitForEvent<{
        snippetId: string;
        comment: { id: string; lineNumber: number; anchorLineText: string; isOutdated: boolean };
      }>(elenaSocket, 'comment:created');

      const notificationNewPromise = waitForEvent<{
        id: string;
        type: string;
        snippetId: string;
      }>(elenaSocket, 'notification:new');

      // Marcus posts a review comment on line 4 ('  return expected === sig;')
      const postCommentRes = await request(app)
        .post(`/api/snippets/${testSnippetId}/comments`)
        .set('Authorization', `Bearer ${marcusToken}`)
        .send({
          lineNumber: 4,
          body: 'Use crypto.timingSafeEqual here to prevent timing side-channel attacks.',
        });

      expect(postCommentRes.status).toBe(201);
      const rootComment = postCommentRes.body.comment;
      rootCommentId = rootComment.id;

      expect(rootComment.lineNumber).toBe(4);
      expect(rootComment.anchorLineText).toBe('  return expected === sig;');
      expect(rootComment.currentLineText).toBe('  return expected === sig;');
      expect(rootComment.isOutdated).toBe(false);
      expect(rootComment.resolved).toBe(false);

      // Verify live Socket.io events arrived at Elena's client
      const liveCommentEvent = await commentCreatedPromise;
      expect(liveCommentEvent.comment.id).toBe(rootCommentId);

      const liveNotification = await notificationNewPromise;
      expect(liveNotification.type).toBe('comment.added');
      expect(liveNotification.snippetId).toBe(testSnippetId);

      // Verify ConsoleMailService recorded the email to elena@codecollab.dev
      const sentEmails = consoleMailService.getSentMessages();
      expect(sentEmails.some((m) => m.to === 'elena@codecollab.dev')).toBe(true);

      // Elena posts a threaded reply to Marcus's root comment
      const replyRes = await request(app)
        .post(`/api/snippets/${testSnippetId}/comments`)
        .set('Authorization', `Bearer ${elenaToken}`)
        .send({
          parentId: rootCommentId,
          body: 'Great catch! Updating line 4 to use timingSafeEqual now.',
        });

      expect(replyRes.status).toBe(201);
      replyCommentId = replyRes.body.comment.id;
      expect(replyRes.body.comment.parentId).toBe(rootCommentId);
      expect(replyRes.body.comment.lineNumber).toBe(4);

      // List comments and verify hierarchical thread + replies structure
      const listRes = await request(app).get(`/api/snippets/${testSnippetId}/comments`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.totalComments).toBe(2);
      expect(listRes.body.threads.length).toBe(1);
      expect(listRes.body.threads[0].id).toBe(rootCommentId);
      expect(listRes.body.threads[0].replies.length).toBe(1);
      expect(listRes.body.threads[0].replies[0].id).toBe(replyCommentId);
    } finally {
      elenaSocket.disconnect();
    }
  });

  it('2. enforces central authorization on comment edit and resolve/unresolve flows', async () => {
    // Victor (unrelated viewer who did not author the comment) cannot resolve Marcus's thread
    const unauthorizedResolve = await request(app)
      .post(`/api/snippets/${testSnippetId}/comments/${rootCommentId}/resolve`)
      .set('Authorization', `Bearer ${victorToken}`);
    expect(unauthorizedResolve.status).toBe(403);
    expect(unauthorizedResolve.body.error.code).toBe('FORBIDDEN');

    // Victor also cannot edit Marcus's comment body
    const unauthorizedEdit = await request(app)
      .patch(`/api/snippets/${testSnippetId}/comments/${rootCommentId}`)
      .set('Authorization', `Bearer ${victorToken}`)
      .send({ body: 'Tampered comment body' });
    expect(unauthorizedEdit.status).toBe(403);

    // Marcus (comment author) edits his own comment body
    const authorEdit = await request(app)
      .patch(`/api/snippets/${testSnippetId}/comments/${rootCommentId}`)
      .set('Authorization', `Bearer ${marcusToken}`)
      .send({
        body: 'Use crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) to prevent timing attacks.',
      });
    expect(authorEdit.status).toBe(200);
    expect(authorEdit.body.comment.body).toContain('crypto.timingSafeEqual(Buffer.from');

    // Elena (snippet owner) resolves the review thread
    const ownerResolve = await request(app)
      .post(`/api/snippets/${testSnippetId}/comments/${rootCommentId}/resolve`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(ownerResolve.status).toBe(200);
    expect(ownerResolve.body.comment.resolved).toBe(true);
    expect(ownerResolve.body.comment.resolvedBy.username).toBe('elena_dev');
    expect(ownerResolve.body.comment.resolvedAt).toBeTruthy();

    // Unresolve and re-resolve by Marcus (comment author)
    const unresolveRes = await request(app)
      .post(`/api/snippets/${testSnippetId}/comments/${rootCommentId}/unresolve`)
      .set('Authorization', `Bearer ${marcusToken}`);
    expect(unresolveRes.status).toBe(200);
    expect(unresolveRes.body.comment.resolved).toBe(false);
    expect(unresolveRes.body.comment.resolvedById).toBeNull();
  });

  it('3. automatically marks anchored comments as isOutdated=true when the underlying line changes', async () => {
    // Elena updates line 4 of the snippet to fix the timing attack
    const updatedContent = [
      'import crypto from "crypto";',
      'export function verifyWebhook(payload: string, sig: string, secret: string) {',
      '  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");',
      '  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));',
      '}',
    ].join('\n');

    const patchRes = await request(app)
      .patch(`/api/snippets/${testSnippetId}`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        content: updatedContent,
        summary: 'Use timingSafeEqual on line 4',
      });
    expect(patchRes.status).toBe(200);

    // Fetch comments again -> line 4 has changed from '  return expected === sig;'
    // so isOutdated must now be true while preserving anchorLineText
    const listAfterEdit = await request(app).get(`/api/snippets/${testSnippetId}/comments`);
    expect(listAfterEdit.status).toBe(200);

    const thread = listAfterEdit.body.threads[0];
    expect(thread.id).toBe(rootCommentId);
    expect(thread.anchorLineText).toBe('  return expected === sig;');
    expect(thread.currentLineText).toBe(
      '  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));'
    );
    expect(thread.isOutdated).toBe(true);
  });

  it('4. lists cursor-paginated in-app notifications and marks individual or all notifications as read', async () => {
    // Check Elena's notifications
    const notifRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${elenaToken}`)
      .query({ limit: 10 });

    expect(notifRes.status).toBe(200);
    expect(Array.isArray(notifRes.body.items)).toBe(true);
    expect(notifRes.body.items.length).toBeGreaterThan(0);
    expect(notifRes.body.unreadCount).toBeGreaterThan(0);

    const firstUnread = notifRes.body.items.find((n: { readAt: string | null }) => !n.readAt);
    expect(firstUnread).toBeTruthy();

    // Mark single notification as read
    const markOneRes = await request(app)
      .post(`/api/notifications/${firstUnread.id}/read`)
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(markOneRes.status).toBe(200);
    expect(markOneRes.body.notification.readAt).toBeTruthy();

    // Mark all remaining notifications as read
    const markAllRes = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${elenaToken}`);
    expect(markAllRes.status).toBe(200);

    // Verify unreadCount is now 0
    const afterReadAll = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${elenaToken}`)
      .query({ unreadOnly: 'true' });
    expect(afterReadAll.status).toBe(200);
    expect(afterReadAll.body.unreadCount).toBe(0);
    expect(afterReadAll.body.items.length).toBe(0);
  });
});
