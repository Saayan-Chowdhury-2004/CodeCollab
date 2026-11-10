import * as Y from 'yjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { snippets, snippetVersions, users, snippetCollaborators } from '../db/schema.ts';
import {
  CollaboratorRole,
  EffectiveSnippetRole,
  evaluateAuthorization,
  SnippetAuthorizationResource,
  SnippetVisibility,
} from '../auth/authorize.ts';
import { AuthenticatedUser } from '../auth/jwt.ts';
import { AppError } from '../utils/errors.ts';
import { sanitizePlainText } from '../utils/sanitize.ts';
import { domainEventBus } from '../modules/activity/event-bus.ts';
import type { SnippetVersionDTO } from '../modules/snippets/snippets.service.ts';
import { getIO } from './socket-server.ts';

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

export interface SelectionRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface RoomClientPresence {
  socketId: string;
  userId: string | null;
  username: string;
  displayName: string;
  color: string;
  role: EffectiveSnippetRole;
  roleCached: boolean;
  cursor: CursorPosition | null;
  selection: SelectionRange | null;
  joinedAt: string;
}

export interface ActiveSnippetRoom {
  snippetId: string;
  title: string;
  ownerId: string;
  visibility: SnippetVisibility;
  tagsText: string;
  yDoc: Y.Doc;
  currentVersionId: string | null;
  latestVersionNumber: number;
  lastSavedContent: string;
  dirty: boolean;
  lastEditorId: string | null;
  clients: Map<string, RoomClientPresence>;
  periodicFlushTimer: NodeJS.Timeout | null;
  debouncedVersionTimer: NodeJS.Timeout | null;
}

const PRESENCE_PALETTE = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
];

function pickColorForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_PALETTE[hash % PRESENCE_PALETTE.length];
}

const PERIODIC_FLUSH_MS = 10_000;
const DEBOUNCED_VERSION_MS = 30_000;

export class YjsRoomHub {
  private rooms = new Map<string, ActiveSnippetRoom>();
  private loadingPromises = new Map<string, Promise<ActiveSnippetRoom>>();

  public getRoom(snippetId: string): ActiveSnippetRoom | undefined {
    return this.rooms.get(snippetId);
  }

  public getClient(snippetId: string, socketId: string): RoomClientPresence | undefined {
    return this.rooms.get(snippetId)?.clients.get(socketId);
  }

  public setClientRole(snippetId: string, socketId: string, role: EffectiveSnippetRole): void {
    const client = this.rooms.get(snippetId)?.clients.get(socketId);
    if (client) {
      client.role = role;
      client.roleCached = true;
    }
  }

  public invalidateCachedRolesForSnippet(snippetId: string): void {
    const room = this.rooms.get(snippetId);
    if (!room) return;
    for (const client of room.clients.values()) {
      client.roleCached = false;
    }
  }

  public invalidateCachedRolesForUser(userId: string): void {
    for (const room of this.rooms.values()) {
      for (const client of room.clients.values()) {
        if (client.userId === userId) {
          client.roleCached = false;
        }
      }
    }
  }

  public async getOrLoadRoom(snippetId: string): Promise<ActiveSnippetRoom> {
    const existing = this.rooms.get(snippetId);
    if (existing) {
      return existing;
    }

    const pending = this.loadingPromises.get(snippetId);
    if (pending) {
      return pending;
    }

    const loadPromise = this.loadRoomFromDatabase(snippetId);
    this.loadingPromises.set(snippetId, loadPromise);

    try {
      const room = await loadPromise;
      return room;
    } finally {
      this.loadingPromises.delete(snippetId);
    }
  }

  private async loadRoomFromDatabase(snippetId: string): Promise<ActiveSnippetRoom> {
    const [snippetRow] = await db
      .select()
      .from(snippets)
      .where(eq(snippets.id, snippetId));

    if (!snippetRow) {
      throw new AppError(404, 'SNIPPET_NOT_FOUND', 'Snippet not found');
    }

    const yDoc = new Y.Doc();
    const yText = yDoc.getText('monaco');

    if (snippetRow.yjsState) {
      try {
        const updateBytes = new Uint8Array(Buffer.from(snippetRow.yjsState, 'base64'));
        Y.applyUpdate(yDoc, updateBytes);
      } catch (err) {
        console.error('Failed to decode stored yjsState, falling back to currentContent:', err);
      }
    }

    if (yText.toString().length === 0 && snippetRow.currentContent.length > 0) {
      yDoc.transact(() => {
        yText.insert(0, snippetRow.currentContent);
      });
    }

    const room: ActiveSnippetRoom = {
      snippetId: snippetRow.id,
      title: snippetRow.title,
      ownerId: snippetRow.ownerId,
      visibility: snippetRow.visibility as SnippetVisibility,
      tagsText: snippetRow.tagsText,
      yDoc,
      currentVersionId: snippetRow.currentVersionId,
      latestVersionNumber: snippetRow.latestVersionNumber,
      lastSavedContent: yText.toString(),
      dirty: false,
      lastEditorId: null,
      clients: new Map(),
      periodicFlushTimer: null,
      debouncedVersionTimer: null,
    };

    room.periodicFlushTimer = setInterval(() => {
      if (room.dirty) {
        this.flushRoomStateToDb(room.snippetId).catch((err) => {
          console.error(`Periodic flush failed for snippet ${room.snippetId}:`, err);
        });
      }
    }, PERIODIC_FLUSH_MS);
    if (room.periodicFlushTimer.unref) {
      room.periodicFlushTimer.unref();
    }

    this.rooms.set(snippetId, room);
    return room;
  }

  public registerClient(
    room: ActiveSnippetRoom,
    params: {
      socketId: string;
      userId: string | null;
      username: string;
      displayName: string;
      role: EffectiveSnippetRole;
    }
  ): RoomClientPresence {
    const presence: RoomClientPresence = {
      socketId: params.socketId,
      userId: params.userId,
      username: params.username,
      displayName: params.displayName,
      color: pickColorForSeed(params.userId || params.socketId),
      role: params.role,
      roleCached: true,
      cursor: null,
      selection: null,
      joinedAt: new Date().toISOString(),
    };

    room.clients.set(params.socketId, presence);
    return presence;
  }

  public updateClientAwareness(
    snippetId: string,
    socketId: string,
    cursor: CursorPosition | null,
    selection: SelectionRange | null
  ): RoomClientPresence | null {
    const room = this.rooms.get(snippetId);
    if (!room) return null;
    const client = room.clients.get(socketId);
    if (!client) return null;

    client.cursor = cursor;
    client.selection = selection;
    return client;
  }

  public getPresenceList(snippetId: string): RoomClientPresence[] {
    const room = this.rooms.get(snippetId);
    if (!room) return [];
    return Array.from(room.clients.values());
  }

  public encodeRoomStateBase64(room: ActiveSnippetRoom): string {
    const stateUpdate = Y.encodeStateAsUpdate(room.yDoc);
    return Buffer.from(stateUpdate).toString('base64');
  }

  public encodeDiffFromStateVectorBase64(
    room: ActiveSnippetRoom,
    stateVectorBase64: string
  ): string {
    const svBytes = new Uint8Array(Buffer.from(stateVectorBase64, 'base64'));
    const diffUpdate = Y.encodeStateAsUpdate(room.yDoc, svBytes);
    return Buffer.from(diffUpdate).toString('base64');
  }

  public getRoomContent(room: ActiveSnippetRoom): string {
    return room.yDoc.getText('monaco').toString();
  }

  /**
   * Prepares an authoritative Yjs binary state for a REST edit or restore.
   * If the room is currently active in memory, updates its Y.Doc in-place and produces
   * a delta update suitable for broadcasting to connected peers.
   */
  public prepareRestContentUpdate(
    snippetId: string,
    nextContent: string
  ): { yjsStateBase64: string; broadcastUpdateBase64: string } {
    const activeRoom = this.rooms.get(snippetId);
    if (activeRoom) {
      const svBefore = Y.encodeStateVector(activeRoom.yDoc);
      const yText = activeRoom.yDoc.getText('monaco');
      if (yText.toString() !== nextContent) {
        activeRoom.yDoc.transact(() => {
          yText.delete(0, yText.length);
          if (nextContent.length > 0) {
            yText.insert(0, nextContent);
          }
        });
      }
      const deltaUpdate = Y.encodeStateAsUpdate(activeRoom.yDoc, svBefore);
      const fullState = Y.encodeStateAsUpdate(activeRoom.yDoc);
      return {
        yjsStateBase64: Buffer.from(fullState).toString('base64'),
        broadcastUpdateBase64: Buffer.from(deltaUpdate).toString('base64'),
      };
    }

    const tempDoc = new Y.Doc();
    const tempText = tempDoc.getText('monaco');
    if (nextContent.length > 0) {
      tempDoc.transact(() => {
        tempText.insert(0, nextContent);
      });
    }
    const fullState = Y.encodeStateAsUpdate(tempDoc);
    tempDoc.destroy();
    const base64 = Buffer.from(fullState).toString('base64');
    return {
      yjsStateBase64: base64,
      broadcastUpdateBase64: base64,
    };
  }

  /**
   * Synchronizes an active Yjs room after a REST edit, version creation, or version restore,
   * updating the Y.Doc, version number, title, and tags, then broadcasting to the room.
   */
  public async syncRoomFromRestMutation(params: {
    snippetId: string;
    title: string;
    visibility: SnippetVisibility;
    tags: string[];
    tagsText: string;
    content: string;
    currentVersionId: string | null;
    latestVersionNumber: number;
    actorId: string;
    actorUsername: string;
    contentChanged: boolean;
    broadcastUpdateBase64?: string;
    createdVersion?: SnippetVersionDTO;
  }): Promise<void> {
    const room = this.rooms.get(params.snippetId);
    let updateToBroadcast = params.broadcastUpdateBase64;

    if (room) {
      const yText = room.yDoc.getText('monaco');
      if (yText.toString() !== params.content) {
        const svBefore = Y.encodeStateVector(room.yDoc);
        room.yDoc.transact(() => {
          yText.delete(0, yText.length);
          if (params.content.length > 0) {
            yText.insert(0, params.content);
          }
        });
        updateToBroadcast = Buffer.from(Y.encodeStateAsUpdate(room.yDoc, svBefore)).toString(
          'base64'
        );
      } else if (!updateToBroadcast) {
        updateToBroadcast = this.encodeRoomStateBase64(room);
      }

      if (room.visibility !== params.visibility) {
        this.invalidateCachedRolesForSnippet(params.snippetId);
      }

      room.title = params.title;
      room.visibility = params.visibility;
      room.tagsText = params.tagsText;
      room.currentVersionId = params.currentVersionId;
      room.latestVersionNumber = params.latestVersionNumber;
      room.lastSavedContent = params.content;
      room.dirty = false;

      if (room.debouncedVersionTimer) {
        clearTimeout(room.debouncedVersionTimer);
        room.debouncedVersionTimer = null;
      }
    }

    if (params.visibility === 'private') {
      try {
        await this.revokeSnippetAccess(params.snippetId, {
          visibilityChanged: true,
          reason: 'Snippet changed to private',
        });
      } catch (err) {
        console.error('Failed to revoke access on visibility change:', err);
      }
    }

    const io = getIO();
    if (io) {
      const roomName = `snippet:${params.snippetId}`;
      if (params.contentChanged && updateToBroadcast) {
        io.to(roomName).emit('yjs:update', {
          snippetId: params.snippetId,
          update: updateToBroadcast,
          versionId: params.currentVersionId,
          latestVersionNumber: params.latestVersionNumber,
          title: params.title,
          tags: params.tags,
          actorId: params.actorId,
          username: params.actorUsername,
        });
      }

      // Strip content from snippet:updated to prevent leaking content over metadata events
      io.to(roomName).emit('snippet:updated', {
        snippetId: params.snippetId,
        title: params.title,
        visibility: params.visibility,
        tags: params.tags,
        tagsText: params.tagsText,
        currentVersionId: params.currentVersionId,
        latestVersionNumber: params.latestVersionNumber,
        actorId: params.actorId,
        username: params.actorUsername,
      });

      io.to(roomName).emit('snippet:invalidate', {
        snippetId: params.snippetId,
      });

      if (params.createdVersion) {
        io.to(roomName).emit('version:created', {
          snippetId: params.snippetId,
          version: params.createdVersion,
        });
      }
    }
  }

  public applyClientUpdate(
    room: ActiveSnippetRoom,
    updateBase64: string,
    editorUserId: string
  ): { content: string } {
    let updateBytes: Uint8Array;
    try {
      updateBytes = new Uint8Array(Buffer.from(updateBase64, 'base64'));
      if (updateBytes.byteLength === 0) {
        throw new Error('Empty Yjs update payload');
      }
      Y.applyUpdate(room.yDoc, updateBytes);
    } catch (err) {
      throw new AppError(400, 'INVALID_YJS_UPDATE', 'Failed to apply binary Yjs update', {
        cause: err,
      });
    }

    room.dirty = true;
    room.lastEditorId = editorUserId;

    // Schedule debounced autosave version snapshot if content changes settle
    if (room.debouncedVersionTimer) {
      clearTimeout(room.debouncedVersionTimer);
    }
    room.debouncedVersionTimer = setTimeout(() => {
      this.saveVersionSnapshot(room.snippetId, editorUserId, 'Live collaborative autosave', 'autosave').catch(
        (err) => {
          console.error(`Debounced autosave failed for snippet ${room.snippetId}:`, err);
        }
      );
    }, DEBOUNCED_VERSION_MS);
    if (room.debouncedVersionTimer.unref) {
      room.debouncedVersionTimer.unref();
    }

    return { content: this.getRoomContent(room) };
  }

  public async flushRoomStateToDb(snippetId: string): Promise<void> {
    const room = this.rooms.get(snippetId);
    if (!room || !room.dirty) return;

    const currentContent = this.getRoomContent(room);
    const yjsStateBase64 = this.encodeRoomStateBase64(room);
    room.dirty = false;

    await db
      .update(snippets)
      .set({
        currentContent,
        yjsState: yjsStateBase64,
        updatedAt: new Date(),
        searchVector: sql`
          setweight(to_tsvector('english', coalesce(${room.title}, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(${room.tagsText}, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(${currentContent}, '')), 'C')
        `,
      })
      .where(eq(snippets.id, snippetId));
  }

  public async saveVersionSnapshot(
    snippetId: string,
    authorId: string | null,
    summary: string = 'Collaborative snapshot',
    source: 'manual' | 'autosave' = 'manual'
  ): Promise<SnippetVersionDTO | null> {
    const room = await this.getOrLoadRoom(snippetId);
    const currentContent = this.getRoomContent(room);
    const yjsStateBase64 = this.encodeRoomStateBase64(room);

    if (source === 'autosave' && currentContent === room.lastSavedContent) {
      await this.flushRoomStateToDb(snippetId);
      return null;
    }

    const cleanSummary =
      sanitizePlainText(summary || '') ||
      (source === 'autosave' ? 'Collaborative autosave' : `Version ${room.latestVersionNumber + 1}`);

    const insertedVersion = await db.transaction(async (tx) => {
      // P2-2: Lock the snippet row to prevent race conditions during concurrent version creation
      await tx.execute(
        sql`SELECT id, latest_version_number FROM snippets WHERE id = ${room.snippetId} FOR UPDATE`
      );

      const [maxVerRow] = await tx
        .select({ maxVer: sql<number>`coalesce(max(${snippetVersions.versionNumber}), 0)` })
        .from(snippetVersions)
        .where(eq(snippetVersions.snippetId, room.snippetId));
      const nextVersionNumber = Math.max(room.latestVersionNumber, Number(maxVerRow.maxVer)) + 1;

      const [created] = await tx
        .insert(snippetVersions)
        .values({
          snippetId: room.snippetId,
          versionNumber: nextVersionNumber,
          authorId,
          content: currentContent,
          summary: cleanSummary,
          yjsState: yjsStateBase64,
          source,
        })
        .returning();

      await tx
        .update(snippets)
        .set({
          currentContent,
          currentVersionId: created.id,
          latestVersionNumber: nextVersionNumber,
          yjsState: yjsStateBase64,
          updatedAt: new Date(),
          searchVector: sql`
            setweight(to_tsvector('english', coalesce(${room.title}, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(${room.tagsText}, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(${currentContent}, '')), 'C')
          `,
        })
        .where(eq(snippets.id, room.snippetId));

      return created;
    });

    room.currentVersionId = insertedVersion.id;
    room.latestVersionNumber = insertedVersion.versionNumber;
    room.lastSavedContent = currentContent;
    room.dirty = false;

    if (room.debouncedVersionTimer) {
      clearTimeout(room.debouncedVersionTimer);
      room.debouncedVersionTimer = null;
    }

    let authorUsername: string | null = null;
    let authorDisplayName: string | null = null;
    if (authorId) {
      const [authorRow] = await db
        .select({ username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, authorId));
      authorUsername = authorRow?.username || null;
      authorDisplayName = authorRow?.displayName || null;

      domainEventBus.emitActivity({
        actorId: authorId,
        type: 'snippet.edited',
        snippetId: room.snippetId,
        visibility: room.visibility,
        metadata: {
          title: room.title,
          versionNumber: insertedVersion.versionNumber,
          summary: cleanSummary,
          source,
        },
      });
    }

    return {
      id: insertedVersion.id,
      snippetId: insertedVersion.snippetId,
      versionNumber: insertedVersion.versionNumber,
      authorId: insertedVersion.authorId,
      authorUsername,
      authorDisplayName,
      content: insertedVersion.content,
      summary: insertedVersion.summary,
      source: insertedVersion.source,
      createdAt: insertedVersion.createdAt,
    };
  }

  public async removeClientAndFlushIfEmpty(
    snippetId: string,
    socketId: string
  ): Promise<{ remainingClients: RoomClientPresence[]; roomEvicted: boolean }> {
    const room = this.rooms.get(snippetId);
    if (!room) {
      return { remainingClients: [], roomEvicted: false };
    }

    room.clients.delete(socketId);

    if (room.clients.size > 0) {
      return {
        remainingClients: Array.from(room.clients.values()),
        roomEvicted: false,
      };
    }

    // Room is now empty: clear timers, flush any unsaved Y.Doc edits & snapshot to DB, then evict
    if (room.periodicFlushTimer) {
      clearInterval(room.periodicFlushTimer);
      room.periodicFlushTimer = null;
    }
    if (room.debouncedVersionTimer) {
      clearTimeout(room.debouncedVersionTimer);
      room.debouncedVersionTimer = null;
    }

    try {
      const currentContent = this.getRoomContent(room);
      if (room.dirty || currentContent !== room.lastSavedContent) {
        if (currentContent !== room.lastSavedContent && room.lastEditorId) {
          await this.saveVersionSnapshot(
            snippetId,
            room.lastEditorId,
            'Autosaved on session close',
            'autosave'
          );
        } else {
          await this.flushRoomStateToDb(snippetId);
        }
      }
    } catch (err) {
      console.error(`Failed to flush empty room ${snippetId} to database:`, err);
    } finally {
      room.yDoc.destroy();
      this.rooms.delete(snippetId);
    }

    return {
      remainingClients: [],
      roomEvicted: true,
    };
  }

  public async removeSocketFromAllRooms(
    socketId: string
  ): Promise<Array<{ snippetId: string; remainingClients: RoomClientPresence[] }>> {
    const affected: Array<{ snippetId: string; remainingClients: RoomClientPresence[] }> = [];
    for (const [snippetId, room] of this.rooms.entries()) {
      if (room.clients.has(socketId)) {
        const { remainingClients } = await this.removeClientAndFlushIfEmpty(snippetId, socketId);
        affected.push({ snippetId, remainingClients });
      }
    }
    return affected;
  }

  /**
   * P0-4: Live socket access revocation on private/collaborator change.
   * Evaluates authorization for all connected sockets in the snippet room.
   * Kicks sockets who no longer have read access and updates effective roles for demoted/promoted clients.
   */
  public async revokeSnippetAccess(
    snippetId: string,
    options: {
      removedUserId?: string;
      demotedUserId?: string;
      newRole?: EffectiveSnippetRole;
      visibilityChanged?: boolean;
      reason?: string;
    } = {}
  ): Promise<void> {
    const io = getIO();
    if (!io) return;

    const roomName = `snippet:${snippetId}`;
    const room = this.rooms.get(snippetId);

    const [snippetRow] = await db
      .select({
        id: snippets.id,
        ownerId: snippets.ownerId,
        visibility: snippets.visibility,
      })
      .from(snippets)
      .where(eq(snippets.id, snippetId));

    if (!snippetRow) return;

    const collabs = await db
      .select({
        userId: snippetCollaborators.userId,
        role: snippetCollaborators.role,
      })
      .from(snippetCollaborators)
      .where(eq(snippetCollaborators.snippetId, snippetId));

    const collabMap = new Map(collabs.map((c) => [c.userId, c.role as CollaboratorRole]));

    const socketsInRoom = await io.in(roomName).fetchSockets();

    for (const s of socketsInRoom) {
      const actor = (s.data.user as AuthenticatedUser | null) || null;
      const collabRole = actor ? collabMap.get(actor.id) || null : null;
      const authResource: SnippetAuthorizationResource = {
        id: snippetRow.id,
        ownerId: snippetRow.ownerId,
        visibility: snippetRow.visibility as SnippetVisibility,
        collaboratorRole: collabRole,
      };

      const readDecision = evaluateAuthorization(actor, 'snippet:read', { snippet: authResource });

      if (!readDecision.allowed) {
        await s.leave(roomName);
        await this.removeClientAndFlushIfEmpty(snippetId, s.id);
        s.emit('snippet:access-revoked', {
          snippetId,
          reason: options.reason || 'You no longer have permission to access this snippet',
        });
      } else {
        const newEffectiveRole = readDecision.effectiveRole as EffectiveSnippetRole;
        if (room) {
          const client = room.clients.get(s.id);
          if (client) {
            client.role = newEffectiveRole;
            client.roleCached = true;
          }
        }
      }
    }

    const activeRoom = this.rooms.get(snippetId);
    if (activeRoom) {
      const remainingClients = Array.from(activeRoom.clients.values());
      io.to(roomName).emit('presence:state', {
        snippetId,
        members: remainingClients,
      });
    }
  }
}

export const yjsRoomHub = new YjsRoomHub();
