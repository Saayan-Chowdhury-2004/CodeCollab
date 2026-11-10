import express, { Router, Request, Response } from 'express';
import { createRequire } from 'module';
import path from 'path';
import { env } from '../config/env.ts';

const require = createRequire(import.meta.url);
const swaggerUiAssetPath = path.dirname(require.resolve('swagger-ui-dist/package.json'));

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'CodeCollab — Collaborative Code Snippet Sharing & Review Platform API',
    version: '1.0.0',
    description:
      'REST API for Gists-style code snippets, Yjs real-time collaborative editing, line-anchored review threads with outdated detection, PostgreSQL tsvector + GIN full-text search, and domain activity feeds. All endpoints enforce central role-based authorization (backend/src/auth/authorize.ts) and strict Zod payload validation.',
  },
  servers: [
    {
      url: env.APP_URL || 'http://localhost:3000',
      description: 'Current Application Server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '15-minute HS256 JWT access token in Authorization: Bearer <token>',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'cc_access_token',
        description: 'Optional httpOnly cookie transport when AUTH_TRANSPORT=cookie',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Request validation failed' },
              details: { nullable: true },
            },
          },
        },
      },
      UserDTO: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          username: { type: 'string' },
          displayName: { type: 'string' },
          avatarUrl: { type: 'string', nullable: true },
          globalRole: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      SnippetDetailDTO: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          language: { type: 'string' },
          visibility: { type: 'string', enum: ['public', 'unlisted', 'private'] },
          ownerId: { type: 'string', format: 'uuid' },
          currentContent: { type: 'string' },
          contentLength: { type: 'integer' },
          currentVersionId: { type: 'string', format: 'uuid', nullable: true },
          latestVersionNumber: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          effectiveRole: {
            type: 'string',
            enum: ['admin', 'owner', 'editor', 'viewer', 'anonymous_viewer'],
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SnippetSummaryDTO: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          language: { type: 'string' },
          visibility: { type: 'string', enum: ['public', 'unlisted', 'private'] },
          ownerId: { type: 'string', format: 'uuid' },
          contentLength: { type: 'integer' },
          currentVersionId: { type: 'string', format: 'uuid', nullable: true },
          latestVersionNumber: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          effectiveRole: {
            type: 'string',
            enum: ['admin', 'owner', 'editor', 'viewer', 'anonymous_viewer'],
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SnippetVersionSummaryDTO: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          snippetId: { type: 'string', format: 'uuid' },
          versionNumber: { type: 'integer' },
          authorId: { type: 'string', format: 'uuid', nullable: true },
          summary: { type: 'string', nullable: true },
          source: { type: 'string', enum: ['manual', 'autosave', 'restore'] },
          contentLength: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CommentDTO: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          snippetId: { type: 'string', format: 'uuid' },
          authorId: { type: 'string', format: 'uuid' },
          parentId: { type: 'string', format: 'uuid', nullable: true },
          lineNumber: { type: 'integer', minimum: 1 },
          versionId: { type: 'string', format: 'uuid' },
          anchorLineText: { type: 'string' },
          currentLineText: { type: 'string', nullable: true },
          isOutdated: { type: 'boolean' },
          body: { type: 'string' },
          resolved: { type: 'boolean' },
          resolvedById: { type: 'string', format: 'uuid', nullable: true },
          resolvedAt: { type: 'string', format: 'date-time', nullable: true },
          replies: {
            type: 'array',
            items: { $ref: '#/components/schemas/CommentDTO' },
          },
        },
      },
      ActivityDTO: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          actorId: { type: 'string', format: 'uuid' },
          type: {
            type: 'string',
            enum: [
              'snippet.created',
              'snippet.edited',
              'snippet.deleted',
              'comment.added',
              'comment.resolved',
              'collaborator.added',
            ],
          },
          snippetId: { type: 'string', format: 'uuid', nullable: true },
          visibility: { type: 'string', enum: ['public', 'unlisted', 'private'] },
          metadata: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Minimal liveness probe returning connection status and timestamp',
        responses: {
          '200': { description: 'Application live and healthy' },
          '503': { description: 'Application or database unavailable' },
        },
      },
    },
    '/api/health/ready': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe with database table row counts (requires admin role or HEALTH_CHECK_SECRET)',
        responses: {
          '200': { description: 'Application fully ready' },
          '401': { description: 'Missing or invalid authentication/secret header' },
          '503': { description: 'Application or database not ready' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user account and issue JWT + opaque refresh token family',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'username', 'displayName', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  username: { type: 'string', minLength: 3, maxLength: 64 },
                  displayName: { type: 'string', minLength: 1, maxLength: 120 },
                  password: { type: 'string', minLength: 8, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Account created and tokens returned' },
          '409': { description: 'Email or username already registered' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Authenticate with email or username + password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password'],
                properties: {
                  identifier: { type: 'string', example: 'elena@codecollab.dev' },
                  password: { type: 'string', example: 'EditorPass123!' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Authenticated session tokens and user profile' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate opaque refresh token with family reuse detection',
        description:
          'Rotates the refresh token on every use. If an already-rotated token is presented again, the entire token family (family_id) is immediately revoked and 401 REFRESH_TOKEN_REUSED is returned.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'New accessToken and rotated refreshToken' },
          '401': { description: 'Invalid, expired, or reused refresh token' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke current refresh token family and clear session',
        responses: {
          '200': { description: 'Logged out' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        summary: 'Get current authenticated user profile',
        responses: {
          '200': { description: 'Current user DTO' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/github/url': {
      get: {
        tags: ['Auth'],
        summary: 'Generate GitHub OAuth authorization URL with HMAC-signed CSRF state',
        parameters: [
          {
            name: 'origin',
            in: 'query',
            schema: { type: 'string' },
            description: 'Target window.opener origin for postMessage validation',
          },
        ],
        responses: {
          '200': { description: 'GitHub authorize URL and signed state token' },
        },
      },
    },
    '/api/auth/github/callback': {
      get: {
        tags: ['Auth'],
        summary: 'GitHub OAuth popup callback exchanging code and posting tokens via postMessage',
        parameters: [
          { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'state', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'HTML popup closer posting OAUTH_AUTH_SUCCESS to opener' },
          '400': { description: 'Invalid or expired CSRF state' },
        },
      },
    },
    '/api/users': {
      get: {
        tags: ['Users & Admin'],
        security: [{ bearerAuth: [] }],
        summary: 'Cursor-paginated user directory with full-text tsvector search',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': { description: 'Paginated user list' },
        },
      },
    },
    '/api/users/me': {
      patch: {
        tags: ['Users & Admin'],
        security: [{ bearerAuth: [] }],
        summary: 'Update own display name, username, or avatar URL (strict mass-assignment protection)',
        responses: {
          '200': { description: 'Updated user profile' },
        },
      },
    },
    '/api/users/me/password': {
      post: {
        tags: ['Users & Admin'],
        security: [{ bearerAuth: [] }],
        summary: 'Change own password and revoke other refresh token families',
        responses: {
          '200': { description: 'Password updated' },
        },
      },
    },
    '/api/users/{id}/role': {
      patch: {
        tags: ['Users & Admin'],
        security: [{ bearerAuth: [] }],
        summary: 'Admin-only endpoint to update a user globalRole (admin | editor | viewer)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Updated user role' },
          '403': { description: 'Forbidden (caller is not an admin)' },
        },
      },
    },
    '/api/snippets': {
      get: {
        tags: ['Snippets'],
        summary: 'Cursor-paginated list of accessible snippets with visibility & tag filters',
        responses: {
          '200': { description: 'Paginated snippets' },
        },
      },
      post: {
        tags: ['Snippets'],
        security: [{ bearerAuth: [] }],
        summary: 'Create a new snippet + initial v1 version snapshot (requires admin or editor globalRole)',
        responses: {
          '201': { description: 'Created snippet detail' },
          '403': { description: 'Forbidden for global viewer role' },
        },
      },
    },
    '/api/snippets/{id}': {
      get: {
        tags: ['Snippets'],
        summary: 'Get snippet detail, tags, collaborators, and caller effectiveRole',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Snippet detail' },
          '403': { description: 'Private snippet access denied' },
        },
      },
      patch: {
        tags: ['Snippets'],
        security: [{ bearerAuth: [] }],
        summary: 'Update snippet metadata, content (creates version snapshot), or visibility',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Updated snippet detail' },
        },
      },
      delete: {
        tags: ['Snippets'],
        security: [{ bearerAuth: [] }],
        summary: 'Delete snippet (owner or admin only)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Deleted' },
        },
      },
    },
    '/api/snippets/{id}/versions': {
      get: {
        tags: ['Versions & Diff'],
        summary: 'Cursor-paginated version history for a snippet',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Paginated version list' },
        },
      },
      post: {
        tags: ['Versions & Diff'],
        security: [{ bearerAuth: [] }],
        summary: 'Create an explicit version checkpoint',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '201': { description: 'Created version snapshot' },
        },
      },
    },
    '/api/snippets/{id}/versions/{versionId}': {
      get: {
        tags: ['Versions & Diff'],
        summary: 'Get full content and metadata for a specific historical snippet version',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Full version snapshot detail including content' },
          '404': { description: 'Snippet or version not found' },
        },
      },
    },
    '/api/snippets/{id}/versions/{versionId}/restore': {
      post: {
        tags: ['Versions & Diff'],
        security: [{ bearerAuth: [] }],
        summary: 'Restore snippet content to a historical version (creates new restore snapshot)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Restored snippet and version' },
        },
      },
    },
    '/api/snippets/{id}/diff': {
      get: {
        tags: ['Versions & Diff'],
        summary: 'Compute structured line-by-line diff between two snippet versions',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Structured diff lines and stats' },
        },
      },
    },
    '/api/snippets/{id}/collaborators': {
      get: {
        tags: ['Collaborators'],
        summary: 'List snippet collaborators and per-snippet roles (editor | viewer)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Collaborator list' },
        },
      },
      post: {
        tags: ['Collaborators'],
        security: [{ bearerAuth: [] }],
        summary: 'Add or update a snippet collaborator role (owner or admin only)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '201': { description: 'Added/updated collaborator' },
        },
      },
    },
    '/api/snippets/{id}/collaborators/{userId}': {
      delete: {
        tags: ['Collaborators'],
        security: [{ bearerAuth: [] }],
        summary: 'Remove a collaborator from a snippet',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Collaborator removed' },
        },
      },
    },
    '/api/search/snippets': {
      get: {
        tags: ['Full-Text Search'],
        summary:
          'Weighted PostgreSQL tsvector + GIN full-text search (websearch_to_tsquery, ts_rank_cd, ts_headline) with cursor pagination',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query parsed with websearch_to_tsquery' },
          { name: 'language', in: 'query', schema: { type: 'string' } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'authorUsername', in: 'query', schema: { type: 'string' } },
          { name: 'visibility', in: 'query', schema: { type: 'string', enum: ['public', 'unlisted', 'private'] } },
          { name: 'scope', in: 'query', schema: { type: 'string', enum: ['public', 'mine', 'collaborated', 'all'] } },
          { name: 'createdFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'createdTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['relevance', 'newest', 'oldest', 'updated'] } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': { description: 'Ranked search hits with <mark> headlines and nextCursor' },
        },
      },
    },
    '/api/search/facets': {
      get: {
        tags: ['Full-Text Search'],
        summary: 'Get language and tag aggregation counts across accessible snippets',
        responses: {
          '200': { description: 'Language and tag facet counts' },
        },
      },
    },
    '/api/snippets/{snippetId}/comments': {
      get: {
        tags: ['Comments & Review Threads'],
        summary: 'List threaded line-anchored comments with dynamic isOutdated calculation',
        parameters: [
          { name: 'snippetId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Hierarchical comment threads' },
        },
      },
      post: {
        tags: ['Comments & Review Threads'],
        security: [{ bearerAuth: [] }],
        summary: 'Create a line-anchored comment or nested reply (parentId)',
        parameters: [
          { name: 'snippetId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '201': { description: 'Created comment DTO' },
        },
      },
    },
    '/api/snippets/{snippetId}/comments/{commentId}/resolve': {
      post: {
        tags: ['Comments & Review Threads'],
        security: [{ bearerAuth: [] }],
        summary: 'Resolve a comment thread and broadcast comment:resolved over Socket.io',
        parameters: [
          { name: 'snippetId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Resolved comment thread' },
        },
      },
    },
    '/api/snippets/{snippetId}/comments/{commentId}/unresolve': {
      post: {
        tags: ['Comments & Review Threads'],
        security: [{ bearerAuth: [] }],
        summary: 'Reopen a resolved comment thread',
        parameters: [
          { name: 'snippetId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Reopened comment thread' },
        },
      },
    },
    '/api/activities/global': {
      get: {
        tags: ['Activity Feed'],
        summary: 'Cursor-paginated global public activity feed (strictly excludes private/unlisted snippets)',
        responses: {
          '200': { description: 'Paginated public activities' },
        },
      },
    },
    '/api/activities/snippets/{snippetId}': {
      get: {
        tags: ['Activity Feed'],
        summary: 'Cursor-paginated activity feed for a specific snippet',
        parameters: [
          { name: 'snippetId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Paginated snippet activities' },
        },
      },
    },
    '/api/activities/users/{userId}': {
      get: {
        tags: ['Activity Feed'],
        summary: 'Cursor-paginated activity feed for a user (privacy-filtered by caller access)',
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Paginated user activities' },
        },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        summary: 'Cursor-paginated in-app notifications and unreadCount for current user',
        responses: {
          '200': { description: 'Paginated notifications' },
        },
      },
    },
    '/api/notifications/read-all': {
      post: {
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        summary: 'Mark all notifications as read for current user',
        responses: {
          '200': { description: 'Marked all read' },
        },
      },
    },
  },
};

export const docsRouter = Router();

// GET /api/docs.json -> Raw OpenAPI 3.0.3 JSON specification
docsRouter.get('/docs.json', (_req: Request, res: Response) => {
  res.status(200).json(openApiSpec);
});

// Serve Swagger UI static assets locally
docsRouter.use('/docs-assets', express.static(swaggerUiAssetPath));
docsRouter.get('/docs-assets/swagger-init.js', (_req: Request, res: Response) => {
  const initPath = path.resolve(import.meta.dirname, 'swagger-init.js');
  res.type('application/javascript').sendFile(initPath);
});

// GET /api/docs -> Interactive Swagger UI HTML page
docsRouter.get('/docs', (_req: Request, res: Response) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CodeCollab API Documentation — OpenAPI 3.0 / Swagger UI</title>
    <link rel="stylesheet" href="/api/docs-assets/swagger-ui.css" />
    <style>
      body { margin: 0; background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; }
      .topbar-banner { background: #1e293b; border-bottom: 1px solid #334155; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
      .topbar-banner h1 { margin: 0; font-size: 16px; color: #f8fafc; }
      .topbar-banner a { color: #818cf8; text-decoration: none; font-size: 13px; font-family: monospace; }
      #swagger-ui { background: #f8fafc; color: #0f172a; min-height: calc(100vh - 50px); }
    </style>
  </head>
  <body>
    <div class="topbar-banner">
      <h1>CodeCollab OpenAPI 3.0.3 Specification (Swagger UI)</h1>
      <div>
        <a href="/api/docs.json" target="_blank">Raw JSON (/api/docs.json)</a>
        &nbsp;|&nbsp;
        <a href="/">Back to Workspace</a>
      </div>
    </div>
    <div id="swagger-ui"><!-- SwaggerUIBundle mount container --></div>
    <script src="/api/docs-assets/swagger-ui-bundle.js"></script>
    <script src="/api/docs-assets/swagger-init.js"></script>
  </body>
</html>`;
  res.status(200).type('html').send(html);
});
