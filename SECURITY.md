# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability within CodeCollab, please do not open a public issue. Instead, report it privately via GitHub Private Vulnerability Reporting or contact the project repository maintainers.

Please include:
- A description of the vulnerability.
- Steps to reproduce or a minimal proof of concept (PoC).
- Potential impact and affected components.

Maintainers will acknowledge receipt within 48 hours and coordinate disclosure.

---

## Threat Model & Core Security Guarantees

CodeCollab is designed with defense-in-depth principles across all architectural tiers:

### 1. Central Authorization Barrier
- All REST endpoints and WebSocket events delegate access decisions to the centralized authorization engine in `backend/src/auth/authorize.ts` (`resolveEffectiveSnippetRole` and `evaluateAuthorization`).
- Role hierarchy strictly distinguishes `admin`, `owner`, `editor`, `viewer`, and `anonymous_viewer`.
- Read-only viewers cannot create snippets, edit code, save versions, or push updates over WebSockets (`FORBIDDEN_READ_ONLY`).
- Live socket rooms dynamically revoke access (`revokeSnippetAccess`) whenever snippet visibility changes to `private` or a collaborator is removed.

### 2. Authentication & Session Security
- Short-lived JWT access tokens (15-minute default) paired with cryptographically random refresh tokens stored as SHA-256 hashes.
- Refresh token families enforce automatic reuse detection: replaying a revoked or previously used token immediately invalidates the entire session family.
- Dual transport modes:
  - **Bearer mode**: In-memory access token + isolated client-side storage.
  - **Cookie mode**: `httpOnly`, `SameSite=Lax`, `Secure` cookies with origin-bound CSRF protection verifying `Origin` and `Referer` headers on state-changing operations.
- Key rotation: Supports zero-downtime secret rotation via `JWT_ACCESS_SECRET_PREVIOUS` and `JWT_REFRESH_SECRET_PREVIOUS`.

### 3. OAuth & CSRF Protection
- Single-use HMAC-signed OAuth state tokens stored in `oauth_states` with 10-minute expiration.
- Browser-side double-submit cookie verification preventing OAuth state replay and cross-origin authorization code injection.
- Strict postMessage validation in popup authentication verifying both sender origin (`event.origin`) and message source window (`event.source`).

### 4. Content Security Policy (CSP) & Transport Security
- Strict default CSP: `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `connect-src 'self' ws: wss:`.
- No `'unsafe-inline'` or `'unsafe-eval'` in script directives.
- Frontend Nginx production container enforces CSP and Permissions-Policy: `script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src blob:; connect-src 'self' ws: wss:; img-src 'self' data: https:; frame-ancestors 'none'`.
- Self-hosted Swagger UI assets eliminating untrusted third-party CDN scripts.
- Cross-Origin-Opener-Policy set to `same-origin-allow-popups` to support secure OAuth flows while isolating application browsing context.

### 5. Rate Limiting & Denial of Service Defenses
- Reverse-proxy hop validation (`TRUST_PROXY_HOPS`) preventing spoofed `X-Forwarded-For` rate-limit bypasses.
- Dual rate limiting on authentication routes: compound rate-limiting keys on authentication endpoints (`sha256(identifier) + ip`) paired with separate per-IP limiters (`authIpRateLimiter`) on login, registration, and OAuth endpoints.
- Socket payload bounding (256 KB max for Yjs updates, 64 KB max for state vectors, 300 KB HTTP buffer).
- Monolithic and list endpoints bounded with pagination limits (max 100) and lightweight summary DTOs omitting full source payloads.
