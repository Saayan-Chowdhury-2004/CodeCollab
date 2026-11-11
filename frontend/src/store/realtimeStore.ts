import { create } from 'zustand';
import { apiFetch, ApiClientError, refreshSessionTokens } from '../api/client.ts';
import { getSocket } from '../api/socket.ts';
import { useSnippetStore } from './snippetStore.ts';
import {
  ActivityDTO,
  ActivityEventType,
  CommentDTO,
  EffectiveSnippetRole,
  NotificationDTO,
  NotificationsPageDTO,
  PaginatedResult,
  PresenceMemberDTO,
  SnippetVersionDTO,
} from '../types/domain.ts';
import { isVirtualOrDevUser } from '../utils/format.ts';

export type CommentFilterMode = 'all' | 'unresolved' | 'outdated' | 'line';

interface RealtimeStoreState {
  isConnected: boolean;
  roomSnippetId: string | null;
  roomRole: EffectiveSnippetRole;
  members: PresenceMemberDTO[];
  lastSocketError: { code: string; message: string } | null;

  // Threaded Line Comments
  comments: CommentDTO[];
  isLoadingComments: boolean;
  selectedLineNumber: number | null;
  commentFilter: CommentFilterMode;

  // Activity Feeds (Global, Snippet, User)
  globalActivities: ActivityDTO[];
  globalNextCursor: string | null;
  globalHasMore: boolean;
  snippetActivities: ActivityDTO[];
  snippetNextCursor: string | null;
  snippetHasMore: boolean;
  userActivities: ActivityDTO[];
  userNextCursor: string | null;
  userHasMore: boolean;
  isLoadingActivities: boolean;
  activityTypeFilter: '' | ActivityEventType;

  // In-app Notifications
  notifications: NotificationDTO[];
  unreadCount: number;
  notificationsNextCursor: string | null;
  notificationsHasMore: boolean;
  isLoadingNotifications: boolean;
  liveToastNotification: NotificationDTO | null;

  // Actions
  initRealtimeListeners: () => void;
  clearSocketError: () => void;
  setSelectedLineNumber: (lineNumber: number | null) => void;
  setCommentFilter: (filter: CommentFilterMode) => void;
  setRoomPresence: (snippetId: string, members: PresenceMemberDTO[], role?: EffectiveSnippetRole) => void;
  updateMemberAwareness: (member: PresenceMemberDTO) => void;

  // Comments API
  fetchComments: (snippetId: string) => Promise<void>;
  createComment: (
    snippetId: string,
    input: { lineNumber?: number; parentId?: string | null; body: string; versionId?: string }
  ) => Promise<CommentDTO>;
  updateComment: (snippetId: string, commentId: string, body: string) => Promise<CommentDTO>;
  setCommentResolved: (snippetId: string, commentId: string, resolved: boolean) => Promise<CommentDTO>;
  deleteComment: (snippetId: string, commentId: string) => Promise<void>;

  // Activity API
  setActivityTypeFilter: (type: '' | ActivityEventType) => void;
  fetchGlobalActivities: (opts?: { append?: boolean }) => Promise<void>;
  fetchSnippetActivities: (snippetId: string, opts?: { append?: boolean }) => Promise<void>;
  fetchUserActivities: (userId: string, opts?: { append?: boolean }) => Promise<void>;

  // Notifications API
  fetchNotifications: (opts?: { append?: boolean; unreadOnly?: boolean }) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  dismissToast: () => void;

  // Viewer Write-Block Verification Helper
  triggerViewerWriteBlockTest: (snippetId: string) => Promise<{ blocked: boolean; code: string; message: string }>;
}

let listenersInitialized = false;

async function loadActivities(
  endpoint: string,
  filter: string | null,
  cursor: string | null,
  append: boolean,
  current: ActivityDTO[]
) {
  const params = new URLSearchParams({ limit: '15' });
  if (filter) params.set('type', filter);
  if (append && cursor) params.set('cursor', cursor);
  const data = await apiFetch<PaginatedResult<ActivityDTO>>(`${endpoint}?${params.toString()}`);
  const cleanItems = data.items.filter((act) => !isVirtualOrDevUser(act.actor?.username));
  return {
    items: append ? [...current, ...cleanItems] : cleanItems,
    nextCursor: data.nextCursor,
    hasMore: data.hasMore,
  };
}

export const useRealtimeStore = create<RealtimeStoreState>((set, get) => ({
  isConnected: false,
  roomSnippetId: null,
  roomRole: 'anonymous_viewer',
  members: [],
  lastSocketError: null,

  comments: [],
  isLoadingComments: false,
  selectedLineNumber: 1,
  commentFilter: 'all',

  globalActivities: [],
  globalNextCursor: null,
  globalHasMore: false,
  snippetActivities: [],
  snippetNextCursor: null,
  snippetHasMore: false,
  userActivities: [],
  userNextCursor: null,
  userHasMore: false,
  isLoadingActivities: false,
  activityTypeFilter: '',

  notifications: [],
  unreadCount: 0,
  notificationsNextCursor: null,
  notificationsHasMore: false,
  isLoadingNotifications: false,
  liveToastNotification: null,

  clearSocketError: () => set({ lastSocketError: null }),

  setSelectedLineNumber: (lineNumber) => set({ selectedLineNumber: lineNumber }),

  setCommentFilter: (filter) => set({ commentFilter: filter }),

  setRoomPresence: (snippetId, members, role) =>
    set((state) => ({
      roomSnippetId: snippetId,
      members: members.filter((m) => !isVirtualOrDevUser(m.username)),
      ...(role ? { roomRole: role } : { roomRole: state.roomRole }),
    })),

  updateMemberAwareness: (member) =>
    set((state) => {
      if (isVirtualOrDevUser(member.username)) return state;
      const exists = state.members.some((m) => m.socketId === member.socketId);
      const nextMembers = exists
        ? state.members.map((m) => (m.socketId === member.socketId ? member : m))
        : [...state.members, member];
      return { members: nextMembers };
    }),

  initRealtimeListeners: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;

    const socket = getSocket();

    socket.on('connect', () => {
      set({ isConnected: true });
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
    });

    socket.on('socket:error', async (err: { code: string; message: string }) => {
      if (err.code === 'TOKEN_EXPIRED') {
        const refreshed = await refreshSessionTokens();
        if (refreshed?.accessToken) {
          socket.auth = { token: refreshed.accessToken };
          socket.emit('auth:refresh', { token: refreshed.accessToken }, (ack: { ok: boolean }) => {
            if (ack?.ok) {
              set({ lastSocketError: null });
              const currentSnippetId = get().roomSnippetId;
              if (currentSnippetId) {
                socket.emit('snippet:join', { snippetId: currentSnippetId });
              }
            }
          });
          return;
        }
      }
      set({ lastSocketError: err });
    });

    socket.on(
      'presence:state',
      (payload: { snippetId: string; members: PresenceMemberDTO[] }) => {
        if (get().roomSnippetId === payload.snippetId) {
          set({ members: payload.members });
        }
      }
    );

    socket.on(
      'awareness:update',
      (payload: { snippetId: string; member: PresenceMemberDTO }) => {
        if (get().roomSnippetId === payload.snippetId) {
          get().updateMemberAwareness(payload.member);
        }
      }
    );

    socket.on(
      'comment:created',
      (payload: { snippetId: string; comment: CommentDTO }) => {
        if (get().roomSnippetId === payload.snippetId) {
          get().fetchComments(payload.snippetId);
        }
      }
    );

    socket.on(
      'comment:updated',
      (payload: { snippetId: string; comment: CommentDTO }) => {
        if (get().roomSnippetId === payload.snippetId) {
          get().fetchComments(payload.snippetId);
        }
      }
    );

    socket.on(
      'comment:resolved',
      (payload: { snippetId: string; comment: CommentDTO }) => {
        if (get().roomSnippetId === payload.snippetId) {
          get().fetchComments(payload.snippetId);
        }
      }
    );

    socket.on(
      'comment:deleted',
      (payload: { snippetId: string; commentId: string }) => {
        if (get().roomSnippetId === payload.snippetId) {
          get().fetchComments(payload.snippetId);
        }
      }
    );

    socket.on('activity:new', (activity: ActivityDTO) => {
      set((state) => {
        const nextGlobal =
          activity.visibility === 'public' &&
          !state.globalActivities.some((a) => a.id === activity.id)
            ? [activity, ...state.globalActivities]
            : state.globalActivities;

        const nextSnippet =
          activity.snippetId &&
          activity.snippetId === state.roomSnippetId &&
          !state.snippetActivities.some((a) => a.id === activity.id)
            ? [activity, ...state.snippetActivities]
            : state.snippetActivities;

        return {
          globalActivities: nextGlobal,
          snippetActivities: nextSnippet,
        };
      });
    });

    socket.on('notification:new', (notification: NotificationDTO) => {
      set((state) => {
        if (state.notifications.some((n) => n.id === notification.id)) {
          return state;
        }
        return {
          notifications: [notification, ...state.notifications],
          unreadCount: state.unreadCount + 1,
          liveToastNotification: notification,
        };
      });
    });

    socket.on('snippet:collaborators-updated', (payload: { snippetId: string }) => {
      const activeSnippet = useSnippetStore.getState().activeSnippet;
      if (activeSnippet && activeSnippet.id === payload.snippetId) {
        useSnippetStore.getState().refreshActiveSnippet();
      }
    });

    socket.on(
      'snippet:collaborator-updated',
      (payload: { snippetId: string; role: string }) => {
        const activeSnippet = useSnippetStore.getState().activeSnippet;
        if (activeSnippet && activeSnippet.id === payload.snippetId) {
          useSnippetStore.getState().refreshActiveSnippet();
          set({ lastSocketError: null });
          socket.emit('snippet:join', { snippetId: payload.snippetId });
        }
      }
    );

    socket.on('snippet:collaborator-removed', (payload: { snippetId: string }) => {
      const activeSnippet = useSnippetStore.getState().activeSnippet;
      if (activeSnippet && activeSnippet.id === payload.snippetId) {
        useSnippetStore.getState().refreshActiveSnippet();
        socket.emit('snippet:join', { snippetId: payload.snippetId });
      }
    });
  },

  fetchComments: async (snippetId) => {
    set({ isLoadingComments: true });
    try {
      const res = await apiFetch<{
        threads?: CommentDTO[];
        comments?: CommentDTO[];
        totalComments?: number;
      }>(`/api/snippets/${snippetId}/comments`);
      const raw = res.threads ?? res.comments ?? [];
      const cleanComments = raw
        .filter((thread) => !isVirtualOrDevUser(thread.author?.username))
        .map((thread) => ({
          ...thread,
          replies: (thread.replies || []).filter(
            (reply) => !isVirtualOrDevUser(reply.author?.username)
          ),
        }));
      set({
        comments: cleanComments,
        isLoadingComments: false,
      });
    } catch {
      set({ isLoadingComments: false });
    }
  },

  createComment: async (snippetId, input) => {
    const res = await apiFetch<{ comment: CommentDTO }>(
      `/api/snippets/${snippetId}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    await get().fetchComments(snippetId);
    return res.comment;
  },

  updateComment: async (snippetId, commentId, body) => {
    const res = await apiFetch<{ comment: CommentDTO }>(
      `/api/snippets/${snippetId}/comments/${commentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }
    );
    await get().fetchComments(snippetId);
    return res.comment;
  },

  setCommentResolved: async (snippetId, commentId, resolved) => {
    const action = resolved ? 'resolve' : 'unresolve';
    const res = await apiFetch<{ comment: CommentDTO }>(
      `/api/snippets/${snippetId}/comments/${commentId}/${action}`,
      {
        method: 'POST',
      }
    );
    await get().fetchComments(snippetId);
    return res.comment;
  },

  deleteComment: async (snippetId, commentId) => {
    await apiFetch(`/api/snippets/${snippetId}/comments/${commentId}`, {
      method: 'DELETE',
    });
    await get().fetchComments(snippetId);
  },

  setActivityTypeFilter: (type) => {
    set({ activityTypeFilter: type });
  },

  fetchGlobalActivities: async (opts = { append: false }) => {
    const { globalActivities, globalNextCursor, activityTypeFilter } = get();
    set({ isLoadingActivities: true });
    try {
      const res = await loadActivities('/api/activities/global', activityTypeFilter, globalNextCursor, Boolean(opts.append), globalActivities);
      set({ globalActivities: res.items, globalNextCursor: res.nextCursor, globalHasMore: res.hasMore, isLoadingActivities: false });
    } catch {
      set({ isLoadingActivities: false });
    }
  },

  fetchSnippetActivities: async (snippetId, opts = { append: false }) => {
    const { snippetActivities, snippetNextCursor, activityTypeFilter } = get();
    set({ isLoadingActivities: true });
    try {
      const res = await loadActivities(`/api/activities/snippets/${snippetId}`, activityTypeFilter, snippetNextCursor, Boolean(opts.append), snippetActivities);
      set({ snippetActivities: res.items, snippetNextCursor: res.nextCursor, snippetHasMore: res.hasMore, isLoadingActivities: false });
    } catch {
      set({ isLoadingActivities: false });
    }
  },

  fetchUserActivities: async (userId, opts = { append: false }) => {
    const { userActivities, userNextCursor, activityTypeFilter } = get();
    set({ isLoadingActivities: true });
    try {
      const res = await loadActivities(`/api/activities/users/${userId}`, activityTypeFilter, userNextCursor, Boolean(opts.append), userActivities);
      set({ userActivities: res.items, userNextCursor: res.nextCursor, userHasMore: res.hasMore, isLoadingActivities: false });
    } catch {
      set({ isLoadingActivities: false });
    }
  },

  fetchNotifications: async (opts = { append: false, unreadOnly: false }) => {
    const { notifications, notificationsNextCursor } = get();
    set({ isLoadingNotifications: true });
    try {
      const params = new URLSearchParams({ limit: '15' });
      if (opts.unreadOnly) params.set('unreadOnly', 'true');
      if (opts.append && notificationsNextCursor) {
        params.set('cursor', notificationsNextCursor);
      }

      const data = await apiFetch<NotificationsPageDTO>(
        `/api/notifications?${params.toString()}`
      );
      set({
        notifications: opts.append
          ? [...notifications, ...data.items]
          : data.items,
        unreadCount: data.unreadCount,
        notificationsNextCursor: data.nextCursor,
        notificationsHasMore: data.hasMore,
        isLoadingNotifications: false,
      });
    } catch {
      set({ isLoadingNotifications: false });
    }
  },

  markNotificationRead: async (id) => {
    try {
      const res = await apiFetch<{ notification: NotificationDTO }>(
        `/api/notifications/${id}/read`,
        { method: 'POST' }
      );
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? res.notification : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
    } catch {
      // Ignore error
    }
  },

  markAllNotificationsRead: async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      const nowIso = new Date().toISOString();
      set((state) => ({
        notifications: state.notifications.map((n) => ({
          ...n,
          readAt: n.readAt || nowIso,
        })),
        unreadCount: 0,
      }));
    } catch {
      // Ignore error
    }
  },

  dismissToast: () => set({ liveToastNotification: null }),

  triggerViewerWriteBlockTest: async (snippetId) => {
    const socket = getSocket();
    return new Promise((resolve) => {
      // Send a dummy base64 payload over yjs:update to prove server-side authorization blocks viewers
      socket.emit(
        'yjs:update',
        {
          snippetId,
          update: window.btoa('unauthorized-viewer-edit-attempt'),
        },
        (ack: {
          ok: boolean;
          error?: { code: string; message: string };
        }) => {
          if (!ack?.ok && ack?.error) {
            set({ lastSocketError: ack.error });
            resolve({
              blocked: true,
              code: ack.error.code,
              message: ack.error.message,
            });
          } else {
            resolve({
              blocked: false,
              code: 'ALLOWED',
              message: 'Write update was accepted by server',
            });
          }
        }
      );
    });
  },
}));
