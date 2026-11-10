# Architecture Specification — Collaborative Code Snippet Sharing & Review Platform

## 1. Monorepo Structure & Workspace Layout

CodeCollab is organized as an **npm workspaces monorepo** with independent `/frontend` and `/backend` packages, unified development scripts, and production container configurations:

```text
/
├── package.json                  # Root npm workspaces (["frontend", "backend"]) + build/lint/test scripts
├── tsconfig.json                 # Root TypeScript configuration
├── .env.example                  # Documented root environment template
├── docker-compose.yml            # Multi-container production deployment (Postgres, backend, frontend)
├── docker-compose.dev.yml        # Development environment (PostgreSQL 16 only)
├── .github/workflows/ci.yml      # CI workflow running lint, typecheck, tests, and build
├── docs/
│   ├── ARCHITECTURE.md           # System architecture, data model, RBAC matrix, and API specs
│   └── REALTIME.md               # Socket.io & Yjs collaboration protocol specification
├── backend/
│   ├── package.json              # Backend package manifest and script targets
│   ├── tsconfig.json             # Backend TypeScript configuration
│   ├── .env.example              # Backend environment variable template
│   ├── Dockerfile                # Multi-stage production container build
│   ├── drizzle.config.ts         # Drizzle Kit configuration reading DATABASE_URL or SQL_* vars
│   ├── drizzle/                  # Committed SQL migration files (0000_init.sql)
│   └── src/
│       ├── index.ts              # HTTP + Socket.io server bootstrap
│       ├── app.ts                # Express app factory (helmet, CORS, pino-http, routes, errors)
│       ├── config/
│       │   ├── env.ts            # Zod environment schema validation and normalization
│       │   └── logger.ts         # Pino structured logger correlated with X-Request-Id
│       ├── db/
│       │   ├── index.ts          # PostgreSQL pool connection and Drizzle client instance
│       │   ├── schema.ts         # Drizzle schema (11 tables, FKs, indexes, tsvector)
│       │   └── seed.ts           # Idempotent development seed script
│       ├── auth/
│       │   ├── authorize.ts      # Central authorization engine (global + snippet RBAC)
│       │   ├── jwt.ts            # JWT access token generation and verification
│       │   ├── refresh.ts        # Opaque refresh token generation, SHA-256 hashing, family reuse detection
│       │   ├── transport.ts      # Token transport abstraction (bearer | cookie)
│       │   ├── password.ts       # bcrypt password hashing and verification
│       │   └── github-oauth.ts   # GitHub OAuth flow, state verification, postMessage popup
│       ├── middleware/
│       │   ├── request-id.ts     # X-Request-Id propagation and child logger binding
│       │   ├── authenticate.ts   # Token extraction and req.user population
│       │   ├── validate.ts       # Zod schema request validation middleware
│       │   ├── rate-limit.ts     # IP and compound-key rate limiters
│       │   └── error-handler.ts  # Standardized JSON error response handler
│       ├── modules/
│       │   ├── auth/             # Authentication routes, schemas, and controllers
│       │   ├── users/            # Profile updates, password changes, admin role management
│       │   ├── snippets/         # Snippet CRUD, visibility, collaborators, versions, diffs
│       │   ├── search/           # tsvector full-text search, rank, headline, facets
│       │   ├── comments/         # Line-anchored threaded comments, resolution, outdated markers
│       │   ├── notifications/    # MailService (console/smtp) and in-app notifications
│       │   └── activity/         # Domain event bus and activity feed streams
│       ├── realtime/
│       │   ├── socket-server.ts  # Socket.io setup, handshake auth, room lifecycle, expiry sweeps
│       │   ├── yjs-room-hub.ts   # In-memory Y.Doc management, viewer write-block, DB flush
│       │   └── socket-limiter.ts # Token-bucket event rate limiter
│       └── __tests__/            # Backend integration and unit test suites
└── frontend/
    ├── package.json              # Frontend package manifest and script targets
    ├── tsconfig.json             # Frontend TypeScript configuration
    ├── .env.example              # Frontend environment variable template
    ├── Dockerfile                # Multi-stage production container build (Nginx)
    ├── nginx.conf                # Nginx reverse proxy, SPA fallback, and security headers
    ├── vite.config.ts            # Vite configuration with Tailwind CSS v4 and Monaco aliases
    ├── index.html                # Single-page HTML entrypoint
    └── src/
        ├── main.tsx              # React 19 entrypoint
        ├── App.tsx               # App shell, responsive drawers, and view routing
        ├── index.css             # Tailwind v4 theme tokens, frosted glass, and custom scrollbars
        ├── api/
        │   ├── client.ts         # Fetch API client with automatic token refresh
        │   └── transport.ts      # Client-side auth session and header transport
        ├── store/
        │   ├── authStore.ts      # Zustand auth state slice
        │   ├── snippetStore.ts   # Zustand snippet, version, and filter state slice
        │   ├── realtimeStore.ts  # Zustand presence, comments, and activity state slice
        │   └── themeStore.ts     # Light and dark theme persistence
        ├── types/
        │   └── domain.ts         # Shared frontend DTO interfaces and types
        ├── utils/
        │   ├── binary.ts         # Base64 <-> Uint8Array conversion helpers
        │   ├── format.ts         # Timestamp, role, and language display formatters
        │   └── landingRouting.ts # First-time landing page routing logic
        ├── components/
        │   ├── layout/           # AppShell, IconRail, ShellHeader, navConfig
        │   ├── landing/          # LandingView, Hero, Illustration, HowItWorks, Features, Cta, Footer
        │   ├── snippets/         # SnippetExplorerSidebar, SidebarProfileBlock, SidebarFacetsTree, SnippetModals
        │   ├── editor/           # CollaborativeMonacoWorkspace, VersionHistoryDiffModal, WorkspaceStatStrip
        │   ├── comments/         # CommentReviewSidebar
        │   ├── activity/         # ActivityFeedView
        │   ├── admin/            # AdminUsersView
        │   ├── auth/             # AuthModals
        │   └── ui/               # CustomSelect
        └── __tests__/            # Frontend unit and routing test suites
```

---

## 2. Database Schema & Indexing Strategy (PostgreSQL + Drizzle ORM)

### 2.1 Dual Connection Support (`DATABASE_URL` and Platform `SQL_*`)
`backend/src/config/env.ts` and `backend/src/db/index.ts` support two connection modes without changing any application code:
1. **Standard PostgreSQL (`DATABASE_URL`)**: Used in local development outside AI Studio, CI, and `docker-compose.yml`. Parses `DATABASE_URL` into `{ host, port, user, password, database }` for `pg.Pool`.
2. **AI Studio Built-in Cloud SQL (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`)**: Used when running inside AI Studio with the Cloud SQL Auth Proxy Unix socket.

### 2.2 Tables, Columns, Foreign Keys & Cascades

1. **`users`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `email`: `varchar(255)` NOT NULL UNIQUE
   - `username`: `varchar(64)` NOT NULL UNIQUE
   - `display_name`: `varchar(120)` NOT NULL
   - `password_hash`: `text` NULLABLE (null for pure GitHub OAuth users)
   - `github_id`: `varchar(64)` NULLABLE UNIQUE
   - `avatar_url`: `text` NULLABLE
   - `global_role`: `varchar(16)` NOT NULL DEFAULT `'editor'` (`'admin' | 'editor' | 'viewer'`)
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - `updated_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - *Indexes*: `users_email_idx`, `users_username_idx`, `users_global_role_idx`, `users_created_at_idx`

2. **`refresh_tokens`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `user_id`: `uuid` NOT NULL FK -> `users.id` (`ON DELETE CASCADE`)
   - `token_hash`: `varchar(128)` NOT NULL UNIQUE (SHA-256 hex digest of opaque token)
   - `family_id`: `uuid` NOT NULL (groups rotated tokens from the same login session)
   - `revoked_at`: `timestamptz` NULLABLE
   - `replaced_by_id`: `uuid` NULLABLE
   - `expires_at`: `timestamptz` NOT NULL
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - *Indexes*: `refresh_tokens_user_id_idx`, `refresh_tokens_family_id_idx`, `refresh_tokens_token_hash_idx`

3. **`snippets`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `title`: `varchar(200)` NOT NULL
   - `description`: `text` NOT NULL DEFAULT `''`
   - `language`: `varchar(40)` NOT NULL DEFAULT `'typescript'`
   - `visibility`: `varchar(16)` NOT NULL DEFAULT `'public'` (`'public' | 'unlisted' | 'private'`)
   - `owner_id`: `uuid` NOT NULL FK -> `users.id` (`ON DELETE CASCADE`)
   - `current_content`: `text` NOT NULL DEFAULT `''`
   - `current_version_id`: `uuid` NULLABLE
   - `latest_version_number`: `integer` NOT NULL DEFAULT `1`
   - `yjs_state`: `text` NULLABLE (base64-encoded `Uint8Array` from `Y.encodeStateAsUpdate(doc)`)
   - `tags_text`: `text` NOT NULL DEFAULT `''` (space-delimited tag names for `tsvector` indexing)
   - `search_vector`: `tsvector` (weighted PostgreSQL full-text search column: `'A'` on `title`, `'B'` on `tags_text`, `'C'` on `current_content`)
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - `updated_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - *Indexes*:
     - `snippets_owner_id_idx` (`owner_id`)
     - `snippets_language_idx` (`language`)
     - `snippets_visibility_idx` (`visibility`)
     - `snippets_created_at_idx` (`created_at DESC, id DESC`)
     - `snippets_updated_at_idx` (`updated_at DESC, id DESC`)
     - `snippets_search_vector_idx` (`USING GIN (search_vector)`)

4. **`snippet_versions`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `snippet_id`: `uuid` NOT NULL FK -> `snippets.id` (`ON DELETE CASCADE`)
   - `version_number`: `integer` NOT NULL
   - `author_id`: `uuid` NULLABLE FK -> `users.id` (`ON DELETE SET NULL`)
   - `content`: `text` NOT NULL
   - `yjs_state`: `text` NULLABLE
   - `source`: `varchar(24)` NOT NULL DEFAULT `'manual'` (`'initial' | 'manual' | 'autosave' | 'restore'`)
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - *Indexes*: `snippet_versions_snippet_id_idx`, `snippet_versions_author_id_idx`, `snippet_versions_created_at_idx`, unique composite `(snippet_id, version_number)`

5. **`snippet_collaborators`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `snippet_id`: `uuid` NOT NULL FK -> `snippets.id` (`ON DELETE CASCADE`)
   - `user_id`: `uuid` NOT NULL FK -> `users.id` (`ON DELETE CASCADE`)
   - `role`: `varchar(16)` NOT NULL (`'editor' | 'viewer'`)
   - `added_by_id`: `uuid` NULLABLE FK -> `users.id` (`ON DELETE SET NULL`)
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - *Indexes*: `snippet_collaborators_snippet_id_idx`, `snippet_collaborators_user_id_idx`, unique composite `(snippet_id, user_id)`

6. **`tags`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `name`: `varchar(48)` NOT NULL UNIQUE (normalized lowercase slug)
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`

7. **`snippet_tags`**
   - `snippet_id`: `uuid` NOT NULL FK -> `snippets.id` (`ON DELETE CASCADE`)
   - `tag_id`: `uuid` NOT NULL FK -> `tags.id` (`ON DELETE CASCADE`)
   - *Primary Key & Indexes*: Composite PK `(snippet_id, tag_id)`, `snippet_tags_snippet_id_idx`, `snippet_tags_tag_id_idx`

8. **`comments`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `snippet_id`: `uuid` NOT NULL FK -> `snippets.id` (`ON DELETE CASCADE`)
   - `author_id`: `uuid` NOT NULL FK -> `users.id` (`ON DELETE CASCADE`)
   - `parent_id`: `uuid` NULLABLE FK -> `comments.id` (`ON DELETE CASCADE`)
   - `line_number`: `integer` NOT NULL (1-indexed line anchor on the target version)
   - `version_id`: `uuid` NOT NULL FK -> `snippet_versions.id` (`ON DELETE CASCADE`)
   - `anchor_line_text`: `text` NOT NULL (exact text of `line_number` at the time the comment was created; used to compute `isOutdated` when current snippet line text at `line_number` differs)
   - `body`: `text` NOT NULL
   - `resolved`: `boolean` NOT NULL DEFAULT `false`
   - `resolved_by_id`: `uuid` NULLABLE FK -> `users.id` (`ON DELETE SET NULL`)
   - `resolved_at`: `timestamptz` NULLABLE
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - `updated_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - *Indexes*: `comments_snippet_id_idx`, `comments_author_id_idx`, `comments_parent_id_idx`, `comments_version_id_idx`, `comments_created_at_idx`

9. **`activities`**
   - `id`: `uuid` PK (`defaultRandom()`)
   - `actor_id`: `uuid` NOT NULL FK -> `users.id` (`ON DELETE CASCADE`)
   - `type`: `varchar(40)` NOT NULL (`'snippet.created' | 'snippet.edited' | 'snippet.deleted' | 'comment.added' | 'comment.resolved' | 'collaborator.added'`)
   - `snippet_id`: `uuid` NULLABLE FK -> `snippets.id` (`ON DELETE SET NULL`)
   - `visibility`: `varchar(16)` NOT NULL DEFAULT `'public'`
   - `metadata`: `jsonb` NOT NULL DEFAULT `'{}'`
   - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
   - *Indexes*: `activities_actor_id_idx`, `activities_snippet_id_idx`, `activities_visibility_idx`, `activities_created_at_idx`

10. **`notifications`**
    - `id`: `uuid` PK (`defaultRandom()`)
    - `recipient_id`: `uuid` NOT NULL FK -> `users.id` (`ON DELETE CASCADE`)
    - `actor_id`: `uuid` NULLABLE FK -> `users.id` (`ON DELETE SET NULL`)
    - `type`: `varchar(40)` NOT NULL (`'comment.added' | 'comment.reply' | 'comment.resolved' | 'collaborator.added'`)
    - `snippet_id`: `uuid` NULLABLE FK -> `snippets.id` (`ON DELETE CASCADE`)
    - `comment_id`: `uuid` NULLABLE FK -> `comments.id` (`ON DELETE CASCADE`)
    - `title`: `varchar(200)` NOT NULL
    - `message`: `text` NOT NULL
    - `read_at`: `timestamptz` NULLABLE
    - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
    - *Indexes*: `notifications_recipient_id_idx`, `notifications_created_at_idx`

11. **`oauth_states`**
    - `nonce`: `text` PK
    - `origin`: `text` NOT NULL
    - `expires_at`: `timestamptz` NOT NULL
    - `consumed_at`: `timestamptz` NULLABLE
    - `created_at`: `timestamptz` NOT NULL DEFAULT `now()`
    - *Indexes*: `oauth_states_expires_at_idx`

### 2.3 Full-Text Search `tsvector` + `GIN` Index Implementation Note
Drizzle ORM's `pg-core` supports custom column types via `customType<{ data: string }>({ dataType: () => 'tsvector' })`. Whenever a snippet's `title`, `tags_text`, or `current_content` is inserted or updated, we compute the weighted `search_vector` directly in SQL:
```sql
setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
setweight(to_tsvector('english', coalesce(tags_text, '')), 'B') ||
setweight(to_tsvector('english', coalesce(current_content, '')), 'C')
```
And we create the `GIN` index `CREATE INDEX IF NOT EXISTS snippets_search_vector_idx ON snippets USING GIN (search_vector);` in both the Drizzle schema definition and the committed SQL migration (`backend/drizzle/0000_init.sql`).

---

## 3. Central Authorization Model (`backend/src/auth/authorize.ts`)

All permission checks in both Express route handlers and Socket.io event handlers go through **one** module (`backend/src/auth/authorize.ts`). No ad-hoc `if (req.user.role === ...)` checks are permitted outside this module.

### 3.1 Role Hierarchy & Effective Snippet Role Resolution
1. **Global Roles (`user.globalRole`)**:
   - `admin`: Superuser across the platform. Can manage global user roles, view/edit/delete any snippet, manage collaborators, and resolve any comment.
   - `editor`: Standard authenticated creator. Can create snippets and act according to their per-snippet role on existing snippets.
   - `viewer`: Global read/comment-only user. **Cannot create new snippets** and **cannot edit snippet code**, even if granted collaborator `editor` role on a snippet (global `viewer` caps write privileges to read + comment unless promoted by an admin, OR we document the exact combination rule below).

2. **Explicit Combination Rule (Global Role $\times$ Per-Snippet Role $\times$ Visibility)**:
   Given an `actor` (`User | null`) and a `snippet` (`{ ownerId, visibility, collaboratorRole: 'editor' | 'viewer' | null }`):
   - **Step 1 — Admin Override**: If `actor?.globalRole === 'admin'`, effective role on every resource is `'admin'` (full read/write/manage/delete).
   - **Step 2 — Ownership**: If `actor && snippet.ownerId === actor.id`, effective role is `'owner'` (full read/write/manage/delete on that snippet, unless `actor.globalRole === 'viewer'`, in which case write actions are restricted to read-only until promoted).
   - **Step 3 — Explicit Collaborator**:
     - If `collaboratorRole === 'editor'` and `actor.globalRole !== 'viewer'`, effective snippet role is `'editor'` (can read, edit code live over Yjs/REST, save versions, restore versions, add/resolve comments; cannot delete snippet or change visibility/collaborators).
     - If `collaboratorRole === 'viewer'` (or `collaboratorRole === 'editor'` while `actor.globalRole === 'viewer'`), effective snippet role is `'viewer'` (can read snippet, join Socket.io room as read-only observer, and post comments; **blocked from editing code or saving versions**).
   - **Step 4 — Non-Collaborator / Anonymous Visibility Rule**:
     - If `snippet.visibility === 'public'` or `'unlisted'`:
       - Authenticated users have effective snippet role `'viewer'` (can view code, view versions/diffs, join live room read-only, and add comments).
       - Anonymous (`null`) users have effective snippet role `'anonymous_viewer'` (can view `public`/`unlisted` snippets and versions; cannot post comments or mutate anything; note that `'unlisted'` snippets are excluded from global search and public activity feeds).
     - If `snippet.visibility === 'private'`:
       - Non-collaborators have effective role `'none'` (`403 Forbidden` / `404 Not Found` to prevent ID enumeration).

### 3.2 Action Permission Matrix

| Action | `admin` | `owner` (`globalRole='editor'`) | `collaborator:editor` (`globalRole='editor'`) | `viewer` (Collab or Auth on Public/Unlisted) | `anonymous_viewer` (Public/Unlisted) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `user:manage_roles` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `snippet:create` | ✅ | ✅ (any global `editor`) | — | ❌ (if global `viewer`) | ❌ |
| `snippet:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `snippet:edit` (REST & Yjs WS) | ✅ | ✅ | ✅ | ❌ | ❌ |
| `snippet:version:create` / `restore` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `snippet:manage_collaborators` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `snippet:delete` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `comment:create` / `reply` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `comment:resolve` | ✅ | ✅ | ✅ | ✅ (if comment author) | ❌ |

---

## 4. Authentication & Token Transport Architecture

### 4.1 Token Lifecycle
- **Access Token**: Short-lived signed JWT (`HS256`, `15m` expiry) containing `{ sub: user.id, email, username, globalRole, iat, exp }`.
- **Refresh Token**: 32-byte cryptographically random hex string (`crypto.randomBytes(32).toString('hex')`).
  - Only the `SHA-256` hash (`token_hash`) is persisted in `refresh_tokens`.
  - Every refresh token belongs to a `family_id` (UUID generated at initial login/OAuth).
  - **Rotation & Reuse Detection**:
    1. When `POST /api/auth/refresh` is called with a refresh token, the server looks up `token_hash`.
    2. If the token record has `revoked_at !== null` (meaning it was already used and rotated), **reuse is detected**: the server immediately revokes **every token in the same `family_id`** (`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1`), logs a security warning with `requestId`, and returns `401 { error: { code: 'REFRESH_TOKEN_REUSED', message: '...' } }`.
    3. If valid and unexpired, the server marks the current token `revoked_at = now()`, inserts a new token row with the same `family_id`, links `replaced_by_id`, and returns the new access + refresh token pair.

### 4.2 Swappable Token Transport (`AUTH_TRANSPORT=bearer|cookie`)
`backend/src/auth/transport.ts` and `frontend/src/api/transport.ts` encapsulate how tokens are transmitted:
- **`bearer` mode (Default for AI Studio Preview Iframe)**:
  - Server returns `{ accessToken, refreshToken, user }` in JSON body on login/register/refresh/OAuth.
  - Client stores `accessToken` strictly in memory (JS closure variable) and `refreshToken` in `sessionStorage` (never `localStorage`).
  - Client sends `Authorization: Bearer <accessToken>` on all REST and Socket.io requests.
- **`cookie` mode (Supported for non-iframe deployments)**:
  - Server sets `refresh_token` in an `httpOnly` cookie (`Secure`, `SameSite` configurable via `COOKIE_SAME_SITE=lax|strict|none`) and accepts it on `/api/auth/refresh` and `/api/auth/logout`.

### 4.3 GitHub OAuth Popup Flow
1. Client opens popup window navigating to `GET /api/auth/github/start?origin=<app_origin>`.
2. Backend validates `origin` against the allowlist, creates an HMAC-signed state nonce in `oauth_states`, sets an `httpOnly`, `SameSite=Lax`, `path=/api/auth` cookie, and redirects to GitHub.
3. GitHub redirects the popup to `GET /api/auth/github/callback?code=...&state=...`.
4. Server verifies the signed `state`, exchanges `code` for a GitHub access token, fetches profile and verified email, upserts user, issues tokens, and renders a page whose external script posts the result to the opener with a strict target origin and also broadcasts over a same-origin `BroadcastChannel` as a fallback.

---

## 5. REST API Endpoints

All list endpoints support cursor pagination (`?cursor=<opaque_base64>&limit=<1..100>`) and return `{ items: T[], nextCursor: string | null, hasMore: boolean }`. All errors return `{ error: { code: string, message: string, details?: unknown } }`.

### 5.1 System & Health
- `GET /api/health` — Basic health check (`{ status: 'ok', db: 'connected', timestamp, requestId }`).
- `GET /api/health/ready` — Detailed readiness probe evaluating database connectivity, migration status, and runtime environment (supports `HEALTH_CHECK_SECRET`).
- `GET /api/docs` — Swagger UI interactive API documentation.
- `GET /api/docs.json` — Raw OpenAPI 3.0.3 specification in JSON format.

### 5.2 Auth (`/api/auth`)
- `GET /api/auth/providers` — Return configured authentication providers (`{ github: boolean, passwordLogin: boolean }`).
- `POST /api/auth/register` — Register new user (rate-limited).
- `POST /api/auth/login` — Email/username + password login (rate-limited).
- `POST /api/auth/refresh` — Rotate refresh token & issue new access token (with family reuse detection).
- `POST /api/auth/logout` — Revoke current refresh token family.
- `GET /api/auth/me` — Return current authenticated user profile.
- `GET /api/auth/github/url` — Return GitHub OAuth authorization URL with signed `state`.
- `GET /api/auth/github/start` — Initiate GitHub OAuth popup flow with origin validation and cookie state.
- `GET /api/auth/github/callback` — Handle GitHub OAuth code exchange and render popup closer.

### 5.3 Users & Admin (`/api/users`)
- `PATCH /api/users/me` — Update `displayName`, `username`, `avatarUrl`.
- `POST /api/users/me/password` — Change password (verifies current password, revokes other refresh token families).
- `GET /api/users` — List users with cursor pagination & search (for admin & collaborator picker).
- `PATCH /api/users/:id/role` — Admin-only endpoint to update a user's `globalRole` (`admin | editor | viewer`).

### 5.4 Snippets, Versions, Diffs & Collaborators (`/api/snippets`)
- `POST /api/snippets` — Create snippet + initial `snippet_versions` record (`version_number = 1`) + emit `snippet.created`.
- `GET /api/snippets` — Cursor-paginated list of visible snippets (supports `visibility`, `language`, `authorId`, `tag`, `sort`).
- `GET /api/snippets/:id` — Get snippet detail, tags, collaborators, effective permissions, and latest version metadata.
- `PATCH /api/snippets/:id` — Update title, description, language, visibility, tags, or content (creates new version snapshot if content changed).
- `DELETE /api/snippets/:id` — Delete snippet (`owner` or `admin` only) + emit `snippet.deleted`.
- `GET /api/snippets/:id/versions` — Cursor-paginated version history with author and timestamp.
- `POST /api/snippets/:id/versions` — Explicitly save a new version snapshot.
- `POST /api/snippets/:id/versions/:versionId/restore` — Restore snippet content to a historical version (creates a new version snapshot recording the restore).
- `GET /api/snippets/:id/diff?from=<versionId>&to=<versionId>` — Compute structured line-by-line diff between two versions.
- `GET /api/snippets/:id/collaborators` — List collaborators on a snippet.
- `POST /api/snippets/:id/collaborators` — Add or update collaborator (`role: 'editor' | 'viewer'`) + emit `collaborator.added` & notification.
- `DELETE /api/snippets/:id/collaborators/:userId` — Remove collaborator.

### 5.5 Full-Text Search (`/api/search`)
- `GET /api/search/snippets` — Query parameters: `q` (search query parsed via `websearch_to_tsquery('english', q)`), `language`, `authorId`, `tag`, `createdFrom`, `createdTo`, `sort` (`relevance | newest | oldest | updated`), `cursor`, `limit`. Returns ranked snippets with `rank` (`ts_rank_cd`) and `headline` (`ts_headline` highlighted snippet).
- `GET /api/search/facets` — Returns aggregated facet counts (languages, tags, and visibility breakdown) based on snippets accessible to the caller.

### 5.6 Comments & Review Threads (`/api/snippets/:snippetId/comments`)
- `GET /api/snippets/:snippetId/comments` — List threaded comments for a snippet, computing `isOutdated: boolean` by comparing `comment.anchorLineText` against the current line at `comment.lineNumber`.
- `POST /api/snippets/:snippetId/comments` — Create top-level line-anchored comment or reply (`parentId`) + emit `comment.added` + trigger `MailService` & in-app notification.
- `PATCH /api/snippets/:snippetId/comments/:commentId` — Edit comment body (author only).
- `POST /api/snippets/:snippetId/comments/:commentId/resolve` — Resolve thread + record `resolvedById` and `resolvedAt` + emit `comment.resolved`.
- `POST /api/snippets/:snippetId/comments/:commentId/unresolve` — Re-open resolved thread.
- `DELETE /api/snippets/:snippetId/comments/:commentId` — Delete comment (author, snippet owner, or admin).

### 5.7 Activity Feed & Notifications (`/api/activities`, `/api/notifications`)
- `GET /api/activities/global` — Cursor-paginated global public activity feed (`visibility = 'public'` only).
- `GET /api/activities/snippets/:snippetId` — Cursor-paginated activity feed for a specific snippet (authorized via `snippet:read`).
- `GET /api/activities/users/:userId` — Cursor-paginated activity feed for a user (filtering private activities unless caller has access).
- `GET /api/notifications` — Cursor-paginated in-app notifications for the current user.
- `POST /api/notifications/:id/read` — Mark notification as read.
- `POST /api/notifications/read-all` — Mark all notifications as read.

---

## 6. Real-Time Socket.io & Yjs Protocol Summary

Full event schemas will be documented in `docs/REALTIME.md` in Phase 9. Core protocol design:

- **Namespace / Endpoint**: Default namespace `/` over path `/socket.io` on the unified HTTP server.
- **Handshake Authentication**:
  - Client passes `{ auth: { token: accessToken } }` (or cookie in cookie mode).
  - Server middleware verifies the JWT, attaches `socket.data.user` and `socket.data.tokenExp = decoded.exp`.
  - Before processing **any** incoming socket event, a wrapper checks `Date.now() / 1000 >= socket.data.tokenExp` (and allows `auth:refresh-token` over the socket to update the token without dropping the room) and runs the per-socket token-bucket rate limiter (`socket-limiter.ts`).
- **Core Events**:
  - `auth:refresh` (Client $\to$ Server): Updates the socket's access token before or upon expiry.
  - `snippet:join` (Client $\to$ Server): `{ snippetId }`. Checks `authorize(user, 'snippet:read', snippet)`. Joins room `snippet:<snippetId>`, loads or initializes the in-memory `Y.Doc` from PostgreSQL, sends `yjs:init` (`{ state: base64State, versionId, role }`) and broadcasts updated room presence (`presence:state`).
  - `snippet:leave` (Client $\to$ Server): `{ snippetId }`. Leaves room; if room becomes empty, immediately flushes `Y.Doc` state and plain text (`yDoc.getText('monaco').toString()`) to PostgreSQL and evicts from memory.
  - `yjs:update` (Client $\leftrightarrow$ Server): `{ snippetId, update: base64Uint8Array }`. **Server strictly checks `authorize(user, 'snippet:edit', snippet)`**; if the caller is a `viewer`, the server rejects the event with `error: { code: 'FORBIDDEN_READ_ONLY' }` and does **not** apply or broadcast the update. If authorized, applies update to server `Y.Doc`, broadcasts to other room members, and schedules debounced DB persistence + version snapshot.
  - `awareness:update` (Client $\leftrightarrow$ Server): `{ snippetId, cursor: { lineNumber, column }, selection, user }`. Broadcasts live cursor and selection positions to collaborators in `snippet:<snippetId>`.
  - `snippet:save-version` (Client $\to$ Server): `{ snippetId, summary? }`. Checks `snippet:edit`, flushes current `Y.Doc` into a new `snippet_versions` row, and broadcasts `version:created` to the room.
  - `comment:created`, `comment:updated`, `comment:resolved`, `activity:new`, `notification:new` (Server $\to$ Client): Pushed in real time to subscribed rooms.

---

## 8. Hardening & Security Architecture

### 8.1 Rate Limiting Architecture
- **Proxy Hop Trust**: Express `trust proxy` is configured strictly to `TRUST_PROXY_HOPS` (default: 0). Untrusted clients cannot bypass IP rate limits by injecting arbitrary `X-Forwarded-For` headers.
- **Compound Keys**: Authentication rate limiting (`/api/auth/login`, `/api/auth/register`) uses a compound key: `req.ip + ':' + sha256(identifier)`. This prevents account enumeration or localized lockout from blocking legitimate users sharing an IP or proxy.

### 8.2 OAuth State Lifecycle & Double-Submit Protection
- State tokens generated during `/api/auth/github` are signed with HMAC (`OAUTH_STATE_SECRET`) and persisted in the `oauth_states` PostgreSQL table.
- A cryptographically random nonce is set in an `httpOnly`, `SameSite=Lax` browser cookie (`cc_oauth_state`).
- The callback `/api/auth/github/callback` validates signature, expiry (10 min), and cookie nonce equality, and atomically deletes the state row (`single-use`). Replayed states fail with `400 OAUTH_STATE_REPLAYED`.

### 8.3 Content Security Policy & Self-Hosted Assets
- The CSP is enforced via Helmet: `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `connect-src 'self' ws: wss:`.
- Inline scripts and CDN dependencies are eliminated. Swagger UI assets (bundle, standalone preset, css) are self-hosted under `/api/docs-assets`.
- OAuth popup callback uses an external script `/oauth-popup.js` that emits structured JSON messages via `postMessage`.

### 8.4 Live Socket Revocation & Real-Time Security
- `yjsRoomHub.revokeSnippetAccess(snippetId)` verifies whether active sockets still satisfy `snippet:read` whenever snippet visibility or collaborators change. Unauthorized sockets are evicted immediately.
- Client stores are invalidated with `snippet:invalidate` instead of broadcasting raw snippet code in change events.

### 8.5 Secret Rotation & Dual-Transport Architecture
- Supports zero-downtime key rotation using `JWT_ACCESS_SECRET_PREVIOUS` and `JWT_REFRESH_SECRET_PREVIOUS`.
- Dual transport modes: `bearer` (in-memory token) and `cookie` (`httpOnly` cookies with strict Origin/Referer CSRF protection on state mutations). In cookie mode, response bodies omit sensitive tokens.

### 8.6 Lightweight List DTOs & Bounded Scaling
- List and search endpoints return `SnippetSummaryDTO` (omitting `currentContent`, providing `contentLength`).
- Snippet versions list returns `SnippetVersionSummaryDTO` without full source code; individual version contents are retrieved on-demand via `GET /api/snippets/:id/versions/:versionId`.
- Batch hydration uses PostgreSQL `inArray` queries across owners, tags, and collaborators, eliminating N+1 query patterns.
- Version snapshots acquire transactional pessimistic locks (`SELECT ... FOR UPDATE`) preventing concurrent version number collisions.
