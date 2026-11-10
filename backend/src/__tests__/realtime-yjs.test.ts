import http from 'http';
import { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { io as createClientSocket, Socket as ClientSocket } from 'socket.io-client';
import * as Y from 'yjs';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { attachSocketServer } from '../realtime/socket-server.ts';
import { runSeed, SEED_IDS } from '../db/seed.ts';
import { db } from '../db/index.ts';
import { snippets } from '../db/schema.ts';
import { signAccessToken } from '../auth/jwt.ts';

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

describe('Phase 5: Real-Time Collaboration (Socket.io + Yjs), Presence, Persistence & Viewer Write-Block', () => {
  const app = createApp();
  let httpServer: http.Server;
  let baseUrl = '';

  let elenaToken = '';
  let marcusToken = '';
  let victorToken = '';
  let collabSnippetId = '';

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

    // Create a private snippet owned by Elena, add Marcus as 'editor' and Victor as 'viewer'
    const createRes = await request(app)
      .post('/api/snippets')
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({
        title: 'Realtime Yjs CRDT Test Room',
        description: 'Testing multi-client Yjs sync and viewer write-block',
        language: 'typescript',
        visibility: 'private',
        content: 'export const counter = 1;\n',
        tags: ['realtime', 'yjs'],
      });
    expect(createRes.status).toBe(201);
    collabSnippetId = createRes.body.snippet.id;

    // Add Marcus as collaborator with role 'editor'
    const addMarcusRes = await request(app)
      .post(`/api/snippets/${collabSnippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ userId: SEED_IDS.users.editor2, role: 'editor' });
    expect([200, 201]).toContain(addMarcusRes.status);

    // Add Victor as collaborator with role 'viewer'
    const addVictorRes = await request(app)
      .post(`/api/snippets/${collabSnippetId}/collaborators`)
      .set('Authorization', `Bearer ${elenaToken}`)
      .send({ userId: SEED_IDS.users.viewer, role: 'viewer' });
    expect([200, 201]).toContain(addVictorRes.status);
  });

  afterAll(async () => {
    if (collabSnippetId) {
      await db.delete(snippets).where(eq(snippets.id, collabSnippetId));
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('1. syncs live Yjs updates and cursor awareness between owner and editor collaborators', async () => {
    const elenaSocket = await connectSocket(baseUrl, elenaToken);
    const marcusSocket = await connectSocket(baseUrl, marcusToken);

    try {
      const elenaJoin = await emitWithAck<{
        ok: boolean;
        state: string;
        content: string;
        role: string;
        members: unknown[];
      }>(elenaSocket, 'snippet:join', { snippetId: collabSnippetId });

      expect(elenaJoin.ok).toBe(true);
      expect(elenaJoin.role).toBe('owner');
      expect(elenaJoin.content).toBe('export const counter = 1;\n');

      const marcusJoin = await emitWithAck<{
        ok: boolean;
        state: string;
        content: string;
        role: string;
        members: unknown[];
      }>(marcusSocket, 'snippet:join', { snippetId: collabSnippetId });

      expect(marcusJoin.ok).toBe(true);
      expect(marcusJoin.role).toBe('editor');
      expect(marcusJoin.members.length).toBe(2);

      // Initialize local Y.Docs for Elena and Marcus from server state
      const elenaDoc = new Y.Doc();
      Y.applyUpdate(elenaDoc, new Uint8Array(Buffer.from(elenaJoin.state, 'base64')));

      const marcusDoc = new Y.Doc();
      Y.applyUpdate(marcusDoc, new Uint8Array(Buffer.from(marcusJoin.state, 'base64')));

      // Marcus listens for Elena's live Yjs update
      const marcusUpdatePromise = waitForEvent<{
        snippetId: string;
        update: string;
        actorId: string;
        username: string;
      }>(marcusSocket, 'yjs:update');

      // Elena appends a new line to her Y.Doc and sends the incremental update
      const stateVectorBefore = Y.encodeStateVector(elenaDoc);
      elenaDoc.getText('monaco').insert(elenaDoc.getText('monaco').length, 'export const ready = true;\n');
      const incrementalUpdate = Y.encodeStateAsUpdate(elenaDoc, stateVectorBefore);
      const updateBase64 = Buffer.from(incrementalUpdate).toString('base64');

      const updateAck = await emitWithAck<{ ok: boolean; contentLength: number }>(
        elenaSocket,
        'yjs:update',
        {
          snippetId: collabSnippetId,
          update: updateBase64,
        }
      );
      expect(updateAck.ok).toBe(true);

      const marcusReceived = await marcusUpdatePromise;
      expect(marcusReceived.snippetId).toBe(collabSnippetId);
      expect(marcusReceived.username).toBe('elena_dev');

      Y.applyUpdate(marcusDoc, new Uint8Array(Buffer.from(marcusReceived.update, 'base64')));
      expect(marcusDoc.getText('monaco').toString()).toBe(
        'export const counter = 1;\nexport const ready = true;\n'
      );

      // Test live cursor & selection awareness broadcast
      const elenaAwarenessPromise = waitForEvent<{
        snippetId: string;
        member: { username: string; cursor: { lineNumber: number; column: number } };
      }>(elenaSocket, 'awareness:update');

      const awarenessAck = await emitWithAck<{ ok: boolean }>(marcusSocket, 'awareness:update', {
        snippetId: collabSnippetId,
        cursor: { lineNumber: 2, column: 14 },
        selection: {
          startLineNumber: 2,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 14,
        },
      });
      expect(awarenessAck.ok).toBe(true);

      const awarenessEvent = await elenaAwarenessPromise;
      expect(awarenessEvent.member.username).toBe('marcus_code');
      expect(awarenessEvent.member.cursor).toEqual({ lineNumber: 2, column: 14 });
    } finally {
      elenaSocket.disconnect();
      marcusSocket.disconnect();
    }
  });

  it('2. strictly blocks a viewer from writing or saving versions over the socket (FORBIDDEN_READ_ONLY)', async () => {
    const elenaSocket = await connectSocket(baseUrl, elenaToken);
    const victorSocket = await connectSocket(baseUrl, victorToken);

    try {
      const elenaJoin = await emitWithAck<{ ok: boolean; content: string }>(
        elenaSocket,
        'snippet:join',
        { snippetId: collabSnippetId }
      );
      expect(elenaJoin.ok).toBe(true);

      const victorJoin = await emitWithAck<{
        ok: boolean;
        state: string;
        content: string;
        role: string;
      }>(victorSocket, 'snippet:join', { snippetId: collabSnippetId });

      expect(victorJoin.ok).toBe(true);
      expect(victorJoin.role).toBe('viewer');

      // Construct a rogue Yjs update from Victor attempting to inject code
      const rogueDoc = new Y.Doc();
      Y.applyUpdate(rogueDoc, new Uint8Array(Buffer.from(victorJoin.state, 'base64')));
      rogueDoc.getText('monaco').insert(0, '// HACKED BY VIEWER\n');
      const rogueUpdateBase64 = Buffer.from(Y.encodeStateAsUpdate(rogueDoc)).toString('base64');

      let elenaReceivedRogueUpdate = false;
      elenaSocket.on('yjs:update', () => {
        elenaReceivedRogueUpdate = true;
      });

      const writeAttempt = await emitWithAck<{
        ok: boolean;
        error?: { code: string; message: string };
      }>(victorSocket, 'yjs:update', {
        snippetId: collabSnippetId,
        update: rogueUpdateBase64,
      });

      expect(writeAttempt.ok).toBe(false);
      expect(writeAttempt.error?.code).toBe('FORBIDDEN_READ_ONLY');

      // Also verify viewer is blocked from snippet:save-version over the socket
      const saveAttempt = await emitWithAck<{
        ok: boolean;
        error?: { code: string; message: string };
      }>(victorSocket, 'snippet:save-version', {
        snippetId: collabSnippetId,
        summary: 'Unauthorized viewer version save',
      });
      expect(saveAttempt.ok).toBe(false);
      expect(saveAttempt.error?.code).toBe('FORBIDDEN_READ_ONLY');

      // Ensure Elena never received the viewer's rejected update and server content is untouched
      expect(elenaReceivedRogueUpdate).toBe(false);

      const verifySync = await emitWithAck<{ ok: boolean; content: string }>(
        elenaSocket,
        'snippet:join',
        { snippetId: collabSnippetId }
      );
      expect(verifySync.content).not.toContain('HACKED BY VIEWER');
      expect(verifySync.content).toBe('export const counter = 1;\nexport const ready = true;\n');
    } finally {
      elenaSocket.disconnect();
      victorSocket.disconnect();
    }
  });

  it('3. supports reconnect state-vector resync, explicit version checkpoints, and empty-room DB persistence', async () => {
    const marcusSocket = await connectSocket(baseUrl, marcusToken);

    try {
      const joinRes = await emitWithAck<{
        ok: boolean;
        state: string;
        content: string;
        latestVersionNumber: number;
      }>(marcusSocket, 'snippet:join', { snippetId: collabSnippetId });
      expect(joinRes.ok).toBe(true);

      // Simulate a reconnecting client that only has an empty Y.Doc state vector
      const emptyClientDoc = new Y.Doc();
      const emptyStateVectorBase64 = Buffer.from(Y.encodeStateVector(emptyClientDoc)).toString(
        'base64'
      );

      const syncRes = await emitWithAck<{
        ok: boolean;
        update: string;
        content: string;
      }>(marcusSocket, 'yjs:sync-step1', {
        snippetId: collabSnippetId,
        stateVector: emptyStateVectorBase64,
      });

      expect(syncRes.ok).toBe(true);
      Y.applyUpdate(emptyClientDoc, new Uint8Array(Buffer.from(syncRes.update, 'base64')));
      expect(emptyClientDoc.getText('monaco').toString()).toBe(
        'export const counter = 1;\nexport const ready = true;\n'
      );

      // Save an explicit version checkpoint over the socket
      const saveRes = await emitWithAck<{
        ok: boolean;
        version: { versionNumber: number; summary: string; content: string };
      }>(marcusSocket, 'snippet:save-version', {
        snippetId: collabSnippetId,
        summary: 'Checkpoint after live collaboration',
      });
      expect(saveRes.ok).toBe(true);
      expect(saveRes.version.summary).toBe('Checkpoint after live collaboration');
      expect(saveRes.version.content).toBe(
        'export const counter = 1;\nexport const ready = true;\n'
      );

      // Leave the room so it becomes empty and flushes/evicts cleanly
      const leaveRes = await emitWithAck<{ ok: boolean }>(marcusSocket, 'snippet:leave', {
        snippetId: collabSnippetId,
      });
      expect(leaveRes.ok).toBe(true);
    } finally {
      marcusSocket.disconnect();
    }

    // Verify PostgreSQL persisted both currentContent and yjsState on the snippet record
    const [persistedSnippet] = await db
      .select()
      .from(snippets)
      .where(eq(snippets.id, collabSnippetId));

    expect(persistedSnippet.currentContent).toBe(
      'export const counter = 1;\nexport const ready = true;\n'
    );
    expect(typeof persistedSnippet.yjsState).toBe('string');
    expect((persistedSnippet.yjsState || '').length).toBeGreaterThan(0);
  });

  it('4. detects mid-session JWT access token expiry and recovers seamlessly via auth:refresh', async () => {
    // Mint a token that expires in 1 second
    const shortLivedToken = signAccessToken(
      {
        id: SEED_IDS.users.editor1,
        email: 'elena@codecollab.dev',
        username: 'elena_dev',
        globalRole: 'editor',
      },
      1
    );

    const socket = await connectSocket(baseUrl, shortLivedToken);

    try {
      // Wait 1.5 seconds so the access token expires mid-session
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const expiredJoinAttempt = await emitWithAck<{
        ok: boolean;
        error?: { code: string };
      }>(socket, 'snippet:join', { snippetId: collabSnippetId });

      expect(expiredJoinAttempt.ok).toBe(false);
      expect(expiredJoinAttempt.error?.code).toBe('TOKEN_EXPIRED');

      // Refresh the socket's token in-place using Elena's valid access token
      const refreshAck = await emitWithAck<{
        ok: boolean;
        user: { username: string };
      }>(socket, 'auth:refresh', { token: elenaToken });

      expect(refreshAck.ok).toBe(true);
      expect(refreshAck.user.username).toBe('elena_dev');

      // Retry snippet:join on the same socket -> succeeds!
      const recoveredJoin = await emitWithAck<{ ok: boolean; role: string }>(
        socket,
        'snippet:join',
        { snippetId: collabSnippetId }
      );
      expect(recoveredJoin.ok).toBe(true);
      expect(recoveredJoin.role).toBe('owner');
    } finally {
      socket.disconnect();
    }
  });

  it('5. synchronizes REST edit and version restore through yjsRoomHub to active room clients', async () => {
    const marcusSocket = await connectSocket(baseUrl, marcusToken);

    try {
      const joinRes = await emitWithAck<{
        ok: boolean;
        state: string;
        content: string;
        latestVersionNumber: number;
      }>(marcusSocket, 'snippet:join', { snippetId: collabSnippetId });
      expect(joinRes.ok).toBe(true);

      const clientDoc = new Y.Doc();
      Y.applyUpdate(clientDoc, new Uint8Array(Buffer.from(joinRes.state, 'base64')));

      const yjsUpdatePromise = waitForEvent<{
        snippetId: string;
        update: string;
        latestVersionNumber: number;
        title: string;
        tags: string[];
      }>(marcusSocket, 'yjs:update');

      const snippetUpdatedPromise = waitForEvent<{
        snippetId: string;
        title: string;
        tags: string[];
        latestVersionNumber: number;
        content: string;
      }>(marcusSocket, 'snippet:updated');

      const restEditRes = await request(app)
        .patch(`/api/snippets/${collabSnippetId}`)
        .set('Authorization', `Bearer ${elenaToken}`)
        .send({
          title: 'REST Synced Title',
          tags: ['realtime', 'rest-synced'],
          content: 'export const counter = 42;\n',
          versionSummary: 'REST edit while room active',
        });
      expect(restEditRes.status).toBe(200);

      const [yjsEvent, metaEvent] = await Promise.all([
        yjsUpdatePromise,
        snippetUpdatedPromise,
      ]);

      Y.applyUpdate(clientDoc, new Uint8Array(Buffer.from(yjsEvent.update, 'base64')));
      expect(clientDoc.getText('monaco').toString()).toBe('export const counter = 42;\n');
      expect(metaEvent.title).toBe('REST Synced Title');
      expect(metaEvent.tags).toEqual(expect.arrayContaining(['realtime', 'rest-synced']));
      expect(metaEvent.latestVersionNumber).toBe(restEditRes.body.snippet.latestVersionNumber);
    } finally {
      marcusSocket.disconnect();
    }
  });
});
