import React, { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import * as Y from 'yjs';
import {
  AlertTriangle,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit3,
  Folder,
  GitCompare,
  Globe,
  History,
  Link2,
  Lock,
  Save,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import { getSocket } from '../../api/socket.ts';
import { useAuthStore } from '../../store/authStore.ts';
import { useRealtimeStore } from '../../store/realtimeStore.ts';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { useThemeStore } from '../../store/themeStore.ts';
import {
  EffectiveSnippetRole,
  PresenceMemberDTO,
  SnippetVersionDTO,
} from '../../types/domain.ts';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../../utils/binary.ts';
import { formatRoleLabel } from '../../utils/format.ts';
import { WorkspaceStatStrip } from './WorkspaceStatStrip.tsx';

interface CollaborativeMonacoWorkspaceProps {
  onOpenVersionHistoryModal: () => void;
  onOpenCollaboratorsModal: () => void;
  onOpenEditSnippetModal: () => void;
  onOpenRightPanel?: () => void;
  onOpenRightPanelTab?: (tab: 'comments' | 'versions' | 'collaborators' | 'activity') => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const CollaborativeMonacoWorkspace: React.FC<
  CollaborativeMonacoWorkspaceProps
> = ({
  onOpenVersionHistoryModal,
  onOpenCollaboratorsModal,
  onOpenEditSnippetModal,
  onOpenRightPanel,
  onOpenRightPanelTab,
  isSidebarOpen = true,
  onToggleSidebar,
}) => {
    const { user } = useAuthStore();
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    const {
      activeSnippet,
      isLoadingSnippet,
      snippetError,
      deleteSnippet,
      fetchVersions,
      syncActiveSnippetContentLocal,
    } = useSnippetStore();

    const {
      members,
      roomRole,
      comments,
      lastSocketError,
      clearSocketError,
      setSelectedLineNumber,
      setRoomPresence,
      updateMemberAwareness,
      fetchComments,
      fetchSnippetActivities,
      triggerViewerWriteBlockTest,
    } = useRealtimeStore();

    const [checkpointSummary, setCheckpointSummary] = useState('');
    const [showCheckpointInput, setShowCheckpointInput] = useState(false);
    const [isSavingCheckpoint, setIsSavingCheckpoint] = useState(false);
    const [checkpointBanner, setCheckpointBanner] = useState<string | null>(null);
    const [copiedLink, setCopiedLink] = useState(false);
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
    const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
    const [writeBlockProof, setWriteBlockProof] = useState<{
      code: string;
      message: string;
    } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isPresenceDropdownOpen, setIsPresenceDropdownOpen] = useState(false);
    const presenceRef = useRef<HTMLDivElement | null>(null);

    // Draggable layout tier:
    // - 'expanded': 3 tiles expanded downwards into detailed column tiles
    // - 'normal': compact tiles row + toolbar visible
    // - 'tiles-dismissed': dragging up first dismisses the 3 stat tiles, keeping toolbar buttons
    // - 'maximized': dragging a bit more up dismisses toolbar buttons as well
    type EditorLayoutTier = 'expanded' | 'normal' | 'tiles-dismissed' | 'maximized';
    const [layoutTier, setLayoutTier] = useState<EditorLayoutTier>('normal');
    const dragStartYRef = useRef<number | null>(null);
    const currentTierRef = useRef<EditorLayoutTier>('normal');
    currentTierRef.current = layoutTier;

    const handleDragStart = (e: React.PointerEvent) => {
      e.preventDefault();
      dragStartYRef.current = e.clientY;
      const initialTier = currentTierRef.current;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (dragStartYRef.current === null) return;
        const deltaY = moveEvent.clientY - dragStartYRef.current;

        if (initialTier === 'normal') {
          if (deltaY > 35) {
            setLayoutTier('expanded');
          } else if (deltaY < -75) {
            setLayoutTier('maximized');
          } else if (deltaY < -25) {
            setLayoutTier('tiles-dismissed');
          } else {
            setLayoutTier('normal');
          }
        } else if (initialTier === 'expanded') {
          if (deltaY < -110) {
            setLayoutTier('maximized');
          } else if (deltaY < -65) {
            setLayoutTier('tiles-dismissed');
          } else if (deltaY < -25) {
            setLayoutTier('normal');
          } else {
            setLayoutTier('expanded');
          }
        } else if (initialTier === 'tiles-dismissed') {
          if (deltaY < -40) {
            setLayoutTier('maximized');
          } else if (deltaY > 60) {
            setLayoutTier('expanded');
          } else if (deltaY > 20) {
            setLayoutTier('normal');
          } else {
            setLayoutTier('tiles-dismissed');
          }
        } else if (initialTier === 'maximized') {
          if (deltaY > 100) {
            setLayoutTier('expanded');
          } else if (deltaY > 55) {
            setLayoutTier('normal');
          } else if (deltaY > 20) {
            setLayoutTier('tiles-dismissed');
          } else {
            setLayoutTier('maximized');
          }
        }
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        if (dragStartYRef.current !== null) {
          const deltaY = upEvent.clientY - dragStartYRef.current;
          // No clicking to toggle. Manual drag only.
          if (Math.abs(deltaY) >= 10) {
            if (initialTier === 'normal') {
              if (deltaY > 30) setLayoutTier('expanded');
              else if (deltaY < -70) setLayoutTier('maximized');
              else if (deltaY < -20) setLayoutTier('tiles-dismissed');
            } else if (initialTier === 'expanded') {
              if (deltaY < -100) setLayoutTier('maximized');
              else if (deltaY < -60) setLayoutTier('tiles-dismissed');
              else if (deltaY < -20) setLayoutTier('normal');
            } else if (initialTier === 'tiles-dismissed') {
              if (deltaY < -30) setLayoutTier('maximized');
              else if (deltaY > 50) setLayoutTier('expanded');
              else if (deltaY > 15) setLayoutTier('normal');
            } else if (initialTier === 'maximized') {
              if (deltaY > 90) setLayoutTier('expanded');
              else if (deltaY > 50) setLayoutTier('normal');
              else if (deltaY > 15) setLayoutTier('tiles-dismissed');
            }
          }
        }
        dragStartYRef.current = null;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    };

    // Close presence dropdown on outside click
    useEffect(() => {
      const handleOutsideClick = (e: MouseEvent) => {
        if (presenceRef.current && !presenceRef.current.contains(e.target as Node)) {
          setIsPresenceDropdownOpen(false);
        }
      };
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    // Monaco & Yjs refs
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
    const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
    const editorContainerRef = useRef<HTMLDivElement | null>(null);
    const yDocRef = useRef<Y.Doc | null>(null);
    const isApplyingRemoteRef = useRef(false);
    const remoteDecorationsRef = useRef<string[]>([]);
    const commentDecorationsRef = useRef<string[]>([]);

    const effectiveRole: EffectiveSnippetRole = (() => {
      if (activeSnippet?.effectiveRole === 'owner' || activeSnippet?.effectiveRole === 'admin') {
        return activeSnippet.effectiveRole;
      }
      if (roomRole && roomRole !== 'anonymous_viewer') {
        return roomRole;
      }
      return activeSnippet?.effectiveRole || 'anonymous_viewer';
    })();

    const canEdit =
      effectiveRole === 'admin' ||
      effectiveRole === 'owner' ||
      effectiveRole === 'editor';

    const canManageCollaborators =
      effectiveRole === 'admin' || effectiveRole === 'owner';

    const canDelete = effectiveRole === 'admin' || effectiveRole === 'owner';

    const handleShareLink = () => {
      if (!activeSnippet) return;
      const link = `${window.location.origin}/snippets/${activeSnippet.id}`;
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(link).catch(() => { });
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    };

    // Join Socket.io room & initialize Y.Doc whenever activeSnippet.id or user changes
    useEffect(() => {
      if (!activeSnippet) return;
      const snippetId = activeSnippet.id;
      const socket = getSocket();

      setWriteBlockProof(null);
      clearSocketError();

      // Fetch comments and snippet activities for this snippet
      fetchComments(snippetId);
      fetchSnippetActivities(snippetId, { append: false });

      const yDoc = new Y.Doc();
      yDocRef.current = yDoc;
      const yText = yDoc.getText('monaco');

      // Listen to local Y.Doc updates and emit over Socket.io
      const handleYDocUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === 'remote' || origin === 'init') return;
        const base64Update = uint8ArrayToBase64(update);
        socket.emit('yjs:update', {
          snippetId,
          update: base64Update,
        });
      };

      yDoc.on('update', handleYDocUpdate);

      // Handle initial room state
      const handleYjsInit = (payload: {
        snippetId: string;
        state: string;
        content: string;
        versionId: string | null;
        latestVersionNumber: number;
        role: EffectiveSnippetRole;
        members: PresenceMemberDTO[];
      }) => {
        if (payload.snippetId !== snippetId) return;
        try {
          isApplyingRemoteRef.current = true;
          const stateBytes = base64ToUint8Array(payload.state);
          Y.applyUpdate(yDoc, stateBytes, 'init');
          const syncedText = yText.toString() || payload.content;
          syncActiveSnippetContentLocal(
            syncedText,
            payload.latestVersionNumber,
            payload.versionId,
            { effectiveRole: payload.role }
          );
          if (editorRef.current) {
            const model = editorRef.current.getModel();
            if (model && model.getValue() !== syncedText) {
              model.setValue(syncedText);
            }
          }
        } finally {
          isApplyingRemoteRef.current = false;
        }
        setRoomPresence(payload.snippetId, payload.members, payload.role);
        if (payload.role !== 'anonymous_viewer' && payload.role !== 'viewer') {
          clearSocketError();
        }
      };

      // Handle inbound remote Yjs binary diffs from peers
      const handleYjsUpdate = (payload: {
        snippetId: string;
        update: string;
      }) => {
        if (payload.snippetId !== snippetId) return;
        try {
          isApplyingRemoteRef.current = true;
          const updateBytes = base64ToUint8Array(payload.update);
          Y.applyUpdate(yDoc, updateBytes, 'remote');
          const newText = yText.toString();
          syncActiveSnippetContentLocal(newText);
          if (editorRef.current) {
            const model = editorRef.current.getModel();
            if (model && model.getValue() !== newText) {
              const currentPosition = editorRef.current.getPosition();
              model.setValue(newText);
              if (currentPosition) {
                editorRef.current.setPosition(currentPosition);
              }
            }
          }
        } finally {
          isApplyingRemoteRef.current = false;
        }
      };

      // Presence & awareness updates
      const handlePresenceState = (payload: {
        snippetId: string;
        members: PresenceMemberDTO[];
      }) => {
        if (payload.snippetId === snippetId) {
          setRoomPresence(payload.snippetId, payload.members);
        }
      };

      const handleAwarenessUpdate = (payload: {
        snippetId: string;
        member: PresenceMemberDTO;
      }) => {
        if (payload.snippetId === snippetId) {
          updateMemberAwareness(payload.member);
        }
      };

      // Version checkpoint created event
      const handleVersionCreated = (payload: {
        snippetId: string;
        version: SnippetVersionDTO;
      }) => {
        if (payload.snippetId === snippetId) {
          setCheckpointBanner(
            `Version snapshot v${payload.version.versionNumber} saved (${payload.version.summary})`
          );
          setTimeout(() => setCheckpointBanner(null), 4000);
          fetchVersions(snippetId);
        }
      };

      socket.on('yjs:init', handleYjsInit);
      socket.on('yjs:update', handleYjsUpdate);
      socket.on('presence:state', handlePresenceState);
      socket.on('awareness:update', handleAwarenessUpdate);
      socket.on('snippet:version-created', handleVersionCreated);

      const handleReconnect = () => {
        socket.emit('snippet:join', { snippetId });
      };
      socket.on('connect', handleReconnect);

      socket.emit('snippet:join', { snippetId });

      return () => {
        socket.off('yjs:init', handleYjsInit);
        socket.off('yjs:update', handleYjsUpdate);
        socket.off('presence:state', handlePresenceState);
        socket.off('awareness:update', handleAwarenessUpdate);
        socket.off('snippet:version-created', handleVersionCreated);
        socket.off('connect', handleReconnect);
        socket.emit('snippet:leave', { snippetId });
        yDoc.destroy();
        yDocRef.current = null;
      };
    }, [activeSnippet?.id, user?.id]);

    // Update peer cursor decorations
    useEffect(() => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;

      const decorations: Parameters<typeof editor.deltaDecorations>[1] = [];
      const socket = getSocket();

      members.forEach((m) => {
        if (m.socketId === socket.id || !m.cursor) return;
        const { lineNumber, column } = m.cursor;
        decorations.push({
          range: new monaco.Range(lineNumber, column, lineNumber, column),
          options: {
            className: 'border-l-2',
            hoverMessage: {
              value: `**${m.displayName}** (${formatRoleLabel(m.role)})`,
            },
          },
        });
      });

      remoteDecorationsRef.current = editor.deltaDecorations(
        remoteDecorationsRef.current,
        decorations
      );
    }, [members]);

    // Highlight lines in editor with active review comments
    useEffect(() => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;

      const lineDecorations = comments.map((thread) => {
        const line = thread.lineNumber;
        const isOutdated = thread.isOutdated;
        const isResolved = thread.resolved;
        return {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: isOutdated
              ? 'bg-[var(--surface-raised)]/20'
              : isResolved
                ? 'bg-[var(--surface-raised)]/10'
                : 'bg-[var(--surface-raised)]/40',
            linesDecorationsClassName: isOutdated
              ? 'border-l-2 border-[var(--ink-muted)]'
              : isResolved
                ? 'border-l-2 border-[var(--border)]'
                : 'border-l-2 border-[var(--ink)]',
            hoverMessage: {
              value: `Line ${line}: **${thread.author.displayName}**: ${thread.body}${isOutdated ? ' *(OUTDATED)*' : ''
                }`,
            },
          },
        };
      });

      commentDecorationsRef.current = editor.deltaDecorations(
        commentDecorationsRef.current,
        lineDecorations
      );
    }, [comments]);

    // Keep Monaco's inner layout sized precisely to its container on any banner or container resize
    useEffect(() => {
      const container = editorContainerRef.current;
      if (!container) return;
      const observer = new ResizeObserver(() => {
        editorRef.current?.layout();
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const timer = setTimeout(() => {
        editorRef.current?.layout();
      }, 10);
      return () => clearTimeout(timer);
    }, [
      writeBlockProof,
      lastSocketError,
      checkpointBanner,
      showCheckpointInput,
      isDescriptionExpanded,
    ]);

    const handleEditorDidMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Emit live cursor & selection awareness on cursor position change, and anchor line for review comments
      editor.onDidChangeCursorPosition((e) => {
        setCursorPos({ line: e.position.lineNumber, column: e.position.column });
        setSelectedLineNumber(e.position.lineNumber);
        const currentSnippetId = useSnippetStore.getState().activeSnippet?.id;
        if (!currentSnippetId) return;

        const sel = editor.getSelection();
        getSocket().emit('awareness:update', {
          snippetId: currentSnippetId,
          cursor: {
            lineNumber: e.position.lineNumber,
            column: e.position.column,
          },
          selection: sel
            ? {
              startLineNumber: sel.startLineNumber,
              startColumn: sel.startColumn,
              endLineNumber: sel.endLineNumber,
              endColumn: sel.endColumn,
            }
            : null,
        });
      });

      // Clicking on any line or gutter in the editor selects and anchors that line for comments
      editor.onMouseDown((e) => {
        const line = e.target.position?.lineNumber;
        if (line) {
          setSelectedLineNumber(line);
        }
        if (
          e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
          e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        ) {
          if (line && onOpenRightPanel) {
            onOpenRightPanel();
          }
        }
      });
    };

    // Propagate local Monaco text edits into Y.Doc yText
    const handleEditorChange = (newValue: string | undefined) => {
      if (isApplyingRemoteRef.current || newValue === undefined) return;
      if (!canEdit || !activeSnippet) return;

      const yDoc = yDocRef.current;
      if (!yDoc) return;
      const yText = yDoc.getText('monaco');
      const oldValue = yText.toString();
      if (newValue === oldValue) return;

      let start = 0;
      while (
        start < oldValue.length &&
        start < newValue.length &&
        oldValue[start] === newValue[start]
      ) {
        start++;
      }
      let oldEnd = oldValue.length;
      let newEnd = newValue.length;
      while (
        oldEnd > start &&
        newEnd > start &&
        oldValue[oldEnd - 1] === newValue[newEnd - 1]
      ) {
        oldEnd--;
        newEnd--;
      }

      const deleteCount = oldEnd - start;
      const insertText = newValue.slice(start, newEnd);

      yDoc.transact(() => {
        if (deleteCount > 0) {
          yText.delete(start, deleteCount);
        }
        if (insertText.length > 0) {
          yText.insert(start, insertText);
        }
      }, 'local');

      syncActiveSnippetContentLocal(newValue);
    };

    const handleSaveCheckpoint = (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeSnippet || !canEdit) return;
      setIsSavingCheckpoint(true);
      const socket = getSocket();
      socket.emit(
        'snippet:save-version',
        {
          snippetId: activeSnippet.id,
          summary:
            checkpointSummary.trim() || 'Manual collaborative checkpoint',
        },
        (ack: { ok: boolean; version?: SnippetVersionDTO }) => {
          setIsSavingCheckpoint(false);
          if (ack?.ok) {
            setCheckpointSummary('');
            setShowCheckpointInput(false);
          }
        }
      );
    };

    const handleProveViewerBlocked = async () => {
      if (!activeSnippet) return;
      const result = await triggerViewerWriteBlockTest(activeSnippet.id);
      setWriteBlockProof({
        code: result.code,
        message: result.message,
      });
    };

    const handleDeleteConfirm = async () => {
      if (!activeSnippet) return;
      await deleteSnippet(activeSnippet.id);
      setConfirmDelete(false);
    };

    if (isLoadingSnippet) {
      return (
        <main className="flex-1 bg-[var(--surface)] flex flex-col items-center justify-center p-6 text-[var(--ink-muted)]">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--ink)] border-t-transparent animate-spin mb-3" />
          <span className="text-xs">Loading snippet...</span>
        </main>
      );
    }

    if (snippetError) {
      return (
        <main className="flex-1 bg-[var(--surface)] flex items-center justify-center p-6">
          <div className="max-w-md p-4 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--ink)]">
            <div className="font-semibold mb-1">Cannot Open Snippet</div>
            <p className="text-[var(--ink-muted)]">{snippetError}</p>
          </div>
        </main>
      );
    }

    if (!activeSnippet) {
      return (
        <main className="flex-1 bg-[var(--surface)] flex flex-col items-center justify-center p-6 text-[var(--ink-muted)] text-center">
          <div className="w-12 h-12 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--ink-muted)] mb-3">
            <History className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-[var(--ink)]">No snippet selected</p>
          <p className="text-xs text-[var(--ink-muted)] mt-1 max-w-sm">
            Select a snippet from the sidebar on the left or create a new one to begin editing.
          </p>
        </main>
      );
    }

    const totalLines = Math.max(
      1,
      activeSnippet.currentContent.split(/\r?\n/).length
    );

    const displayedMembers = members.slice(0, 4);
    const overflowMembersCount = Math.max(0, members.length - 4);

    const readOnlyTooltip = user
      ? 'Read-only. Sign in as an editor to make changes.'
      : 'Sign in to edit or comment';

    const openThreadsCount = comments.filter((c) => !c.resolved).length;
    const resolvedThreadsCount = comments.filter((c) => c.resolved).length;

    return (
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden p-3 sm:p-4 gap-3 bg-transparent select-none">
        {/* 1. Title Block & Header Metadata */}
        <div className="flex flex-col gap-1.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {!isSidebarOpen && onToggleSidebar && (
                <button
                  type="button"
                  onClick={onToggleSidebar}
                  aria-label="Expand sidebar"
                  title="Expand sidebar (>)"
                  className="p-1.5 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] border border-[var(--border)] transition-colors focus-visible:outline-none focus-ring-visible shrink-0"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                disabled={!canEdit}
                onClick={canEdit ? onOpenEditSnippetModal : undefined}
                title={canEdit ? 'Click to edit snippet details' : activeSnippet.title}
                className={`text-2xl sm:text-3xl font-light text-[var(--ink)] tracking-tight truncate text-left focus-visible:outline-none focus-ring-visible ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'
                  }`}
              >
                {activeSnippet.title}
              </button>
            </div>

            {/* Top Right: Active Collaborators Circular Button & Dropdown */}
            <div className="relative shrink-0" ref={presenceRef}>
              <button
                type="button"
                onClick={() => setIsPresenceDropdownOpen((v) => !v)}
                aria-label="View active viewers & contributors"
                title="Active collaborators (click to view)"
                className="flex items-center -space-x-2 p-1 rounded-full hover:ring-2 hover:ring-[var(--border)] transition-all focus-visible:outline-none focus-ring-visible cursor-pointer"
              >
                {displayedMembers.map((m) => (
                  <div
                    key={m.socketId}
                    className="w-8 h-8 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink)] flex items-center justify-center text-xs font-semibold shadow-raised"
                    title={`${m.displayName} (@${m.username})`}
                  >
                    {m.displayName.charAt(0).toUpperCase()}
                  </div>
                ))}
                {overflowMembersCount > 0 && (
                  <div className="w-8 h-8 rounded-full border border-[var(--border)] bg-[var(--surface-overlay)] text-[var(--ink-muted)] flex items-center justify-center text-xs font-mono font-medium shadow-xs">
                    +{overflowMembersCount}
                  </div>
                )}
              </button>

              {/* Viewers & Contributors Dropdown */}
              {isPresenceDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 popover-surface rounded-2xl shadow-2xl py-2 z-50 text-xs">
                  <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                      <Users className="w-3.5 h-3.5 text-[var(--ink)]" />
                      <span>Active Collaborators</span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--ink-muted)] bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-0.5 rounded-full">
                      {members.length} online
                    </span>
                  </div>

                  <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border)]">
                    {members.length > 0 ? (
                      members.map((m) => {
                        const isCurrentUser =
                          m.socketId === getSocket().id ||
                          (user && m.userId === user.id);

                        return (
                          <div
                            key={m.socketId}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-[var(--surface-raised)]/50 transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink)] flex items-center justify-center text-[10px] font-semibold shrink-0 shadow-xs">
                                {m.displayName.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-[var(--ink)] truncate flex items-center gap-1">
                                  <span>{m.displayName}</span>
                                  {isCurrentUser && (
                                    <span className="text-[10px] text-[var(--ink-muted)] font-mono">(you)</span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-[var(--ink-muted)] truncate">
                                  @{m.username}
                                  {m.cursor ? ` · Ln ${m.cursor.lineNumber}` : ''}
                                </div>
                              </div>
                            </div>

                            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink-muted)] shrink-0">
                              {formatRoleLabel(m.role)}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-xs text-[var(--ink-muted)]">
                        No active collaborators online.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Muted description on one line (expands on click) */}
          {activeSnippet.description && (
            <div
              onClick={() => setIsDescriptionExpanded((v) => !v)}
              title="Click to expand/collapse full description"
              className="cursor-pointer text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors flex items-center gap-1.5"
            >
              <p className={isDescriptionExpanded ? 'leading-relaxed' : 'truncate'}>
                {activeSnippet.description}
              </p>
              {isDescriptionExpanded ? (
                <ChevronUp className="w-3.5 h-3.5 shrink-0 opacity-70" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
              )}
            </div>
          )}
        </div>

        {/* 2. Stat Strip in Reference Style with Pop-out/Pop-in transition */}
        <div
          className={`transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] transform-gpu origin-top ${
            layoutTier === 'tiles-dismissed' || layoutTier === 'maximized'
              ? 'opacity-0 scale-95 -translate-y-2 max-h-0 pointer-events-none overflow-hidden my-0 py-0'
              : layoutTier === 'expanded'
              ? 'opacity-100 scale-100 translate-y-0 max-h-72 pointer-events-auto'
              : 'opacity-100 scale-100 translate-y-0 max-h-28 pointer-events-auto'
          }`}
        >
          <WorkspaceStatStrip
            versionNumber={activeSnippet.latestVersionNumber}
            openThreadsCount={openThreadsCount}
            resolvedThreadsCount={resolvedThreadsCount}
            collaboratorsCount={activeSnippet.collaborators.length + 1}
            onlineCount={members.length}
            isExpanded={layoutTier === 'expanded'}
            versionSummary={
              activeSnippet.currentContent
                ? `${activeSnippet.currentContent.split('\n').length} lines · v${activeSnippet.latestVersionNumber} active`
                : undefined
            }
            onOpenHistory={() => {
              if (onOpenRightPanelTab) onOpenRightPanelTab('versions');
              else onOpenRightPanel?.();
            }}
            onOpenCollaborators={() => {
              if (onOpenRightPanelTab) onOpenRightPanelTab('collaborators');
              else onOpenRightPanel?.();
            }}
            onOpenComments={() => {
              if (onOpenRightPanelTab) onOpenRightPanelTab('comments');
              else onOpenRightPanel?.();
            }}
          />
        </div>

        {/* 3. Toolbar Row: History, Share, Collaborators, Save version */}
        <div
          className={`transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] transform-gpu origin-top flex items-center justify-between gap-3 shrink-0 py-1 ${
            layoutTier === 'maximized'
              ? 'opacity-0 scale-95 -translate-y-2 max-h-0 pointer-events-none overflow-hidden my-0 py-0'
              : 'opacity-100 scale-100 translate-y-0 max-h-20 pointer-events-auto'
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary Action: Save Version (when canEdit) */}
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowCheckpointInput((v) => !v)}
                aria-label="Save version snapshot"
                className="bg-[var(--ink)] text-[var(--ink-contrast)] shadow-raised rounded-[14px] px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity focus-visible:outline-none focus-ring-visible cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Version</span>
              </button>
            )}

            {/* Secondary Actions */}
            <button
              type="button"
              onClick={onOpenVersionHistoryModal}
              aria-label="Version history and diff"
              className="border border-[var(--border)] px-3 py-1.5 rounded-[14px] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-ring-visible cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              <span>History</span>
            </button>

            <button
              type="button"
              onClick={handleShareLink}
              aria-label="Copy snippet link"
              title={copiedLink ? 'Copied link!' : 'Copy snippet link'}
              className="border border-[var(--border)] px-3 py-1.5 rounded-[14px] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-ring-visible cursor-pointer"
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-[var(--ink)]" />
              ) : (
                <Share2 className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              )}
              <span>{copiedLink ? 'Copied!' : 'Share'}</span>
            </button>

            <button
              type="button"
              onClick={onOpenCollaboratorsModal}
              aria-label={`Collaborators (${activeSnippet.collaborators.length})`}
              className="border border-[var(--border)] px-3 py-1.5 rounded-[14px] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-ring-visible cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              <span>Collaborators ({activeSnippet.collaborators.length})</span>
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={onOpenEditSnippetModal}
                aria-label="Edit snippet info"
                className="border border-[var(--border)] px-3 py-1.5 rounded-[14px] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-ring-visible cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                <span>Edit Details</span>
              </button>
            )}

            {canDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-1.5 bg-[var(--surface-raised)] border border-[var(--border)] px-2.5 py-1 rounded-[14px] text-xs">
                  <span className="text-[11px] text-[var(--ink)] font-medium">Delete?</span>
                  <button
                    type="button"
                    onClick={handleDeleteConfirm}
                    className="text-[11px] font-semibold text-[var(--ink-contrast)] bg-[var(--ink)] px-2.5 py-0.5 rounded-lg shadow-raised cursor-pointer"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-[11px] text-[var(--ink-muted)] px-1 hover:text-[var(--ink)] cursor-pointer"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete snippet"
                  title="Delete snippet"
                  className="p-1.5 rounded-[14px] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors focus-visible:outline-none focus-ring-visible cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        </div>

        {/* Version Checkpoint Input Bar */}
        {showCheckpointInput && canEdit && (
          <form
            onSubmit={handleSaveCheckpoint}
            className="flex items-center gap-2 px-4 py-2 rounded-2xl popover-surface shadow-xs"
          >
            <input
              type="text"
              value={checkpointSummary}
              onChange={(e) => setCheckpointSummary(e.target.value)}
              placeholder="Describe version changes (e.g. Added input validation)..."
              className="flex-1 bg-[var(--surface-raised)] border border-[var(--border)] rounded-[12px] px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
            />
            <button
              type="submit"
              disabled={isSavingCheckpoint}
              className="px-3.5 py-1.5 rounded-[12px] bg-[var(--ink)] text-[var(--ink-contrast)] text-xs font-medium hover:opacity-90 transition-opacity"
            >
              {isSavingCheckpoint ? 'Saving...' : 'Commit Version'}
            </button>
            <button
              type="button"
              onClick={() => setShowCheckpointInput(false)}
              className="px-2.5 py-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              Cancel
            </button>
          </form>
        )}

        {/* Checkpoint Toast Banner */}
        {checkpointBanner && (
          <div className="px-4 py-2 bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl text-xs text-[var(--ink)] flex items-center gap-2">
            <BookmarkCheck className="w-4 h-4 text-[var(--ink)] shrink-0" />
            <span>{checkpointBanner}</span>
          </div>
        )}

        {/* Socket Error or Write-Block Rejection Banner */}
        {(writeBlockProof || lastSocketError) && (
          <div className="px-4 py-2 bg-[var(--surface-raised)] border border-[var(--border)] rounded-2xl flex items-center justify-between gap-2 text-xs text-[var(--ink)]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[var(--ink-muted)] shrink-0" />
              <span>
                Server rejected action [{writeBlockProof?.code || lastSocketError?.code}]:{' '}
                {writeBlockProof?.message || lastSocketError?.message}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setWriteBlockProof(null);
                clearSocketError();
              }}
              className="text-[11px] text-[var(--ink)] font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 4. Rounded Editor Frame with Invisible Draggable Top Edge */}
        <div className="flex-1 rounded-[20px] overflow-hidden border border-[var(--border)] shadow-inset bg-[var(--editor-bg)] flex flex-col min-h-0 relative transition-all duration-300">
          {/* Invisible Top Edge Draggable Hit Area (Manual Drag Only, No Strip) */}
          <div
            role="separator"
            aria-label="Drag editor top edge to adjust view"
            onPointerDown={handleDragStart}
            className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize z-20 select-none"
          />

          {/* Monaco Editor Surface */}
          <div ref={editorContainerRef} className="flex-1 relative min-h-0 overflow-hidden">
            <Editor
                height="100%"
                theme={resolvedTheme === 'dark' ? 'codecollab-dark' : 'codecollab-light'}
                language={
                  activeSnippet.language === 'tsx' || activeSnippet.language === 'jsx'
                    ? 'typescript'
                    : activeSnippet.language
                }
                value={activeSnippet.currentContent}
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                options={{
                  readOnly: !canEdit,
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineHeight: 20,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  lineNumbers: 'on',
                  glyphMargin: true,
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  padding: { top: 8, bottom: 8 },
                }}
              />
            </div>

            {/* Bottom Status Bar */}
            <div className="h-8 border-t border-[var(--border)] bg-[var(--surface-raised)]/30 px-3 sm:px-4 flex items-center justify-between text-xs text-[var(--ink-muted)] shrink-0 select-none">
              <div className="flex items-center gap-3">
                <span>@{activeSnippet.owner.username}</span>
                <span>·</span>
                <span>{totalLines} lines</span>
                <span>·</span>
                <span>
                  Ln {cursorPos.line}, Col {cursorPos.column}
                </span>
                <span>·</span>
                <span className="capitalize">{activeSnippet.language}</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  {canEdit ? (
                    <span className="text-[var(--ink)]">Editable</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[var(--ink-muted)]">
                      <Lock className="w-3 h-3" />
                      <span>Read-only</span>
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onOpenVersionHistoryModal}
                  className="text-[var(--ink)] hover:underline flex items-center gap-1 focus-visible:outline-none focus-visible:underline"
                >
                  <GitCompare className="w-3 h-3 text-[var(--ink-muted)]" />
                  <span>Compare versions</span>
                </button>
              </div>
            </div>
          </div>
        </main>
    );
  };
