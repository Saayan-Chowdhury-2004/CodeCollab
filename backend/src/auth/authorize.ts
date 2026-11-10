import { AppError } from '../utils/errors.ts';
import { AuthenticatedUser, GlobalRole } from './jwt.ts';

export type SnippetVisibility = 'public' | 'unlisted' | 'private';
export type CollaboratorRole = 'editor' | 'viewer';
export type EffectiveSnippetRole = 'admin' | 'owner' | 'editor' | 'viewer' | 'anonymous_viewer' | 'none';

export type PolicyAction =
  | 'auth:authenticated'
  | 'user:profile:edit'
  | 'user:list'
  | 'user:manage_roles'
  | 'snippet:create'
  | 'snippet:read'
  | 'snippet:edit'
  | 'snippet:version:create'
  | 'snippet:version:restore'
  | 'snippet:manage_collaborators'
  | 'snippet:delete'
  | 'comment:create'
  | 'comment:edit'
  | 'comment:resolve'
  | 'comment:delete';

export interface SnippetAuthorizationResource {
  id: string;
  ownerId: string;
  visibility: SnippetVisibility;
  collaboratorRole?: CollaboratorRole | null;
}

export interface CommentAuthorizationResource {
  id: string;
  authorId: string;
}

export interface AuthorizationContext {
  snippet?: SnippetAuthorizationResource;
  comment?: CommentAuthorizationResource;
  targetUserId?: string;
}

export interface AuthorizationDecision {
  allowed: boolean;
  effectiveRole: EffectiveSnippetRole | GlobalRole | 'anonymous';
  reason?: string;
}

/**
 * Resolves the effective role of an actor on a specific snippet by combining:
 * 1. Global role (`admin` | `editor` | `viewer`)
 * 2. Ownership (`snippet.ownerId === actor.id`)
 * 3. Per-snippet collaborator role (`editor` | `viewer` | `null`)
 * 4. Snippet visibility (`public` | `unlisted` | `private`)
 *
 * Explicit Combination Rule (matches docs/ARCHITECTURE.md Section 3.1):
 * - Step 1: Global `admin` always resolves to `'admin'`.
 * - Step 2: If `actor.id === snippet.ownerId`:
 *     - If `actor.globalRole === 'viewer'`, global viewer caps write privileges to `'viewer'`.
 *     - Otherwise resolves to `'owner'`.
 * - Step 3: If `collaboratorRole` is present:
 *     - If `collaboratorRole === 'editor'` and `actor.globalRole !== 'viewer'`, resolves to `'editor'`.
 *     - Otherwise resolves to `'viewer'`.
 * - Step 4: Non-collaborator / anonymous:
 *     - If `snippet.visibility === 'public'` or `'unlisted'`:
 *         - Authenticated user -> `'viewer'`
 *         - Anonymous (`null`) -> `'anonymous_viewer'`
 *     - If `snippet.visibility === 'private'` -> `'none'`
 */
export function resolveEffectiveSnippetRole(
  actor: AuthenticatedUser | null | undefined,
  snippet: SnippetAuthorizationResource
): EffectiveSnippetRole {
  if (actor?.globalRole === 'admin') {
    return 'admin';
  }

  if (actor && snippet.ownerId === actor.id) {
    if (actor.globalRole === 'viewer') {
      return 'viewer';
    }
    return 'owner';
  }

  if (actor && snippet.collaboratorRole) {
    if (snippet.collaboratorRole === 'editor' && actor.globalRole !== 'viewer') {
      return 'editor';
    }
    return 'viewer';
  }

  if (snippet.visibility === 'public' || snippet.visibility === 'unlisted') {
    return actor ? 'viewer' : 'anonymous_viewer';
  }

  return 'none';
}

/**
 * Evaluates whether `actor` is allowed to perform `action` given `context`.
 * This is the SINGLE central authorization evaluator used by all REST routes and Socket.io events.
 */
export function evaluateAuthorization(
  actor: AuthenticatedUser | null | undefined,
  action: PolicyAction,
  context: AuthorizationContext = {}
): AuthorizationDecision {
  switch (action) {
    case 'auth:authenticated':
    case 'user:list': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous', reason: 'Authentication required' };
      }
      return { allowed: true, effectiveRole: actor.globalRole };
    }

    case 'user:profile:edit': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous', reason: 'Authentication required' };
      }
      if (context.targetUserId && context.targetUserId !== actor.id && actor.globalRole !== 'admin') {
        return {
          allowed: false,
          effectiveRole: actor.globalRole,
          reason: 'Cannot edit another user profile',
        };
      }
      return { allowed: true, effectiveRole: actor.globalRole };
    }

    case 'user:manage_roles': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous', reason: 'Authentication required' };
      }
      if (actor.globalRole !== 'admin') {
        return {
          allowed: false,
          effectiveRole: actor.globalRole,
          reason: 'Only global admins can manage user roles',
        };
      }
      return { allowed: true, effectiveRole: 'admin' };
    }

    case 'snippet:create': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous', reason: 'Authentication required' };
      }
      if (actor.globalRole === 'viewer') {
        return {
          allowed: false,
          effectiveRole: 'viewer',
          reason: 'Users with global viewer role cannot create snippets',
        };
      }
      return { allowed: true, effectiveRole: actor.globalRole };
    }

    case 'snippet:read': {
      if (!context.snippet) {
        return { allowed: false, effectiveRole: 'none', reason: 'Missing snippet context' };
      }
      const role = resolveEffectiveSnippetRole(actor, context.snippet);
      const allowed = role !== 'none';
      return {
        allowed,
        effectiveRole: role,
        reason: allowed ? undefined : 'You do not have permission to view this private snippet',
      };
    }

    case 'snippet:edit':
    case 'snippet:version:create':
    case 'snippet:version:restore': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous_viewer', reason: 'Authentication required' };
      }
      if (!context.snippet) {
        return { allowed: false, effectiveRole: 'none', reason: 'Missing snippet context' };
      }
      const role = resolveEffectiveSnippetRole(actor, context.snippet);
      const allowed = role === 'admin' || role === 'owner' || role === 'editor';
      return {
        allowed,
        effectiveRole: role,
        reason: allowed
          ? undefined
          : 'Write permission denied: only snippet owner, editor collaborators, or admins may edit code',
      };
    }

    case 'snippet:manage_collaborators':
    case 'snippet:delete': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous_viewer', reason: 'Authentication required' };
      }
      if (!context.snippet) {
        return { allowed: false, effectiveRole: 'none', reason: 'Missing snippet context' };
      }
      const role = resolveEffectiveSnippetRole(actor, context.snippet);
      const allowed = role === 'admin' || role === 'owner';
      return {
        allowed,
        effectiveRole: role,
        reason: allowed
          ? undefined
          : 'Only the snippet owner or a global admin can perform this management action',
      };
    }

    case 'comment:create': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous_viewer', reason: 'Authentication required to comment' };
      }
      if (!context.snippet) {
        return { allowed: false, effectiveRole: 'none', reason: 'Missing snippet context' };
      }
      const role = resolveEffectiveSnippetRole(actor, context.snippet);
      const allowed = role === 'admin' || role === 'owner' || role === 'editor' || role === 'viewer';
      return {
        allowed,
        effectiveRole: role,
        reason: allowed ? undefined : 'You do not have access to comment on this snippet',
      };
    }

    case 'comment:edit': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous_viewer', reason: 'Authentication required' };
      }
      if (!context.snippet || !context.comment) {
        return { allowed: false, effectiveRole: 'none', reason: 'Missing snippet or comment context' };
      }
      const role = resolveEffectiveSnippetRole(actor, context.snippet);
      if (role === 'none') {
        return { allowed: false, effectiveRole: 'none', reason: 'No access to snippet' };
      }
      const allowed = actor.globalRole === 'admin' || context.comment.authorId === actor.id;
      return {
        allowed,
        effectiveRole: role,
        reason: allowed ? undefined : 'Only the comment author or an admin can edit this comment',
      };
    }

    case 'comment:resolve':
    case 'comment:delete': {
      if (!actor) {
        return { allowed: false, effectiveRole: 'anonymous_viewer', reason: 'Authentication required' };
      }
      if (!context.snippet) {
        return { allowed: false, effectiveRole: 'none', reason: 'Missing snippet context' };
      }
      const role = resolveEffectiveSnippetRole(actor, context.snippet);
      const isAuthor = Boolean(context.comment && context.comment.authorId === actor.id);
      const allowed =
        role === 'admin' ||
        role === 'owner' ||
        (action === 'comment:resolve' && role === 'editor') ||
        (role !== 'none' && isAuthor);

      return {
        allowed,
        effectiveRole: role,
        reason: allowed
          ? undefined
          : 'Only the comment author, snippet editor/owner, or admin can perform this comment action',
      };
    }

    default:
      return { allowed: false, effectiveRole: 'none', reason: 'Unknown policy action' };
  }
}

/**
 * Asserts that `actor` is authorized for `action` on `context`.
 * Throws standardized 401 UNAUTHORIZED or 403 FORBIDDEN AppError on failure.
 */
export function authorize(
  actor: AuthenticatedUser | null | undefined,
  action: PolicyAction,
  context: AuthorizationContext = {}
): AuthorizationDecision {
  const decision = evaluateAuthorization(actor, action, context);
  if (!decision.allowed) {
    if (!actor) {
      throw new AppError(401, 'UNAUTHORIZED', decision.reason || 'Authentication required');
    }
    throw new AppError(403, 'FORBIDDEN', decision.reason || 'Insufficient permissions for this action');
  }
  return decision;
}
