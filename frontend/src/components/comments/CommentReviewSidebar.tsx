import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CornerDownRight,
  Edit2,
  GitBranch,
  GitCompare,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.ts';
import {
  CommentFilterMode,
  useRealtimeStore,
} from '../../store/realtimeStore.ts';
import { useSnippetStore } from '../../store/snippetStore.ts';
import { CommentDTO } from '../../types/domain.ts';
import { formatRelativeTime, formatRoleLabel } from '../../utils/format.ts';

export type SidebarTabMode = 'comments' | 'versions' | 'collaborators' | 'activity';

export interface CommentReviewSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  activeTab?: SidebarTabMode;
  onTabChange?: (tab: SidebarTabMode) => void;
  onOpenVersionHistoryModal?: () => void;
  onOpenCollaboratorsModal?: () => void;
}

export const CommentReviewSidebar: React.FC<CommentReviewSidebarProps> = ({
  isOpen = true,
  onClose,
  activeTab: propActiveTab,
  onTabChange: propOnTabChange,
  onOpenVersionHistoryModal,
  onOpenCollaboratorsModal,
}) => {
  const { user } = useAuthStore();
  const {
    activeSnippet,
    versions,
    isLoadingVersions,
    fetchVersions,
    restoreVersion,
    removeCollaborator,
  } = useSnippetStore();
  const {
    comments,
    isLoadingComments,
    selectedLineNumber,
    commentFilter,
    snippetActivities,
    snippetHasMore,
    setSelectedLineNumber,
    setCommentFilter,
    createComment,
    updateComment,
    setCommentResolved,
    deleteComment,
    fetchSnippetActivities,
  } = useRealtimeStore();

  const [internalTab, setInternalTab] = useState<SidebarTabMode>('comments');
  const activeTab = propActiveTab ?? internalTab;
  const setActiveTab = (tab: SidebarTabMode) => {
    setInternalTab(tab);
    propOnTabChange?.(tab);
    if (tab === 'versions' && activeSnippet) {
      fetchVersions(activeSnippet.id, { append: false });
    } else if (tab === 'activity' && activeSnippet) {
      fetchSnippetActivities(activeSnippet.id, { append: false });
    }
  };

  useEffect(() => {
    if (activeTab === 'versions' && activeSnippet) {
      fetchVersions(activeSnippet.id, { append: false });
    }
  }, [activeTab, activeSnippet?.id]);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});

  const ribbonRef = React.useRef<HTMLDivElement>(null);
  const isDraggingRibbonRef = React.useRef(false);
  const startXRef = React.useRef(0);
  const scrollLeftRef = React.useRef(0);
  const hasDraggedRef = React.useRef(false);
  const [isDraggingRibbon, setIsDraggingRibbon] = useState(false);

  const handleRibbonMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ribbonRef.current) return;
    isDraggingRibbonRef.current = true;
    hasDraggedRef.current = false;
    startXRef.current = e.pageX - ribbonRef.current.offsetLeft;
    scrollLeftRef.current = ribbonRef.current.scrollLeft;
  };

  const handleRibbonMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRibbonRef.current || !ribbonRef.current) return;
    const x = e.pageX - ribbonRef.current.offsetLeft;
    const walk = x - startXRef.current;
    if (Math.abs(walk) > 3) {
      if (!hasDraggedRef.current) {
        hasDraggedRef.current = true;
        setIsDraggingRibbon(true);
      }
      ribbonRef.current.scrollLeft = scrollLeftRef.current - walk;
    }
  };

  const handleRibbonMouseUp = () => {
    isDraggingRibbonRef.current = false;
    setTimeout(() => {
      hasDraggedRef.current = false;
      setIsDraggingRibbon(false);
    }, 50);
  };

  const handleRibbonWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!ribbonRef.current) return;
    if (e.deltaX === 0 && e.deltaY !== 0) {
      ribbonRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleTabClick = (tab: SidebarTabMode) => {
    if (hasDraggedRef.current) return;
    setActiveTab(tab);
  };

  if (!activeSnippet) {
    return null;
  }

  const toggleDiff = (threadId: string) => {
    setExpandedDiffs((prev) => ({ ...prev, [threadId]: !prev[threadId] }));
  };

  const filteredComments = comments.filter((thread) => {
    if (commentFilter === 'unresolved') return !thread.resolved;
    if (commentFilter === 'outdated') return thread.isOutdated;
    if (commentFilter === 'line') {
      return thread.lineNumber === (selectedLineNumber || 1);
    }
    return true;
  });

  const outdatedCount = comments.filter((c) => c.isOutdated).length;
  const unresolvedCount = comments.filter((c) => !c.resolved).length;
  const resolvedCount = comments.filter((c) => c.resolved).length;

  const handleCreateTopLevelComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentBody.trim() || !user) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await createComment(activeSnippet.id, {
        lineNumber: selectedLineNumber || 1,
        body: newCommentBody.trim(),
      });
      setNewCommentBody('');
    } catch (err) {
      setActionError((err as Error).message || 'Failed to post comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateReply = async (parentComment: CommentDTO) => {
    if (!replyBody.trim() || !user) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await createComment(activeSnippet.id, {
        parentId: parentComment.id,
        lineNumber: parentComment.lineNumber,
        body: replyBody.trim(),
      });
      setReplyBody('');
      setReplyingToId(null);
    } catch (err) {
      setActionError((err as Error).message || 'Failed to post reply');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveEdit = async (commentId: string) => {
    if (!editBody.trim()) return;
    setActionError(null);
    try {
      await updateComment(activeSnippet.id, commentId, editBody.trim());
      setEditingCommentId(null);
      setEditBody('');
    } catch (err) {
      setActionError((err as Error).message || 'Failed to update comment');
    }
  };

  const canResolveThread = (thread: CommentDTO): boolean => {
    if (!user) return false;
    if (
      activeSnippet.effectiveRole === 'admin' ||
      activeSnippet.effectiveRole === 'owner' ||
      activeSnippet.effectiveRole === 'editor'
    ) {
      return true;
    }
    return thread.authorId === user.id;
  };

  const canDeleteComment = (c: CommentDTO): boolean => {
    if (!user) return false;
    return (
      c.authorId === user.id ||
      activeSnippet.effectiveRole === 'admin' ||
      activeSnippet.effectiveRole === 'owner'
    );
  };

  return (
    <aside
      className={`w-full lg:w-[360px] rounded-[28px] frosted-surface flex flex-col h-full shrink-0 select-none transition-transform z-20 overflow-hidden ${
        isOpen ? 'translate-x-0' : 'translate-x-full lg:hidden'
      }`}
    >
      {/* 1. Header: Underline tabs (Comments, Versions, Team, Activity) on a single seamless track */}
      <div className="px-4 pt-4 flex items-center justify-between gap-1 shrink-0 relative border-b border-[var(--border)]">
        {/* Ribbon with right fade for comfortable gap */}
        <div className="relative flex-1 min-w-0 mr-3 overflow-hidden">
          <div
            ref={ribbonRef}
            onMouseDown={handleRibbonMouseDown}
            onMouseMove={handleRibbonMouseMove}
            onMouseUp={handleRibbonMouseUp}
            onMouseLeave={handleRibbonMouseUp}
            onWheel={handleRibbonWheel}
            className={`flex items-center gap-3.5 text-xs -mb-[1px] overflow-x-auto overflow-y-hidden no-scrollbar pr-7 select-none [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent_100%)] ${
              isDraggingRibbon ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            <button
              type="button"
              onClick={() => handleTabClick('comments')}
              className={`pb-2 relative font-medium transition-colors cursor-pointer shrink-0 ${
                activeTab === 'comments'
                  ? 'text-[var(--ink)] font-semibold after:absolute after:-bottom-[1px] after:left-0 after:right-0 after:h-[2px] after:bg-[var(--ink)] after:rounded-full after:shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Comments ({comments.length})</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleTabClick('versions')}
              className={`pb-2 relative font-medium transition-colors cursor-pointer shrink-0 ${
                activeTab === 'versions'
                  ? 'text-[var(--ink)] font-semibold after:absolute after:-bottom-[1px] after:left-0 after:right-0 after:h-[2px] after:bg-[var(--ink)] after:rounded-full after:shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5" />
                <span>Versions ({activeSnippet.latestVersionNumber})</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleTabClick('collaborators')}
              className={`pb-2 relative font-medium transition-colors cursor-pointer shrink-0 ${
                activeTab === 'collaborators'
                  ? 'text-[var(--ink)] font-semibold after:absolute after:-bottom-[1px] after:left-0 after:right-0 after:h-[2px] after:bg-[var(--ink)] after:rounded-full after:shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Team ({(activeSnippet.collaborators?.length ?? 0) + 1})</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleTabClick('activity')}
              className={`pb-2 relative font-medium transition-colors cursor-pointer shrink-0 ${
                activeTab === 'activity'
                  ? 'text-[var(--ink)] font-semibold after:absolute after:-bottom-[1px] after:left-0 after:right-0 after:h-[2px] after:bg-[var(--ink)] after:rounded-full after:shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Activity</span>
              </div>
            </button>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review panel"
            className="p-1.5 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {activeTab === 'comments' && (
        <>
          {/* 2. Filter Pills + Line Anchor Chip (no scrollbar, single seamless flow) */}
          <div className="p-3 space-y-2.5 shrink-0">
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              {(
                [
                  { id: 'all', label: 'All', count: comments.length },
                  { id: 'unresolved', label: 'Open', count: unresolvedCount },
                  { id: 'resolved', label: 'Resolved', count: resolvedCount },
                  { id: 'outdated', label: 'Outdated', count: outdatedCount },
                ] as Array<{ id: CommentFilterMode; label: string; count: number }>
              ).map((tab) => {
                const isActive = commentFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCommentFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                      isActive
                        ? 'bg-[var(--surface-raised)] text-[var(--ink)] shadow-raised font-semibold'
                        : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]/40'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                        isActive
                          ? 'bg-[var(--surface)] text-[var(--ink)]'
                          : 'bg-[var(--surface-raised)] text-[var(--ink-muted)]'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Line Anchor Control as Compact Chip */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--ink-muted)]">Anchor:</span>
                <button
                  type="button"
                  onClick={() =>
                    setCommentFilter(commentFilter === 'line' ? 'all' : 'line')
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono border transition-colors ${
                    commentFilter === 'line'
                      ? 'bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink)] font-semibold shadow-xs'
                      : 'border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  <span>Line #{selectedLineNumber || 1}</span>
                  {commentFilter === 'line' && (
                    <span className="text-[9px] text-[var(--ink-muted)]">filtered</span>
                  )}
                </button>
              </div>
              {commentFilter === 'line' && (
                <button
                  type="button"
                  onClick={() => setCommentFilter('all')}
                  className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:underline"
                >
                  Clear filter
                </button>
              )}
            </div>

            {/* Anchored Comment Composer */}
            {user ? (
              <form
                onSubmit={handleCreateTopLevelComment}
                className="space-y-2 rounded-2xl bg-[var(--surface-raised)]/40 border border-[var(--border)] p-2.5"
              >
                <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                  <span className="font-mono text-[var(--ink)] text-[11px] font-medium">
                    Anchor: Line #{selectedLineNumber || 1}
                  </span>
                  <span className="text-[10px]">Click any line in editor to anchor</span>
                </div>
                <textarea
                  rows={2}
                  value={newCommentBody}
                  onChange={(e) => setNewCommentBody(e.target.value)}
                  placeholder={`Write a review note on line ${selectedLineNumber || 1}...`}
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[12px] p-2 text-xs text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none resize-none focus:border-[var(--ink-muted)]"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting || !newCommentBody.trim()}
                    className="px-3 py-1 rounded-[10px] bg-[var(--ink)] text-[var(--ink-contrast)] disabled:opacity-50 text-xs font-semibold flex items-center gap-1 shadow-raised hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                    <span>Comment</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-3 rounded-2xl bg-[var(--surface-raised)]/40 border border-[var(--border)] text-xs text-[var(--ink-muted)] text-center">
                Sign in to edit or comment
              </div>
            )}

            {actionError && (
              <div className="p-2 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--ink)]">
                {actionError}
              </div>
            )}
          </div>

          {/* 3. Threaded Comments List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {isLoadingComments && comments.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--ink-muted)] space-y-2">
                <div className="h-4 bg-[var(--surface-raised)] rounded animate-pulse w-3/4 mx-auto" />
                <div className="h-3 bg-[var(--surface-raised)]/60 rounded animate-pulse w-1/2 mx-auto" />
              </div>
            ) : filteredComments.length === 0 ? (
              /* Empty state with corner-bracket marks */
              <div className="p-8 text-center flex flex-col items-center justify-center text-[var(--ink-muted)] space-y-2">
                <span className="text-xl font-mono text-[var(--ink-muted)]">「 」</span>
                <p className="text-xs font-medium text-[var(--ink)]">No review threads</p>
                <p className="text-[11px] text-[var(--ink-muted)]">
                  Click a line number in the editor to start a review thread.
                </p>
              </div>
            ) : (
              filteredComments.map((thread) => {
                const isOutdated = thread.isOutdated;
                const isDiffOpen = expandedDiffs[thread.id] ?? false;

                return (
                  <div
                    key={thread.id}
                    className={`rounded-2xl frosted-surface p-3 space-y-2.5 transition-all ${
                      thread.resolved ? 'opacity-70' : 'shadow-xs'
                    }`}
                  >
                    {/* Header: Line chip & Status */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedLineNumber(thread.lineNumber)}
                          className="px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink)] hover:bg-[var(--surface-overlay)] transition-colors"
                        >
                          Line {thread.lineNumber}
                        </button>

                        {isOutdated && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink-muted)] font-medium">
                            <AlertCircle className="w-2.5 h-2.5 text-[var(--ink-muted)]" />
                            Outdated
                          </span>
                        )}

                        {thread.resolved ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink)]">
                            <CheckCircle2 className="w-2.5 h-2.5 text-[var(--ink)]" />
                            Resolved
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-[var(--ink-muted)]">
                            Open
                          </span>
                        )}
                      </div>

                      {/* Resolve button */}
                      {canResolveThread(thread) && (
                        <button
                          type="button"
                          onClick={() =>
                            setCommentResolved(
                              activeSnippet.id,
                              thread.id,
                              !thread.resolved
                            )
                          }
                          className="text-xs font-medium flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink)] hover:bg-[var(--surface-overlay)] transition-colors cursor-pointer"
                        >
                          {thread.resolved ? (
                            <>
                              <RotateCcw className="w-3 h-3 text-[var(--ink-muted)]" />
                              <span>Reopen</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-[var(--ink)]" />
                              <span>Resolve</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Outdated Diff Block */}
                    {isOutdated && (
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/30 overflow-hidden text-xs">
                        <button
                          type="button"
                          onClick={() => toggleDiff(thread.id)}
                          className="w-full text-left px-2.5 py-1.5 flex items-center justify-between text-[11px] text-[var(--ink)] font-medium hover:bg-[var(--surface-raised)] cursor-pointer"
                        >
                          <span className="flex items-center gap-1">
                            {isDiffOpen ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                            <span>Code changed on line {thread.lineNumber}</span>
                          </span>
                          <span className="text-[10px] font-mono text-[var(--ink-muted)]">
                            {isDiffOpen ? 'Hide diff' : 'Show diff'}
                          </span>
                        </button>

                        {isDiffOpen && (
                          <div className="px-2.5 pb-2 pt-1 font-mono text-[11px] space-y-1 border-t border-[var(--border)]">
                            <div className="text-[var(--ink-muted)] line-through opacity-70">
                              - {thread.anchorLineText || '(empty)'}
                            </div>
                            <div className="text-[var(--ink)] font-semibold">
                              + {thread.currentLineText ?? '(line removed)'}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Author & Timestamp */}
                    <div className="flex items-center justify-between text-xs pt-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-5 h-5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[10px] font-semibold text-[var(--ink)] shrink-0">
                          {thread.author.displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-[var(--ink)] truncate">
                          {thread.author.displayName}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink-muted)] shrink-0">
                          {formatRoleLabel(activeSnippet.effectiveRole)}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--ink-muted)] shrink-0">
                        {formatRelativeTime(thread.createdAt)}
                      </span>
                    </div>

                    {/* Comment text */}
                    {editingCommentId === thread.id ? (
                      <div className="space-y-1.5 pt-1">
                        <textarea
                          rows={2}
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[10px] p-2 text-xs text-[var(--ink)] outline-none"
                        />
                        <div className="flex gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => setEditingCommentId(null)}
                            className="px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(thread.id)}
                            className="px-3 py-1 rounded-[10px] bg-[var(--ink)] text-xs text-[var(--color-editor-bg,#121316)] shadow-raised"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--ink)] whitespace-pre-wrap select-text leading-relaxed">
                        {thread.body}
                      </p>
                    )}

                    {/* Actions: Reply & Edit/Delete */}
                    <div className="flex items-center justify-between text-xs text-[var(--ink-muted)] pt-0.5">
                      <div className="flex items-center gap-2">
                        {user && (
                          <button
                            type="button"
                            onClick={() =>
                              setReplyingToId(
                                replyingToId === thread.id ? null : thread.id
                              )
                            }
                            className="text-xs text-[var(--ink)] hover:underline font-medium"
                          >
                            Reply
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {user?.id === thread.authorId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCommentId(thread.id);
                              setEditBody(thread.body);
                            }}
                            className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
                            title="Edit comment"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        )}
                        {canDeleteComment(thread) && (
                          <button
                            type="button"
                            onClick={() =>
                              deleteComment(activeSnippet.id, thread.id)
                            }
                            className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
                            title="Delete thread"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Reply input composer */}
                    {replyingToId === thread.id && (
                      <div className="pt-2 pl-3 border-l-2 border-[var(--border)] space-y-1.5">
                        <textarea
                          rows={2}
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="Write a reply..."
                          className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[10px] p-2 text-xs text-[var(--ink)] outline-none"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingToId(null);
                              setReplyBody('');
                            }}
                            className="px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isSubmitting || !replyBody.trim()}
                            onClick={() => handleCreateReply(thread)}
                            className="px-3 py-1 rounded-[10px] bg-[var(--ink)] text-[var(--ink-contrast)] shadow-raised text-xs font-semibold cursor-pointer"
                          >
                            Post reply
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Replies indented */}
                    {thread.replies && thread.replies.length > 0 && (
                      <div className="pl-3 ml-1 border-l border-[var(--border)] space-y-2.5 pt-1">
                        {thread.replies.map((reply) => (
                          <div key={reply.id} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <CornerDownRight className="w-3 h-3 text-[var(--ink-muted)] shrink-0" />
                                <span className="font-medium text-[var(--ink)] truncate">
                                  {reply.author.displayName}
                                </span>
                              </div>
                              <span className="text-[10px] text-[var(--ink-muted)] shrink-0">
                                {formatRelativeTime(reply.createdAt)}
                              </span>
                            </div>

                            {editingCommentId === reply.id ? (
                              <div className="space-y-1 pt-1">
                                <textarea
                                  rows={2}
                                  value={editBody}
                                  onChange={(e) => setEditBody(e.target.value)}
                                  className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-[10px] p-1.5 text-xs text-[var(--ink)]"
                                />
                                <div className="flex gap-1.5 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setEditingCommentId(null)}
                                    className="px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(reply.id)}
                                    className="px-3 py-1 rounded-[10px] bg-[var(--ink)] text-xs text-[var(--color-editor-bg,#121316)] shadow-raised"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--ink)] pl-4 whitespace-pre-wrap select-text">
                                {reply.body}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* 2. Versions Panel */}
      {activeTab === 'versions' && (
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)] p-3 space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-[var(--ink)]">
              Version Snapshots ({versions.length})
            </span>
            {onOpenVersionHistoryModal && (
              <button
                type="button"
                onClick={onOpenVersionHistoryModal}
                className="text-[11px] text-[var(--ink)] hover:underline flex items-center gap-1 cursor-pointer font-medium"
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>Compare & Diff →</span>
              </button>
            )}
          </div>

          {isLoadingVersions && versions.length === 0 ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 rounded-[14px] bg-[var(--surface-raised)]/40 animate-pulse space-y-2">
                  <div className="h-3 bg-[var(--surface-raised)] rounded w-1/3" />
                  <div className="h-2.5 bg-[var(--surface-raised)] rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : versions.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--ink-muted)] space-y-1">
              <GitBranch className="w-6 h-6 mx-auto opacity-40 mb-2" />
              <p className="font-medium text-[var(--ink)]">Initial version (v{activeSnippet.latestVersionNumber})</p>
              <p>Save versions as you collaborate to track changes.</p>
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              {versions.map((ver) => {
                const isCurrent = ver.versionNumber === activeSnippet.latestVersionNumber;
                return (
                  <div
                    key={ver.id}
                    className={`p-3 rounded-[16px] border text-xs space-y-2 transition-colors ${
                      isCurrent
                        ? 'bg-[var(--surface-raised)] border-[var(--border)] shadow-xs'
                        : 'bg-[var(--surface)]/20 border-[var(--border-subtle)] hover:bg-[var(--surface-raised)]/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-xs px-2 py-0.5 rounded-full border ${
                            isCurrent
                              ? 'bg-[var(--ink)] text-[var(--ink-contrast)] font-bold'
                              : 'bg-[var(--surface-raised)] text-[var(--ink)] border-[var(--border)] font-semibold'
                          }`}
                        >
                          v{ver.versionNumber}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] font-mono text-[var(--ink-muted)]">
                            (current)
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-[var(--ink-muted)]">
                        {formatRelativeTime(ver.createdAt)}
                      </span>
                    </div>

                    <p className="text-[var(--ink)] font-medium leading-snug">
                      {ver.summary || 'Snapshot update'}
                    </p>

                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)] pt-1 border-t border-[var(--border-subtle)]">
                      <span>By {ver.authorDisplayName || 'Editor'}</span>
                      <div className="flex items-center gap-1.5">
                        {onOpenVersionHistoryModal && (
                          <button
                            type="button"
                            onClick={onOpenVersionHistoryModal}
                            className="px-2 py-0.5 rounded-[8px] bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] text-[10px] text-[var(--ink)] border border-[var(--border)] cursor-pointer"
                          >
                            Diff
                          </button>
                        )}
                        {!isCurrent && (activeSnippet.effectiveRole === 'editor' || activeSnippet.effectiveRole === 'owner' || activeSnippet.effectiveRole === 'admin') && (
                          <button
                            type="button"
                            onClick={() => restoreVersion(activeSnippet.id, ver.id)}
                            className="px-2 py-0.5 rounded-[8px] bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] text-[10px] text-[var(--ink)] border border-[var(--border)] cursor-pointer"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Collaborators Panel */}
      {activeTab === 'collaborators' && (
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)] p-3 space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-[var(--ink)]">
              Snippet Collaborators ({(activeSnippet.collaborators?.length ?? 0) + 1})
            </span>
            {onOpenCollaboratorsModal && (
              <button
                type="button"
                onClick={onOpenCollaboratorsModal}
                className="text-[11px] text-[var(--ink)] hover:underline flex items-center gap-1 cursor-pointer font-medium"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Manage / Add →</span>
              </button>
            )}
          </div>

          <div className="space-y-2 pt-1">
            {/* Owner Card */}
            <div className="p-3 rounded-[16px] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center font-semibold text-xs text-[var(--ink)]">
                  {activeSnippet.owner.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-[var(--ink)]">
                    {activeSnippet.owner.displayName}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--ink-muted)]">
                    @{activeSnippet.owner.username}
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--ink)] text-[var(--ink-contrast)] font-bold">
                Owner
              </span>
            </div>

            {/* Collaborators list */}
            {activeSnippet.collaborators.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--ink-muted)] space-y-1">
                <Users className="w-6 h-6 mx-auto opacity-40 mb-2" />
                <p className="font-medium text-[var(--ink)]">No additional collaborators</p>
                <p>Invite teammates to collaborate on this snippet in real-time.</p>
              </div>
            ) : (
              activeSnippet.collaborators.map((collab) => (
                <div
                  key={collab.userId}
                  className="p-3 rounded-[16px] bg-[var(--surface)]/20 border border-[var(--border-subtle)] text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center font-semibold text-xs text-[var(--ink)]">
                      {collab.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-[var(--ink)]">{collab.displayName}</div>
                      <div className="text-[10px] font-mono text-[var(--ink-muted)]">
                        @{collab.username}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--ink)] capitalize">
                      {collab.role}
                    </span>
                    {(activeSnippet.effectiveRole === 'owner' || activeSnippet.effectiveRole === 'admin') && (
                      <button
                        type="button"
                        onClick={() => removeCollaborator(activeSnippet.id, collab.userId)}
                        className="p-1 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] cursor-pointer transition-colors"
                        title="Remove collaborator"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 4. Snippet Activity View */}
      {activeTab === 'activity' && (
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)] p-3 space-y-2">
          {snippetActivities.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center text-[var(--ink-muted)] space-y-2">
              <span className="text-xl font-mono text-[var(--ink-muted)]">「 」</span>
              <p className="text-xs font-medium text-[var(--ink)]">No activity recorded</p>
              <p className="text-[11px] text-[var(--ink-muted)]">No recent activity for this snippet.</p>
            </div>
          ) : (
            snippetActivities.map((act) => (
              <div key={act.id} className="py-2.5 space-y-1 text-xs">
                <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                  <span className="font-medium text-[var(--ink)]">
                    {act.actor.displayName}
                  </span>
                  <span>{formatRelativeTime(act.createdAt)}</span>
                </div>
                <div className="text-[var(--ink)]">
                  <span className="font-mono text-[var(--ink-muted)]">{act.type}</span>
                  {typeof act.metadata?.summary === 'string'
                    ? ` — ${act.metadata.summary}`
                    : ''}
                </div>
              </div>
            ))
          )}

          {snippetHasMore && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() =>
                  fetchSnippetActivities(activeSnippet.id, { append: true })
                }
                className="w-full py-1.5 rounded-[10px] border border-[var(--border)] text-xs text-[var(--ink)] hover:bg-[var(--surface-raised)] transition-colors cursor-pointer"
              >
                Load more activity
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
