import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { snippets, snippetCollaborators, users } from '../db/schema.ts';
import { env, isAllowedOrigin } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { AuthenticatedUser, verifyAccessToken } from '../auth/jwt.ts';
import {
  CollaboratorRole,
  EffectiveSnippetRole,
  evaluateAuthorization,
  SnippetAuthorizationResource,
  SnippetVisibility,
} from '../auth/authorize.ts';
import { AppError } from '../utils/errors.ts';
import { socketRateLimiter } from './socket-limiter.ts';
import { yjsRoomHub } from './yjs-room-hub.ts';

export interface SocketData {
  user: AuthenticatedUser | null;
  displayName: string;
  tokenExp: number | null;
}

type AckCallback = (response: Record<string, unknown>) => void;

const authRefreshSchema = z.object({
  token: z.string().min(1),
});

const snippetJoinLeaveSchema = z.object({
  snippetId: z.string().uuid(),
});

const yjsUpdateSchema = z.object({
  snippetId: z.string().uuid(),
  update: z.string().min(1).max(262_144),
});

const yjsSyncStep1Schema = z.object({
  snippetId: z.string().uuid(),
  stateVector: z.string().min(1).max(65_536),
});

const awarenessUpdateSchema = z.object({
  snippetId: z.string().uuid(),
  cursor: z
    .object({
      lineNumber: z.number().int().min(1),
      column: z.number().int().min(1),
    })
    .nullable(),
  selection: z
    .object({
      startLineNumber: z.number().int().min(1),
      startColumn: z.number().int().min(1),
      endLineNumber: z.number().int().min(1),
      endColumn: z.number().int().min(1),
    })
    .nullable()
    .optional(),
});

const saveVersionSchema = z.object({
  snippetId: z.string().uuid(),
  summary: z.string().trim().max(200).optional(),
});

let ioInstance: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

function extractHandshakeToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim().replace(/^Bearer\s+/i, '');
  }

  const headerAuth = socket.handshake.headers.authorization;
  if (typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')) {
    return headerAuth.slice(7).trim();
  }

  return null;
}

async function resolveSnippetAuthResource(
  snippetId: string,
  actor: AuthenticatedUser | null
): Promise<SnippetAuthorizationResource | null> {
  const [snippetRow] = await db
    .select({
      id: snippets.id,
      ownerId: snippets.ownerId,
      visibility: snippets.visibility,
    })
    .from(snippets)
    .where(eq(snippets.id, snippetId));

  if (!snippetRow) {
    return null;
  }

  let collaboratorRole: CollaboratorRole | null = null;
  if (actor) {
    const [collabRow] = await db
      .select({ role: snippetCollaborators.role })
      .from(snippetCollaborators)
      .where(
        and(
          eq(snippetCollaborators.snippetId, snippetId),
          eq(snippetCollaborators.userId, actor.id)
        )
      );
    collaboratorRole = (collabRow?.role as CollaboratorRole | undefined) || null;
  }

  return {
    id: snippetRow.id,
    ownerId: snippetRow.ownerId,
    visibility: snippetRow.visibility as SnippetVisibility,
    collaboratorRole,
  };
}

function canEffectiveRoleEdit(
  actor: AuthenticatedUser | null,
  role: EffectiveSnippetRole
): boolean {
  if (!actor || actor.globalRole === 'viewer') {
    return false;
  }
  return role === 'admin' || role === 'owner' || role === 'editor';
}

function sendSocketError(
  socket: Socket,
  ack: AckCallback | undefined,
  code: string,
  message: string,
  details?: unknown
) {
  const errorPayload = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  socket.emit('socket:error', errorPayload.error);
  if (typeof ack === 'function') {
    ack(errorPayload);
  }
}

export function sweepExpiredSockets(io: SocketIOServer): number {
  let swept = 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.user && socket.data.tokenExp && nowSeconds >= socket.data.tokenExp) {
      socket.emit('auth:expired', {
        code: 'TOKEN_EXPIRED',
        message: 'Access token expired during active session; please refresh',
      });
      swept++;
    }
  }
  return swept;
}

export function attachSocketServer(httpServer: http.Server): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    maxHttpBufferSize: 300_000,
    cors: {
      origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin, env.corsOriginList)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by Socket.io CORS`));
      },
      credentials: true,
    },
  });

  const sweepInterval = setInterval(() => {
    sweepExpiredSockets(io);
  }, 60_000);
  if (sweepInterval.unref) {
    sweepInterval.unref();
  }

  // Handshake authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = extractHandshakeToken(socket);
      if (!token) {
        socket.data.user = null;
        socket.data.displayName = 'Anonymous Viewer';
        socket.data.tokenExp = null;
        return next();
      }

      const decoded = verifyAccessToken(token);
      const [userRow] = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          globalRole: users.globalRole,
        })
        .from(users)
        .where(eq(users.id, decoded.sub));

      if (!userRow) {
        return next(new Error('USER_NOT_FOUND'));
      }

      socket.data.user = {
        id: userRow.id,
        email: userRow.email,
        username: userRow.username,
        displayName: userRow.displayName,
        globalRole: userRow.globalRole as AuthenticatedUser['globalRole'],
      };
      socket.data.displayName = userRow.displayName;
      socket.data.tokenExp = decoded.exp;

      return next();
    } catch (err) {
      if (err instanceof AppError) {
        return next(new Error(err.code));
      }
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('feed:global');
    const initialUser = socket.data.user as AuthenticatedUser | null;
    if (initialUser) {
      socket.join(`user:${initialUser.id}`);
    }

    function withSocketGuard<T>(
      eventName: string,
      schema: z.ZodType<T>,
      handler: (payload: T, ack?: AckCallback) => Promise<void>
    ) {
      return async (rawPayload: unknown, rawAck?: AckCallback) => {
        const ack = typeof rawAck === 'function' ? rawAck : undefined;

        // 1. Per-socket token bucket rate limit check
        if (!socketRateLimiter.consume(socket.id, eventName)) {
          return sendSocketError(
            socket,
            ack,
            'RATE_LIMITED',
            `Rate limit exceeded for socket event ${eventName}`
          );
        }

        // 2. Mid-session access token expiry check (except for auth:refresh)
        if (eventName !== 'auth:refresh' && socket.data.user && socket.data.tokenExp) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          if (nowSeconds >= socket.data.tokenExp) {
            socket.emit('auth:expired', {
              code: 'TOKEN_EXPIRED',
              message: 'Access token has expired; emit auth:refresh with a fresh token',
            });
            return sendSocketError(
              socket,
              ack,
              'TOKEN_EXPIRED',
              'Access token has expired; emit auth:refresh with a fresh token'
            );
          }
        }

        // 3. Zod payload validation
        const parsed = schema.safeParse(rawPayload);
        if (!parsed.success) {
          return sendSocketError(
            socket,
            ack,
            'VALIDATION_ERROR',
            `Invalid payload for socket event ${eventName}`,
            parsed.error.issues
          );
        }

        try {
          await handler(parsed.data, ack);
        } catch (err) {
          if (err instanceof AppError) {
            return sendSocketError(socket, ack, err.code, err.message, err.details);
          }
          logger.error({ err, eventName, socketId: socket.id }, 'Unhandled socket event error');
          return sendSocketError(
            socket,
            ack,
            'INTERNAL_SERVER_ERROR',
            'An unexpected error occurred processing socket event'
          );
        }
      };
    }

    // 1. Mid-session token refresh over WebSocket
    socket.on(
      'auth:refresh',
      withSocketGuard('auth:refresh', authRefreshSchema, async ({ token }, ack) => {
        const cleanToken = token.trim().replace(/^Bearer\s+/i, '');
        const decoded = verifyAccessToken(cleanToken);
        const [userRow] = await db
          .select({
            id: users.id,
            email: users.email,
            username: users.username,
            displayName: users.displayName,
            globalRole: users.globalRole,
          })
          .from(users)
          .where(eq(users.id, decoded.sub));

        if (!userRow) {
          throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');
        }

        const previousUser = socket.data.user as AuthenticatedUser | null;
        if (previousUser && previousUser.id !== userRow.id) {
          socket.leave(`user:${previousUser.id}`);
        }

        socket.data.user = {
          id: userRow.id,
          email: userRow.email,
          username: userRow.username,
          displayName: userRow.displayName,
          globalRole: userRow.globalRole as AuthenticatedUser['globalRole'],
        };
        socket.data.displayName = userRow.displayName;
        socket.data.tokenExp = decoded.exp;
        socket.join(`user:${userRow.id}`);

        // Invalidate cached room roles for this user so updated globalRole takes effect
        yjsRoomHub.invalidateCachedRolesForUser(userRow.id);

        // Re-evaluate permissions for all joined snippet rooms (P1-6)
        for (const roomName of Array.from(socket.rooms)) {
          if (roomName.startsWith('snippet:')) {
            const snippetId = roomName.replace('snippet:', '');
            const authResource = await resolveSnippetAuthResource(snippetId, socket.data.user);
            if (!authResource) {
              await socket.leave(roomName);
              await yjsRoomHub.removeClientAndFlushIfEmpty(snippetId, socket.id);
              socket.emit('snippet:access-revoked', { snippetId, reason: 'Snippet no longer exists' });
              continue;
            }
            const decision = evaluateAuthorization(socket.data.user, 'snippet:read', {
              snippet: authResource,
            });
            if (!decision.allowed) {
              await socket.leave(roomName);
              await yjsRoomHub.removeClientAndFlushIfEmpty(snippetId, socket.id);
              socket.emit('snippet:access-revoked', {
                snippetId,
                reason: decision.reason || 'You no longer have permission to access this snippet',
              });
            } else {
              yjsRoomHub.setClientRole(snippetId, socket.id, decision.effectiveRole as EffectiveSnippetRole);
            }
          }
        }

        if (ack) {
          ack({
            ok: true,
            user: socket.data.user,
            exp: decoded.exp,
          });
        }
      })
    );

    // 2. Join snippet collaboration room
    socket.on(
      'snippet:join',
      withSocketGuard('snippet:join', snippetJoinLeaveSchema, async ({ snippetId }, ack) => {
        const actor = socket.data.user as AuthenticatedUser | null;
        const authResource = await resolveSnippetAuthResource(snippetId, actor);

        if (!authResource) {
          throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
        }

        const decision = evaluateAuthorization(actor, 'snippet:read', { snippet: authResource });
        if (!decision.allowed) {
          return sendSocketError(
            socket,
            ack,
            'FORBIDDEN',
            decision.reason || 'You do not have permission to join this snippet room'
          );
        }

        const room = await yjsRoomHub.getOrLoadRoom(snippetId);
        const roomName = `snippet:${snippetId}`;
        await socket.join(roomName);

        yjsRoomHub.registerClient(room, {
          socketId: socket.id,
          userId: actor?.id || null,
          username: actor?.username || `guest_${socket.id.slice(0, 5)}`,
          displayName: (socket.data.displayName as string) || actor?.username || 'Anonymous Viewer',
          role: decision.effectiveRole as EffectiveSnippetRole,
        });

        const base64State = yjsRoomHub.encodeRoomStateBase64(room);
        const currentContent = yjsRoomHub.getRoomContent(room);
        const members = yjsRoomHub.getPresenceList(snippetId);

        const initPayload = {
          snippetId,
          state: base64State,
          content: currentContent,
          versionId: room.currentVersionId,
          latestVersionNumber: room.latestVersionNumber,
          role: decision.effectiveRole,
          members,
        };

        socket.emit('yjs:init', initPayload);
        io.to(roomName).emit('presence:state', {
          snippetId,
          members,
        });

        if (ack) {
          ack({
            ok: true,
            ...initPayload,
          });
        }
      })
    );

    // 3. Leave snippet collaboration room
    socket.on(
      'snippet:leave',
      withSocketGuard('snippet:leave', snippetJoinLeaveSchema, async ({ snippetId }, ack) => {
        const roomName = `snippet:${snippetId}`;
        await socket.leave(roomName);
        const { remainingClients } = await yjsRoomHub.removeClientAndFlushIfEmpty(
          snippetId,
          socket.id
        );

        io.to(roomName).emit('presence:state', {
          snippetId,
          members: remainingClients,
        });

        if (ack) {
          ack({ ok: true, snippetId });
        }
      })
    );

    // 4. Live Yjs document update (uses cached role per room client; falls back to DB only on cache miss/invalidation)
    socket.on(
      'yjs:update',
      withSocketGuard('yjs:update', yjsUpdateSchema, async ({ snippetId, update }, ack) => {
        const actor = socket.data.user as AuthenticatedUser | null;
        const cachedClient = yjsRoomHub.getClient(snippetId, socket.id);

        let effectiveRole: EffectiveSnippetRole | null =
          cachedClient && cachedClient.roleCached ? cachedClient.role : null;

        if (!effectiveRole) {
          const authResource = await resolveSnippetAuthResource(snippetId, actor);
          if (!authResource) {
            throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
          }

          const decision = evaluateAuthorization(actor, 'snippet:edit', { snippet: authResource });
          effectiveRole = decision.effectiveRole as EffectiveSnippetRole;

          if (cachedClient) {
            yjsRoomHub.setClientRole(snippetId, socket.id, effectiveRole);
          }

          if (!decision.allowed || !actor) {
            return sendSocketError(
              socket,
              ack,
              'FORBIDDEN_READ_ONLY',
              decision.reason || 'Read-only viewers cannot edit snippet code over WebSocket'
            );
          }
        } else if (!canEffectiveRoleEdit(actor, effectiveRole) || !actor) {
          return sendSocketError(
            socket,
            ack,
            'FORBIDDEN_READ_ONLY',
            'Read-only viewers cannot edit snippet code over WebSocket'
          );
        }

        const room = await yjsRoomHub.getOrLoadRoom(snippetId);
        const { content } = yjsRoomHub.applyClientUpdate(room, update, actor.id);

        const roomName = `snippet:${snippetId}`;
        socket.to(roomName).emit('yjs:update', {
          snippetId,
          update,
          actorId: actor.id,
          username: actor.username,
        });

        if (ack) {
          ack({
            ok: true,
            snippetId,
            contentLength: content.length,
          });
        }
      })
    );

    // 5. Reconnect state-vector resync (yjs:sync-step1 -> yjs:sync-step2)
    socket.on(
      'yjs:sync-step1',
      withSocketGuard(
        'yjs:sync-step1',
        yjsSyncStep1Schema,
        async ({ snippetId, stateVector }, ack) => {
          const actor = socket.data.user as AuthenticatedUser | null;
          const authResource = await resolveSnippetAuthResource(snippetId, actor);

          if (!authResource) {
            throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
          }

          const decision = evaluateAuthorization(actor, 'snippet:read', { snippet: authResource });
          if (!decision.allowed) {
            return sendSocketError(
              socket,
              ack,
              'FORBIDDEN',
              decision.reason || 'No permission to sync snippet state'
            );
          }

          const room = await yjsRoomHub.getOrLoadRoom(snippetId);
          const diffBase64 = yjsRoomHub.encodeDiffFromStateVectorBase64(room, stateVector);
          const content = yjsRoomHub.getRoomContent(room);

          const syncPayload = {
            snippetId,
            update: diffBase64,
            content,
            versionId: room.currentVersionId,
            latestVersionNumber: room.latestVersionNumber,
          };

          socket.emit('yjs:sync-step2', syncPayload);
          if (ack) {
            ack({
              ok: true,
              ...syncPayload,
            });
          }
        }
      )
    );

    // 6. Live cursor & selection awareness update
    socket.on(
      'awareness:update',
      withSocketGuard(
        'awareness:update',
        awarenessUpdateSchema,
        async ({ snippetId, cursor, selection }, ack) => {
          const actor = socket.data.user as AuthenticatedUser | null;
          const cachedClient = yjsRoomHub.getClient(snippetId, socket.id);

          if (!cachedClient || !cachedClient.roleCached) {
            const authResource = await resolveSnippetAuthResource(snippetId, actor);
            if (!authResource) {
              throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
            }
            const decision = evaluateAuthorization(actor, 'snippet:read', { snippet: authResource });
            if (!decision.allowed) {
              return sendSocketError(socket, ack, 'FORBIDDEN', 'No access to snippet room');
            }
          }

          const updatedPresence = yjsRoomHub.updateClientAwareness(
            snippetId,
            socket.id,
            cursor,
            selection ?? null
          );

          if (updatedPresence) {
            const roomName = `snippet:${snippetId}`;
            socket.to(roomName).emit('awareness:update', {
              snippetId,
              member: updatedPresence,
            });
          }

          if (ack) {
            ack({ ok: true });
          }
        }
      )
    );

    // 7. Explicit collaborative version snapshot save over WebSocket
    socket.on(
      'snippet:save-version',
      withSocketGuard(
        'snippet:save-version',
        saveVersionSchema,
        async ({ snippetId, summary }, ack) => {
          const actor = socket.data.user as AuthenticatedUser | null;
          const authResource = await resolveSnippetAuthResource(snippetId, actor);

          if (!authResource) {
            throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
          }

          const decision = evaluateAuthorization(actor, 'snippet:version:create', {
            snippet: authResource,
          });
          if (!decision.allowed || !actor) {
            return sendSocketError(
              socket,
              ack,
              'FORBIDDEN_READ_ONLY',
              decision.reason || 'Only snippet editors, owners, or admins can save version snapshots'
            );
          }

          const savedVersion = await yjsRoomHub.saveVersionSnapshot(
            snippetId,
            actor.id,
            summary || 'Manual collaborative checkpoint',
            'manual'
          );

          const roomName = `snippet:${snippetId}`;
          io.to(roomName).emit('version:created', {
            snippetId,
            version: savedVersion,
          });

          if (ack) {
            ack({
              ok: true,
              version: savedVersion,
            });
          }
        }
      )
    );

    // 8. Disconnect cleanup & empty-room flush
    socket.on('disconnect', async () => {
      socketRateLimiter.removeSocket(socket.id);
      try {
        const affectedRooms = await yjsRoomHub.removeSocketFromAllRooms(socket.id);
        for (const { snippetId, remainingClients } of affectedRooms) {
          io.to(`snippet:${snippetId}`).emit('presence:state', {
            snippetId,
            members: remainingClients,
          });
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, 'Error cleaning up socket rooms on disconnect');
      }
    });
  });

  ioInstance = io;
  return io;
}
