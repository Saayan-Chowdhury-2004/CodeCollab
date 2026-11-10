# Build & Verification Progress Log (`docs/PROGRESS.md`)

## Overview
Tracks phase-by-phase implementation status, verification commands executed, real outputs observed, unverified items, and open items for the Collaborative Code Snippet Sharing & Review Platform.

---

## Phase Status Summary

| Phase | Title | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Phase 0** | Environment Report, `docs/ARCHITECTURE.md`, `docs/PROGRESS.md` | **COMPLETED** | Architecture, data model, central auth matrix, REST/WS specs, and hybrid monorepo layout documented. |
| **Phase 1** | Repo Skeleton, Drizzle Schema & Migrations, Env Validation, Logging, Health & Seed | **COMPLETED** | Cloud SQL Postgres provisioned, 10-table schema + GIN index pushed, committed SQL migration created, seed & 5 Vitest tests passing, restart persistence verified. |
| **Phase 2** | Auth (JWT, Refresh Family Reuse Detection, GitHub OAuth Popup) & Central Authorization | **COMPLETED** | Register/login/logout/me, refresh rotation with family reuse revocation, `bearer\|cookie` transport, profile edit, password change, admin role management, GitHub OAuth popup flow, central `authorize.ts` module, and 11/11 Vitest tests passing. |
| **Phase 3** | Snippet CRUD, Visibility, Collaborators, Tags, Versions, Restore & Diff | **COMPLETED** | Snippet CRUD, `public`/`unlisted`/`private` visibility rules, collaborators (`editor`/`viewer`), tags, `snippet_versions` snapshots, restore, structured line diff, internal `domainEventBus`, and 15/15 Vitest tests passing. |
| **Phase 4** | Full-Text Search (`tsvector` + `GIN`) & Cursor Pagination | **COMPLETED** | Weighted PostgreSQL `tsvector` + `GIN` search (`websearch_to_tsquery`, `ts_rank_cd`, `ts_headline`), filters (`language`, `tag`, `authorId`, `authorUsername`, `createdFrom`, `createdTo`, `visibility`, `scope`), cursor pagination across `relevance`/`newest`/`oldest`/`updated`, facets endpoint, zero `LIKE`/`ILIKE` queries, and 19/19 Vitest tests passing. |
| **Phase 5** | Real-Time Collaborative Editing (Socket.io + Yjs + Viewer Write-Block) | **COMPLETED** | Socket.io + Yjs room hub, JWT handshake & mid-session expiry check (`auth:refresh`), per-socket token-bucket rate limiter, presence & cursors, reconnect state-vector resync, empty-room & checkpoint DB persistence, server-side viewer write-block (`FORBIDDEN_READ_ONLY`), and 23/23 Vitest tests passing. |
| **Phase 6** | Threaded Line Comments, Resolve Flow, Outdated Markers, MailService & Notifications | **COMPLETED** | Line-anchored threaded comments & replies, resolve/unresolve with central auth, dynamic `isOutdated` detection when anchored lines change, swappable `MailService` (`ConsoleMailService` + `SmtpMailService`), in-app notifications (`/api/notifications`), live socket broadcasts, and 27/27 Vitest tests passing. |
| **Phase 7** | Activity Feed (Internal EventBus, Persistence & Socket Push) | **COMPLETED** | Internal `domainEventBus` subscriber persisting `activities`, live Socket.io `activity:new` push to `feed:global`, `snippet:<id>`, and `user:<id>`, cursor-paginated global (`public` only), per-snippet, and per-user activity feeds with privacy enforcement, and 30/30 Vitest tests passing. |
| **Phase 8** | Full Frontend Implementation (React + Zustand + Monaco + Yjs + Diff + Admin) | **COMPLETED** | Full React 19 + Tailwind + Zustand + Monaco + Yjs frontend in `/frontend/src` with Auth & GitHub OAuth popup, 1-click demo switcher, `tsvector` search & filters, collaborative Monaco + Yjs editor with presence/cursors & viewer write-block test button, line comments with `OUTDATED` badges, version diff/restore, activity feed, notifications, profile, admin roles, and 33/33 Vitest tests passing. |
| **Phase 9** | OpenAPI (`/api/docs`), `docs/REALTIME.md`, `README.md`, Docker, CI & Final Audit | **COMPLETED** | OpenAPI 3.0.3 + Swagger UI at `/api/docs` & `/api/docs.json`, `docs/REALTIME.md`, `README.md` with Mermaid diagram & security checklist, `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, and 36/36 Vitest tests passing across all 9 phases. |

---

## Detailed Phase Logs

### Phase 0 — Environment Discovery & Architecture Specification
- **Built**: `docs/ARCHITECTURE.md` (400 lines), `docs/PROGRESS.md`, `metadata.json`.
- **Verified**: `node -v && npm -v && ls -la docs && wc -l docs/ARCHITECTURE.md docs/PROGRESS.md`.
- **Unverified**: None.

### Phase 1 — Repo Skeleton, Drizzle Schema & Migrations, Env Validation, Logging, Health & Seed
- **Built**: Cloud SQL PostgreSQL instance (`ai-studio-8f332d96`), npm workspaces (`frontend`, `backend`), 10-table Drizzle schema + committed SQL migration (`backend/drizzle/0000_init.sql`), Zod boot env validation, Pino logger with `requestId`, consistent error handler, `/api/health`, idempotent seed script, and `backend/src/__tests__/phase1.test.ts`.
- **Verified**: `cloudsql.UpdateSchema`, `cloudsql.ExecuteSql`, `npm run seed`, `npm test` (5/5 passed), `restart_dev_server` + `curl -i http://localhost:3000/api/health`, `compile_applet`, `lint_applet`.
- **Unverified**: Standalone Docker Compose `drizzle-kit migrate` (no Docker daemon in container).

### Phase 2 — Auth, Refresh Token Rotation with Reuse Detection, GitHub OAuth Popup & Central Authorization
- **Built**: `password.ts`, `jwt.ts`, `refresh.ts` (with reuse detection revoking full token family), `transport.ts` (`bearer|cookie`), `authorize.ts` (single central authorization module), `authenticate.ts`, `github-oauth.ts`, `auth.service.ts`, `auth.routes.ts`, `users.service.ts`, `users.routes.ts`, `pagination.ts`, `sanitize.ts`, and `backend/src/__tests__/phase2.test.ts`.
- **Verified**: `npm test` (11/11 passed), `compile_applet`, `lint_applet`.
- **Unverified**: Live GitHub OAuth redirect with production GitHub credentials; third-party cookie behavior in strict cross-origin browsers.

### Phase 3 — Snippet CRUD, Visibility, Collaborators, Tags, Versions, Restore & Diff
- **Built**:
  - `backend/src/modules/activity/event-bus.ts`: Typed internal `domainEventBus` emitting `snippet.created`, `snippet.edited`, `snippet.deleted`, and `collaborator.added` events.
  - `backend/src/modules/snippets/snippets.service.ts` & `backend/src/modules/snippets/snippets.routes.ts`:
    - `POST /api/snippets`: Creates snippet + initial `snippet_versions` (`v1`) + normalized `tags` + `snippet_tags` + weighted `tsvector` `search_vector`.
    - `GET /api/snippets`: Cursor-paginated snippet listing with `visibility`, `language`, `authorId`, `tag`, `scope` (`public | mine | collaborated | all`), and `sort` (`newest | oldest | updated`), excluding `unlisted` and `private` from public discovery.
    - `GET /api/snippets/:id`: Hydrates snippet, owner, tags, collaborators, and caller's `effectiveRole` (`admin | owner | editor | viewer | anonymous_viewer`).
    - `PATCH /api/snippets/:id`: Enforces `snippet:edit` for content/metadata edits (auto-incrementing `latestVersionNumber` and recording a `snippet_versions` row when content changes) and `snippet:manage_collaborators` (`owner` or `admin`) when changing `visibility`.
    - `DELETE /api/snippets/:id`: Enforces `snippet:delete` (`owner` or `admin`).
    - `GET /api/snippets/:id/versions` & `POST /api/snippets/:id/versions`: Cursor-paginated version history and explicit version snapshot creation.
    - `POST /api/snippets/:id/versions/:versionId/restore`: Restores snippet content to a historical version by creating a new version snapshot (`source: 'restore'`).
    - `GET /api/snippets/:id/diff?from=<versionId>&to=<versionId>`: Computes structured line-by-line diff (`added`, `removed`, `unchanged`, line numbers, and `stats`) using `diffLines`.
    - `GET /api/snippets/:id/collaborators`, `POST /api/snippets/:id/collaborators`, `DELETE /api/snippets/:id/collaborators/:userId`: Collaborator management with `editor` and `viewer` roles.
  - `backend/src/__tests__/phase3.test.ts`: 4 comprehensive integration test suites (15 total tests across Phases 1–3).
- **Verified**:
  - `npm test`: 3 test files passed, 15/15 tests passed.
  - `compile_applet` and `lint_applet`: 0 errors.
- **Unverified**: None for Phase 3.

### Phase 4 — Full-Text Search (`tsvector` + `GIN`), Ranked Results, Rich Filters & Cursor Pagination
- **Built**:
  - `backend/src/modules/search/search.service.ts` & `backend/src/modules/search/search.routes.ts` (mounted at `/api/search` in `backend/src/app.ts`):
    - `GET /api/search/snippets` (and alias `GET /api/search`):
      - Executes PostgreSQL full-text search using `snippets.search_vector @@ websearch_to_tsquery('english', q)` backed by the `snippets_search_vector_idx` `GIN` index (`'A'` weight on `title`, `'B'` weight on `tags_text`, `'C'` weight on `current_content`).
      - Computes weighted relevance score via `ts_rank_cd(snippets.search_vector, websearch_to_tsquery('english', q))` and highlighted code excerpt via `ts_headline(..., 'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2')`.
      - Supports filters: `language`, `tag`, `authorId`, `authorUsername`, `createdFrom` & `createdTo` (with ISO date validation and range ordering check), `visibility`, and `scope` (`public | mine | collaborated | all`).
      - Enforces strict visibility rules so `private` and `unlisted` snippets never leak to anonymous or unrelated authenticated users in search results.
      - Supports deterministic cursor pagination (`cursor`, `limit`) across all sort modes: `relevance` (encoding `rank|createdAt` + `id` tie-breaker), `newest`, `oldest`, and `updated`.
    - `GET /api/search/facets`: Returns aggregated language counts and tag counts across snippets accessible to the caller.
  - Replaced `ilike` in `backend/src/modules/users/users.service.ts` (`listUsersPaginated`) with PostgreSQL `to_tsvector('simple', ...) @@ websearch_to_tsquery('simple', ...)` so zero `LIKE` or `ILIKE` queries exist anywhere in `backend/src`.
  - `backend/src/__tests__/phase4.test.ts`: 4 integration tests verifying weighted ranking (`Title A > Tag B > Content C`), `<mark>` headline generation, visibility boundaries, filters (`language`, `tag`, `authorUsername`, `createdFrom`/`createdTo`), facets, and deterministic cursor pagination across pages with zero duplicates.
- **Verified**:
  - `npx vitest run backend/src/__tests__/phase4.test.ts`: 4/4 tests passed (19/19 total tests across Phases 1–4).
  - `grep -rnE 'ilike|\blike\b' backend/src --exclude-dir=__tests__`: 0 matches.
  - `compile_applet` and `lint_applet`: 0 errors.
- **Unverified**: None for Phase 4.

### Phase 5 — Real-Time Collaborative Editing (Socket.io + Yjs, Presence, Persistence & Viewer Write-Block)
- **Built**:
  - `backend/src/realtime/socket-limiter.ts`: Per-socket token-bucket rate limiter with dedicated high-frequency (`yjs:update`, `awareness:update`, `yjs:sync-step1`) and control event buckets, cleaned up on disconnect.
  - `backend/src/realtime/yjs-room-hub.ts`: In-memory `Y.Doc` room manager keyed by `snippetId`:
    - Hydrates `Y.Doc` (`yDoc.getText('monaco')`) from PostgreSQL `snippets.yjsState` (or `snippets.currentContent`).
    - Tracks room presence (`socketId`, `userId`, `username`, `displayName`, deterministic avatar color, `role`, live `cursor`, and `selection`).
    - Periodically flushes dirty `Y.Doc` state + plain text + weighted `search_vector` to PostgreSQL every 10s, schedules debounced `'autosave'` version snapshots, supports explicit `'manual'` version checkpoints (`snippet:save-version`), and flushes + evicts the room from memory when the last client leaves.
  - `backend/src/realtime/socket-server.ts` (attached to HTTP server in `server.ts` and `backend/src/index.ts`):
    - Verifies JWT access token on Socket.io handshake and checks token expiry (`socket.data.tokenExp`) before every event, allowing seamless mid-session token renewal via `auth:refresh`.
    - Validates all incoming socket payloads with Zod schemas.
    - Enforces central `evaluateAuthorization(actor, 'snippet:edit', { snippet })` on `yjs:update` and `snippet:save-version`, strictly blocking `viewer` and `anonymous_viewer` with `FORBIDDEN_READ_ONLY` without mutating or broadcasting the `Y.Doc`.
    - Supports reconnect state-vector delta resync (`yjs:sync-step1` -> `yjs:sync-step2`).
  - `backend/src/__tests__/phase5.test.ts`: 4 automated Socket.io + Yjs integration tests (23 total tests across Phases 1–5).
- **Verified**:
  - `npx vitest run backend/src/__tests__/phase5.test.ts`: 4/4 tests passed (live multi-client Yjs sync & cursor awareness, viewer write-rejection proof, reconnect state-vector resync + DB persistence, and mid-session token expiry + `auth:refresh` recovery).
  - `compile_applet` and `lint_applet`: 0 errors.
- **Unverified**: None for Phase 5.

### Phase 6 — Threaded Line Comments, Resolve Flow, Outdated Markers, MailService & Notifications
- **Built**:
  - `backend/src/modules/notifications/mail.service.ts`: Swappable `MailService` interface with `ConsoleMailService` (default mock implementation logging structured emails via Pino and recording dispatches in a ring buffer for inspection) and `SmtpMailService` (Nodemailer SMTP transport toggled via `MAIL_PROVIDER=smtp`).
  - `backend/src/modules/notifications/notifications.service.ts` & `backend/src/modules/notifications/notifications.routes.ts` (mounted at `/api/notifications`):
    - Persists in-app notifications (`comment.added`, `comment.reply`, `comment.resolved`, `collaborator.added`), pushes live `notification:new` events to `user:<recipientId>` over Socket.io, and dispatches emails via `mailService`.
    - `GET /api/notifications`: Cursor-paginated notification list + `unreadOnly` filter + `unreadCount`.
    - `POST /api/notifications/:id/read` & `POST /api/notifications/read-all`.
  - `backend/src/modules/comments/comments.service.ts` & `backend/src/modules/comments/comments.routes.ts` (mounted at `/api/snippets/:snippetId/comments`):
    - `GET /api/snippets/:snippetId/comments`: Returns hierarchical review threads (`replies: CommentDTO[]`) and dynamically computes `isOutdated: boolean` + `currentLineText` by comparing each comment's `anchorLineText` against the current line at `lineNumber`.
    - `POST /api/snippets/:snippetId/comments`: Creates top-level line-anchored comments or nested replies (`parentId`), captures `anchorLineText` from the target version, emits `comment.added` on `domainEventBus`, broadcasts `comment:created` over Socket.io, and triggers notifications + email.
    - `PATCH /api/snippets/:snippetId/comments/:commentId`: Edits comment body (`authorize(actor, 'comment:edit', ...)`).
    - `POST /api/snippets/:snippetId/comments/:commentId/resolve` & `unresolve`: Enforces `authorize(actor, 'comment:resolve', ...)`, records `resolvedById` and `resolvedAt`, emits `comment.resolved`, and broadcasts `comment:resolved` over Socket.io.
    - `DELETE /api/snippets/:snippetId/comments/:commentId`: Deletes comment (`authorize(actor, 'comment:delete', ...)`).
  - `backend/src/__tests__/phase6.test.ts`: 4 integration tests (27 total tests across Phases 1–6).
- **Verified**:
  - `npx vitest run backend/src/__tests__/phase6.test.ts`: 4/4 tests passed (threaded comments & replies, live socket broadcasts, `ConsoleMailService` email recording, resolve/edit authorization, dynamic `isOutdated=true` detection after line modification, and notification pagination + mark-read).
  - `compile_applet` and `lint_applet`: 0 errors.
- **Unverified**: Live external SMTP delivery via `SmtpMailService` (`MAIL_PROVIDER=smtp`) without external SMTP server credentials.

### Phase 7 — Activity Feed (Internal EventBus, Persistence & Socket Push)
- **Built**:
  - `backend/src/modules/activity/event-bus.ts`: Enhanced `DomainEventBus` with in-flight async listener tracking (`flush()`) so tests and graceful shutdowns can deterministically await asynchronous event persistence.
  - `backend/src/modules/activity/activity.service.ts`:
    - Subscribes to `domainEventBus` (`registerActivityEventSubscriber()`) for all 6 domain events (`snippet.created`, `snippet.edited`, `snippet.deleted`, `comment.added`, `comment.resolved`, `collaborator.added`).
    - Persists structured `activities` rows with `actorId`, `type`, `snippetId`, `metadata`, and `createdAt`.
    - Pushes real-time `activity:new` events over Socket.io to:
      - `feed:global` **only** when the snippet's visibility is `'public'` (never leaking `'private'` or `'unlisted'` events to global listeners).
      - `snippet:<snippetId>` for active snippet room collaborators.
      - `user:<actorId>` for the actor's personal feed.
    - Provides cursor-paginated feed queries (`created_at DESC, id DESC`):
      - `listGlobalActivitiesPaginated`: Strictly filters to events where either the live snippet is `'public'` or (for deleted snippets where `snippet_id` became `NULL`) `metadata->>'visibility' = 'public'`.
      - `listSnippetActivitiesPaginated`: Enforces central `authorize(actor, 'snippet:read', { snippet, collaboratorRole })` before returning snippet events.
      - `listUserActivitiesPaginated`: Returns all events when the caller is viewing their own feed or is an `admin`, and filters to accessible snippets (`public`, owned by caller, or collaborated on by caller) when viewing another user's feed.
  - `backend/src/modules/activity/activity.routes.ts` (mounted at `/api/activities` in `backend/src/app.ts`):
    - `GET /api/activities/global` (and `GET /api/activities` supporting `?scope=global|snippet|user`): Global public activity feed with cursor pagination.
    - `GET /api/activities/snippets/:snippetId`: Per-snippet activity feed with central auth and cursor pagination.
    - `GET /api/activities/users/:userId`: Per-user activity feed with privacy-aware filtering and cursor pagination.
  - `backend/src/realtime/socket-server.ts`: Connected clients automatically join `feed:global` to receive real-time public `activity:new` broadcasts.
  - `backend/src/__tests__/phase7.test.ts`: 3 comprehensive integration tests (30 total tests across Phases 1–7).
- **Verified**:
  - `npx vitest run backend/src/__tests__/phase7.test.ts`: 3/3 tests passed (live `activity:new` broadcasts for all 6 event types on public snippets, strict isolation of private/unlisted snippet events from `feed:global` and `/api/activities/global`, per-snippet/per-user privacy rules, and deterministic cursor pagination).
  - `compile_applet` and `lint_applet`: 0 errors.
- **Unverified**: None for Phase 7.

### Phase 8 — Full Frontend Implementation (React + Zustand + Monaco + Yjs + Diff + Admin)
- **Built**:
  - `frontend/src/types/domain.ts` & `frontend/src/utils/binary.ts`: Frontend domain DTOs and browser-safe `Uint8Array <-> Base64` helpers for Yjs updates.
  - `frontend/src/api/client.ts` & `frontend/src/api/socket.ts`:
    - Fetch client with single-flight `401` refresh token rotation (`refreshSessionTokens()`) and structured `ApiClientError` extraction.
    - Socket.io client manager connecting to `/socket.io`, handling `auth:expired` mid-session token renewal (`auth:refresh`) and automatic reconnect delta sync.
  - Zustand Stores (`frontend/src/store/authStore.ts`, `snippetStore.ts`, `realtimeStore.ts`):
    - Auth state, 1-click seeded account switcher (`admin_alex`, `elena_dev`, `marcus_code`, `victor_read`), GitHub OAuth popup handler with `event.origin === window.location.origin` check, profile edit, and password change.
    - Full-text search state (`q`, `language`, `tag`, `authorUsername`, `visibility`, `scope`, `createdFrom`, `createdTo`, `sort`), facets, version history, two-version diff computation, and collaborators.
    - Real-time room presence, remote cursor awareness, threaded comments with `isOutdated` detection, activity feeds (`global`, `snippet`, `user`), notifications drawer/toast, and viewer write-block verification helper.
  - Workspace UI Components (`frontend/src/components/` & `frontend/src/App.tsx`):
    - `TopNavbar.tsx`: Workspace/Activity/Admin view switcher, live Socket.io connection badge, 1-Click Demo Role Switcher, New Snippet button (enforcing global `viewer` restriction), Notification Bell with unread badge & dropdown, and Profile/Auth controls.
    - `SnippetExplorerSidebar.tsx`: PostgreSQL `tsvector` + `GIN` search bar, XSS-safe `<mark>` highlight rendering (`renderSafeHighlightedHeadline`), relevance rank score badge, filters, tag facets, and cursor pagination.
    - `CollaborativeMonacoWorkspace.tsx`: Monaco Editor + Yjs CRDT synchronization (`yjs:init`, `yjs:update`, `yjs:sync-step1` -> `yjs:sync-step2`), remote collaborator cursor & line decorations, gutter line selection for review comments, manual version checkpoints (`snippet:save-version`), and a "Test Server Socket Write-Block" button in read-only viewer mode.
    - `CommentReviewSidebar.tsx`: Threaded line comments with `All` / `Open` / `Outdated` / `Ln #N` filters, `OUTDATED` badge with original vs current line diff preview, nested replies, edit, delete, and resolve/reopen actions.
    - `VersionHistoryDiffModal.tsx`: Paginated version history, structured two-version line-by-line diff viewer (`+` additions, `-` deletions, line numbers), and one-click version restore.
    - `SnippetModals.tsx`, `AuthModals.tsx`, `ActivityFeedView.tsx`, `AdminUsersView.tsx`: Full modal and page workflows for creating/editing snippets, managing collaborators, login/register/GitHub OAuth popup, profile & password settings, activity feeds, and admin user role management.
  - Fixed a response-field mismatch in `realtimeStore.ts` (`fetchComments` now reads `res.threads` matching `GET /api/snippets/:snippetId/comments`), caught by `frontend/src/__tests__/phase8.test.ts`.
- **Verified**:
  - `npx vitest run frontend/src/__tests__/phase8.test.ts`: 3/3 tests passed (33/33 cumulative tests across Phases 1–8).
  - `compile_applet` and `lint_applet`: 0 errors.
- **Unverified**: Multi-window visual browser cursor rendering inside the headless container environment (verified via Socket.io + Yjs state/awareness tests and TypeScript/Vite compilation).

### Phase 9 — OpenAPI (`/api/docs`), `docs/REALTIME.md`, `README.md`, Docker, CI & Final Audit
- **Built**:
  - `backend/src/docs/openapi.ts` (mounted at `/api` in `backend/src/app.ts`): Serves OpenAPI 3.0.3 JSON spec at `GET /api/docs.json` and interactive Swagger UI at `GET /api/docs`.
  - `docs/REALTIME.md`: Exhaustive Socket.io & Yjs protocol documentation (handshake auth, mid-session `auth:refresh`, per-socket token-bucket rate limiter, every event's direction/Zod payload/ack/central authorization rule, and Yjs persistence lifecycle).
  - `README.md`: Overview, stack with rationale, Mermaid architecture diagram, Docker Compose and non-Docker setup, test commands, environment variable table, seeded credentials, security checklist, and honest known limitations.
  - `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` (with plain PostgreSQL 16 + backend + frontend), and `.github/workflows/ci.yml`.
  - `backend/src/__tests__/phase9.test.ts`: 3 tests verifying `/api/docs.json`, `/api/docs`, and all required documentation/infra artifacts (36/36 cumulative tests across Phases 1–9).
- **Verified**:
  - `npx vitest run backend/src/__tests__/phase9.test.ts`: 3/3 tests passed.
  - `restart_dev_server`, `compile_applet`, and `lint_applet`: 0 errors.
- **Unverified**: Executing `docker-compose up` or GitHub Actions CI runner inside this container (no Docker daemon in sandbox).


