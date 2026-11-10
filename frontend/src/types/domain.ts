export type GlobalRole = 'admin' | 'editor' | 'viewer';
export type CollaboratorRole = 'editor' | 'viewer';
export type EffectiveSnippetRole =
  | 'admin'
  | 'owner'
  | 'editor'
  | 'viewer'
  | 'anonymous_viewer'
  | 'none';
export type SnippetVisibility = 'public' | 'unlisted' | 'private';
export type SearchSortMode = 'relevance' | 'newest' | 'oldest' | 'updated';
export type SnippetScopeMode = 'public' | 'mine' | 'collaborated' | 'all';

export type ActivityEventType =
  | 'snippet.created'
  | 'snippet.edited'
  | 'snippet.deleted'
  | 'comment.added'
  | 'comment.resolved'
  | 'collaborator.added';

export type NotificationType =
  | 'comment.added'
  | 'comment.reply'
  | 'comment.resolved'
  | 'collaborator.added';

export interface UserDTO {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  githubId?: string | null;
  hasPassword?: boolean;
  globalRole: GlobalRole;
  createdAt: string;
  updatedAt?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SnippetCollaboratorDTO {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  role: CollaboratorRole;
  addedById: string | null;
  createdAt: string;
}

export interface SnippetVersionSummaryDTO {
  id: string;
  snippetId: string;
  versionNumber: number;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  contentLength?: number;
  summary: string;
  source: string;
  createdAt: string;
}

export interface SnippetVersionDTO extends SnippetVersionSummaryDTO {
  content: string;
}

export interface SnippetSummaryDTO {
  id: string;
  title: string;
  description: string;
  language: string;
  visibility: SnippetVisibility;
  ownerId: string;
  owner: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  currentContent?: string;
  contentLength?: number;
  currentVersionId: string | null;
  latestVersionNumber: number;
  tags: string[];
  collaborators: SnippetCollaboratorDTO[];
  effectiveRole: EffectiveSnippetRole;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetDetailDTO extends SnippetSummaryDTO {
  currentContent: string;
}

export interface SnippetSearchHitDTO extends SnippetSummaryDTO {
  rank: number;
  headline: string;
}

export interface SearchFacetsDTO {
  languages: Array<{ language: string; count: number }>;
  tags: Array<{ name: string; count: number }>;
}

export interface DiffLineDTO {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface SnippetDiffDTO {
  snippetId: string;
  fromVersion: {
    id: string;
    versionNumber: number;
    summary: string;
    createdAt: string;
  };
  toVersion: {
    id: string;
    versionNumber: number;
    summary: string;
    createdAt: string;
  };
  stats: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
  lines: DiffLineDTO[];
}

export interface CommentAuthorDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CommentDTO {
  id: string;
  snippetId: string;
  authorId: string;
  author: CommentAuthorDTO;
  parentId: string | null;
  lineNumber: number;
  versionId: string;
  anchorLineText: string;
  currentLineText: string | null;
  isOutdated: boolean;
  body: string;
  resolved: boolean;
  resolvedById: string | null;
  resolvedBy: CommentAuthorDTO | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies: CommentDTO[];
}

export interface ActivityDTO {
  id: string;
  actorId: string;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  type: ActivityEventType;
  snippetId: string | null;
  visibility: SnippetVisibility;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  recipientId: string;
  actorId: string | null;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  type: NotificationType;
  snippetId: string | null;
  commentId: string | null;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsPageDTO extends PaginatedResult<NotificationDTO> {
  unreadCount: number;
}

export interface PresenceMemberDTO {
  socketId: string;
  userId: string | null;
  username: string;
  displayName: string;
  color: string;
  role: EffectiveSnippetRole;
  cursor: {
    lineNumber: number;
    column: number;
  } | null;
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  joinedAt: string;
}
