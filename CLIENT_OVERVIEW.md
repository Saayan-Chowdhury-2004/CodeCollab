# CodeCollab — Client Project Overview

**Version:** 1.0.0  
**Document type:** Product & technical overview (client-facing)  
**Prepared:** November 2026

---

## 1. What Is CodeCollab?

CodeCollab is a production-grade web platform for collaborative code snippet sharing and review. Think of it as a hybrid between **GitHub Gists** (versioned code snippets), **Google Docs** (live multi-user editing), and **GitHub Pull Request reviews** (line-anchored threaded comments), all backed by a searchable database.

A developer can:
- Create a snippet (public, unlisted, or private)
- Edit code live alongside teammates with real-time cursor presence
- Save version snapshots and diff between versions
- Leave line-anchored review comments that flag when code has changed since the comment was written
- Invite collaborators with granular per-snippet roles (editor / viewer)
- Search across all snippets using full-text search with ranked, highlighted results
- Get notified of activity on snippets they follow

---

## 2. Value Proposition

| Capability | Business Benefit |
|---|---|
| **Live co-editing (CRDT/Yjs)** | Multiple developers edit the same snippet simultaneously without overwriting each other. Changes merge automatically. |
| **Versioned snippets** | Every edit creates a new version. Teams can view history, diff changes, and restore previous states — critical for code review and audit trails. |
| **Threaded line comments** | Review feedback is anchored to specific lines. The system flags comments that are outdated because the referenced line has since changed. |
| **Granular access control** | Public / unlisted / private visibility plus per-snippet collaborator roles (editor/viewer) and global roles (admin/editor/viewer). |
| **Full-text search** | PostgreSQL-powered search with ranking and highlighted excerpts makes large snippet libraries discoverable. |
| **Real-time notifications** | Activity feeds and in-app notifications keep teams aware of edits, comments, and resolves. |
| **Production security** | Hardened against rate-limit bypass, OAuth replay, XSS, CSRF, and credential stuffing. Secrets are never baked into builds. |

---

## 3. High-Level Architecture

CodeCollab is a **TypeScript monorepo** with two independent services plus shared configuration:

```
frontend/   React 19 + Vite + Tailwind + Monaco Editor + Yjs (the SPA)
backend/    Node.js + Express + Socket.io + Drizzle ORM + PostgreSQL (the API)
```

**How data flows:**
1. The **frontend SPA** loads in the browser and authenticates the user (email/password or GitHub OAuth popup).
2. REST calls (`/api/*`) handle reads/writes: snippets, versions, collaborators, comments, search, users, activity, notifications.
3. WebSocket (`/socket.io`) powers live co-editing: Yjs CRDT updates, cursor presence, and real-time room events are pushed between connected clients.
4. **PostgreSQL 16** is the system of record, using Drizzle ORM. Snippets are indexed with PostgreSQL `tsvector` + `GIN` for full-text search.
5. In-memory **Yjs rooms** keep live editing fast; the server periodically flushes document state to the database.

**Deployment:** Two Dockerfiles + `docker-compose.yml` (prod) and `docker-compose.dev.yml` (dev). The frontend is served by Nginx; the backend runs as a non-root Node container.

---

## 4. Core Features

### 4.1 Snippets & Versioning
- Create snippets with title, description, language, and visibility (`public` / `unlisted` / `private`).
- Every save creates an immutable version snapshot with author, timestamp, and optional summary.
- Structured line-by-line diff between any two versions.
- Restore a historical version (creates a new snapshot recording the restore).
- Tags for categorization and filtering.

### 4.2 Real-Time Collaboration
- Live multi-user editing powered by Yjs CRDTs, rendered in Monaco Editor (VS Code's editor core).
- Remote cursors and selection awareness so you see where teammates are working.
- Rooms are scoped per snippet; access is re-verified whenever visibility or collaborators change (revoked users are kicked immediately).

### 4.3 Review & Comments
- Line-anchored threaded comments and replies.
- Comments compute an "outdated" flag when the referenced line's text has changed.
- Resolve / unresolve threads with audit metadata (who resolved and when).
- Real-time notifications for new comments and resolutions.

### 4.4 Search
- Weighted full-text search across title, tags, and content (title weighted highest).
- Filters by language, tag, author, visibility, and date range.
- Cursor pagination for large result sets; returns lightweight summaries (no full source code in lists).

### 4.5 Users, Roles & Administration
- Global roles: `admin`, `editor`, `viewer`.
- Per-snippet roles: `owner`, `editor`, `viewer`, `anonymous_viewer`.
- Admins can manage user roles globally; snippet owners manage collaborators.
- OAuth-only users (GitHub) can optionally set a local password after recent re-authentication.

### 4.6 Authentication
- **Bearer mode** (default): JWT access token in memory; refresh token in `sessionStorage`.
- **Cookie mode** (optional): `httpOnly`, `SameSite` cookies with origin-bound CSRF protection — suitable for production deployments behind a domain.
- GitHub OAuth popup flow with signed, single-use state tokens.
- Short-lived access tokens (15 min) with refresh-token family rotation and reuse detection (replaying a used token kills the whole session family).

---

## 5. Tech Stack

| Layer | Technology |
|---|---|
| Frontend UI | React 19, TypeScript, Tailwind CSS v4, Vite, Zustand |
| Code editor | Monaco Editor + Yjs + y-monaco (CRDT co-editing) |
| Real-time | Socket.io client |
| Backend | Node.js, Express, TypeScript (`tsx`), Socket.io server |
| Validation | Zod (every REST and WebSocket payload) |
| Database | PostgreSQL 16, Drizzle ORM, `pg` driver |
| Full-text search | PostgreSQL `tsvector` + `GIN` index |
| Auth | JSON Web Tokens (HS256), bcrypt, cookie-parser |
| Logging | Pino (structured JSON, request-ID correlated) |
| Docs | Self-hosted Swagger UI / OpenAPI 3.0 |
| Container | Docker multi-stage (Node + Nginx), docker-compose |

---

## 6. Security Posture

CodeCollab was built with **defense in depth**. Key controls include:

- **Rate limiting:** Dual limiters on auth endpoints — compound key (IP + hashed identifier) to prevent targeted lockout, plus per-IP limits. Spoofed `X-Forwarded-For` headers are ignored unless the operator explicitly configures trusted proxy hops.
- **OAuth protection:** HMAC-signed, single-use state tokens with browser cookie binding; replayed states are rejected.
- **CSP:** Strict Content Security Policy (`script-src 'self'`, no `unsafe-inline`/`unsafe-eval` in scripts). Swagger UI is self-hosted — no third-party CDN scripts.
- **Cookie transport:** `httpOnly`, `SameSite` cookies with CSRF validation on state-changing requests; production requires `Secure` attribute.
- **Secret rotation:** Supports previous JWT/refresh secrets for zero-downtime key rotation.
- **No hardcoded credentials:** Demo accounts exist only in development builds and are stripped from production bundles via a build-time assertion script.
- **Authorization:** A single central module (`authorize.ts`) governs every REST route and WebSocket event — no ad-hoc role checks scattered through the codebase.

---

## 7. Deployment Options

### Option A — Docker Compose (Recommended)
One command stands up the full stack:
```bash
docker compose up --build
```
Requires `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (32+ characters each) for production.

- **Backend:** port `4000` (not published publicly; accessed via Nginx proxy).
- **Frontend (Nginx):** port `8080` with SPA routing, security headers, and API/WebSocket proxying.
- **Database:** PostgreSQL 16 with persistent volume.

### Option B — Local Development
```bash
npm install          # install workspace dependencies
npm run migrate      # apply database schema
npm run seed         # load sample users & snippets (dev/test only)
npm run dev:backend  # API on port 3000 (or 4000)
npm run dev:frontend # Vite dev server on port 5173 (proxies /api to backend)
```

The frontend Vite dev server automatically proxies `/api` and `/socket.io` to the backend, so no cross-port CORS configuration is needed during development.

---

## 8. Database Schema (11 Core Tables)

| Table | Purpose |
|---|---|
| `users` | Platform accounts (email, username, global role, OAuth links) |
| `refresh_tokens` | Hashed refresh tokens with family rotation & reuse detection |
| `oauth_states` | Single-use, time-bound OAuth CSRF state rows |
| `snippets` | Snippet metadata + full-text search vector |
| `snippet_versions` | Immutable version snapshots with content |
| `snippet_collaborators` | Per-snippet editor/viewer assignments |
| `tags` / `snippet_tags` | Tag normalization and many-to-many snippet tagging |
| `comments` | Line-anchored threaded comments with outdated detection |
| `activities` | Persisted activity feed events |
| `notifications` | In-app notifications per user |

---

## 9. API Surface (REST + WebSocket)

**REST (`/api/*`):**
- System: health, OpenAPI/Swagger docs
- Auth: register, login, refresh, logout, me, GitHub OAuth URL & callback
- Users: profile, password change, role management (admin)
- Snippets: CRUD, visibility, tags, collaborators, versions, restore, diff
- Search: ranked full-text with filters and cursor pagination
- Comments: threaded, resolve/unresolve, outdated detection
- Activity & Notifications: feeds, read/unread state

**WebSocket (`/socket.io`):**
- `snippet:join` / `snippet:leave` — room membership with authorization
- `yjs:update` — live CRDT edits (write permission enforced server-side)
- `awareness:update` — cursor/selection presence
- `auth:refresh` — token rotation without dropping rooms
- `snippet:save-version` — checkpoint over WebSocket
- Server pushes: `yjs:init`, `presence:state`, `snippet:updated`, `snippet:invalidate`, `version:created`, `snippet:access-revoked`

---

## 10. Operational Notes for Stakeholders

- **Secrets:** Never commit `.env` files. Production requires strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (32+ characters) and, for cookie transport, `COOKIE_SECURE=true`.
- **Database migrations:** Committed SQL migrations under `backend/drizzle/`. Apply with `npm run migrate` (Drizzle Kit). Migrations are additive and safe to re-run.
- **Testing:** Backend (48 tests) and frontend (3 tests) suites run via Vitest. Backend tests require a local PostgreSQL instance.
- **Build:** `npm run build` produces the production frontend bundle and runs a credential-scan to guarantee no demo secrets leak into the bundle.
- **Support:** Security vulnerabilities should be reported privately per `SECURITY.md` (GitHub Private Vulnerability Reporting or maintainer contact), not via public issues.

---

## 11. Summary for Decision-Makers

CodeCollab is a complete, security-hardened collaborative code-review platform suitable for internal engineering teams, code-review workflows, or snippet-sharing SaaS use cases. Its strengths are real-time co-editing with CRDT conflict resolution, fine-grained access control, full-text search, and a production-ready Docker deployment with comprehensive test coverage.

The codebase is organized as a clean TypeScript monorepo, making it straightforward for a development team to extend, deploy, and maintain.

---