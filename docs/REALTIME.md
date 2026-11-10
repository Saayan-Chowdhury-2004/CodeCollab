# Real-Time Protocol & Yjs Collaboration Specification (`docs/REALTIME.md`)

## 1. Architecture Overview

CodeCollab implements real-time collaborative editing, live cursor/selection awareness, instant review comment synchronization, and activity/notification streaming over **Socket.io v4** and **Yjs CRDT** (`yjs`).

- **Endpoint & Path**: Default namespace `/` mounted at `/socket.io` on the HTTP server (`backend/src/realtime/socket-server.ts`).
- **CRDT Engine (`backend/src/realtime/yjs-room-hub.ts`)**:
  - Each active snippet room (`snippet:<snippetId>`) holds a single authoritative in-memory `Y.Doc` on the server with shared text type `yDoc.getText('monaco')`.
  - Operational Transforms (OT) are **not** hand-rolled; all concurrent character insertions and deletions are merged deterministically using Yjs state vectors and binary updates (`Uint8Array` encoded as `base64` over JSON frames).
- **Single-Instance Deployment Constraint**:
  - Because active `Y.Doc` rooms live in server memory, production deployments without a distributed pub/sub adapter must run as a **single instance** (`replicas: 1` / `max-instances=1`).

---

## 2. Handshake Authentication, Mid-Session Expiry & Per-Socket Rate Limiting

### 2.1 Handshake Authentication
1. On connection, the client supplies its short-lived (15-minute) JWT access token via `socket.handshake.auth.token` (or `Authorization: Bearer <token>`).
2. If no token is provided, the connection is accepted as an unauthenticated observer (`socket.data.user = null`, `effectiveRole = 'anonymous_viewer'`).
3. If a token is provided, `verifyAccessToken(token)` verifies the signature and expiration, loads the user record from PostgreSQL, and populates:
   - `socket.data.user`: `{ id, email, username, displayName, globalRole }`
   - `socket.data.tokenExp`: Unix timestamp (seconds) from JWT `exp`
4. Every connected socket automatically joins `feed:global`. Authenticated sockets also join `user:<userId>` to receive private `notification:new` and `activity:new` pushes.

### 2.2 Mid-Session Access Token Expiry Re-Check
Before **any** client-to-server event (except `auth:refresh`) is processed, `withSocketGuard` checks:
```ts
if (socket.data.user && socket.data.tokenExp && Math.floor(Date.now() / 1000) >= socket.data.tokenExp)
```
If the access token has expired mid-session:
1. The server emits `auth:expired` (`{ code: 'TOKEN_EXPIRED', message: '...' }`) and rejects the event without disconnecting the socket or dropping room membership.
2. The client's `socket.ts` listener automatically rotates its refresh token via `POST /api/auth/refresh` and emits `auth:refresh` (`{ token: newAccessToken }`) to update `socket.data.tokenExp` seamlessly.

### 2.3 Per-Socket Token-Bucket Rate Limiter (`backend/src/realtime/socket-limiter.ts`)
Every incoming socket event passes through `socketRateLimiter.consume(socket.id, eventName)`:
- **High-Frequency Sync & Cursor Bucket (`yjs:update`, `awareness:update`, `yjs:sync-step1`)**: Capacity `120` tokens, refill rate `60` tokens/sec.
- **Control Event Bucket (`snippet:join`, `snippet:leave`, `snippet:save-version`, `auth:refresh`)**: Capacity `30` tokens, refill rate `10` tokens/sec.
- When exhausted, the server responds with `{ ok: false, error: { code: 'RATE_LIMITED', message: '...' } }` and emits `socket:error`.

---

## 3. Complete Socket.io Event Reference

Every incoming event is validated with a strict **Zod** schema and authorized through the **single central authorization module** (`backend/src/auth/authorize.ts`).

### 3.1 Summary Table

| Event Name | Direction | Zod Payload Schema | Central Authorization Rule (`authorize.ts`) |
| :--- | :---: | :--- | :--- |
| `auth:refresh` | Client $\to$ Server | `{ token: string.min(1) }` | Valid signed JWT access token (`verifyAccessToken`) |
| `snippet:join` | Client $\to$ Server | `{ snippetId: string.uuid() }` | `evaluateAuthorization(actor, 'snippet:read', { snippet })` |
| `snippet:leave` | Client $\to$ Server | `{ snippetId: string.uuid() }` | Authenticated or anonymous room member |
| `yjs:init` | Server $\to$ Client | `{ snippetId, state, content, versionId, latestVersionNumber, role, members }` | Emitted only after `snippet:read` passes on `snippet:join` |
| `yjs:update` | Client $\to$ Server | `{ snippetId: string.uuid(), update: string.min(1) }` | **`evaluateAuthorization(actor, 'snippet:edit', { snippet })`** (Viewers blocked with `FORBIDDEN_READ_ONLY`) |
| `yjs:update` | Server $\to$ Client | `{ snippetId, update, actorId, username }` | Broadcast to authorized room members in `snippet:<snippetId>` |
| `yjs:sync-step1` | Client $\to$ Server | `{ snippetId: string.uuid(), stateVector: string.min(1) }` | `evaluateAuthorization(actor, 'snippet:read', { snippet })` |
| `yjs:sync-step2` | Server $\to$ Client | `{ snippetId, update, content, versionId, latestVersionNumber }` | Emitted in response to valid `yjs:sync-step1` |
| `awareness:update` | Client $\to$ Server | `{ snippetId: string.uuid(), cursor: { lineNumber, column } \| null, selection? }` | `evaluateAuthorization(actor, 'snippet:read', { snippet })` |
| `awareness:update` | Server $\to$ Client | `{ snippetId, member: PresenceMemberDTO }` | Broadcast to `snippet:<snippetId>` |
| `presence:state` | Server $\to$ Client | `{ snippetId, members: PresenceMemberDTO[] }` | Broadcast to `snippet:<snippetId>` on join/leave/disconnect |
| `snippet:save-version` | Client $\to$ Server | `{ snippetId: string.uuid(), summary?: string.max(200) }` | **`evaluateAuthorization(actor, 'snippet:version:create', { snippet })`** |
| `version:created` | Server $\to$ Client | `{ snippetId, version: SnippetVersionDTO }` | Broadcast to `snippet:<snippetId>` |
| `comment:created` | Server $\to$ Client | `{ snippetId, comment: CommentDTO }` | Broadcast to `snippet:<snippetId>` after `comment:create` |
| `comment:updated` | Server $\to$ Client | `{ snippetId, comment: CommentDTO }` | Broadcast to `snippet:<snippetId>` after `comment:edit` |
| `comment:resolved` | Server $\to$ Client | `{ snippetId, comment: CommentDTO }` | Broadcast to `snippet:<snippetId>` after `comment:resolve` |
| `comment:deleted` | Server $\to$ Client | `{ snippetId, commentId: string }` | Broadcast to `snippet:<snippetId>` after `comment:delete` |
| `activity:new` | Server $\to$ Client | `ActivityDTO` | Sent to `feed:global` (**public snippets only**), `snippet:<id>`, and `user:<actorId>` |
| `notification:new` | Server $\to$ Client | `NotificationDTO` | Sent privately to `user:<recipientId>` |
| `auth:expired` | Server $\to$ Client | `{ code: 'TOKEN_EXPIRED', message: string }` | Emitted when `Date.now()/1000 >= socket.data.tokenExp` |
| `socket:error` | Server $\to$ Client | `{ code: string, message: string, details?: unknown }` | Emitted on validation, rate-limit, or authorization failure |

---

## 4. Detailed Event Payloads & Flows

### 4.1 `snippet:join` (Client $\to$ Server) & `yjs:init` (Server $\to$ Client)
- **Direction**: Client $\to$ Server (with Ack) + Server $\to$ Client (`yjs:init` and `presence:state`)
- **Authorization**: `evaluateAuthorization(actor, 'snippet:read', { snippet })`.
  - Allows anyone on `public`/`unlisted` snippets (`viewer` or `anonymous_viewer`) and only owner/collaborators/admin on `private` snippets.
- **Request Payload**:
  ```json
  {
    "snippetId": "22222222-2222-4222-8222-222222222201"
  }
  ```
- **Server Response (`yjs:init` & Ack)**:
  ```json
  {
    "ok": true,
    "snippetId": "22222222-2222-4222-8222-222222222201",
    "state": "base64EncodedYjsFullStateUpdate==",
    "content": "export function verifyToken() { ... }",
    "versionId": "33333333-3333-4333-8333-333333333302",
    "latestVersionNumber": 2,
    "role": "editor",
    "members": [
      {
        "socketId": "xYz123",
        "userId": "11111111-1111-4111-8111-111111111102",
        "username": "elena_dev",
        "displayName": "Elena Vance",
        "color": "#6366f1",
        "role": "owner",
        "cursor": { "lineNumber": 4, "column": 12 },
        "selection": null,
        "joinedAt": "2026-11-07T20:00:00.000Z"
      }
    ]
  }
  ```

### 4.2 `yjs:update` (Client $\leftrightarrow$ Server) — Server-Side Viewer Write-Block
- **Direction**: Bidirectional
- **Authorization**: `evaluateAuthorization(actor, 'snippet:edit', { snippet })`.
  - **Permitted**: `admin`, `owner` (with `globalRole !== 'viewer'`), and `collaborator:editor` (with `globalRole !== 'viewer'`).
  - **Blocked**: `viewer` and `anonymous_viewer`. When a viewer emits `yjs:update`, the server **does not** apply the update to `room.yDoc`, **does not** broadcast to the room, and immediately returns:
    ```json
    {
      "ok": false,
      "error": {
        "code": "FORBIDDEN_READ_ONLY",
        "message": "Read-only viewers cannot edit snippet code over WebSocket"
      }
    }
    ```
- **Authorized Broadcast Payload (Server $\to$ Other Room Members)**:
  ```json
  {
    "snippetId": "22222222-2222-4222-8222-222222222201",
    "update": "base64EncodedIncrementalYjsUpdate==",
    "actorId": "11111111-1111-4111-8111-111111111102",
    "username": "elena_dev"
  }
  ```

### 4.3 `yjs:sync-step1` & `yjs:sync-step2` (Reconnect State-Vector Resync)
When a client reconnects after a transient network drop:
1. Client computes `const sv = Y.encodeStateVector(localYDoc)` and emits `yjs:sync-step1`:
   ```json
   {
     "snippetId": "22222222-2222-4222-8222-222222222201",
     "stateVector": "base64EncodedStateVector=="
   }
   ```
2. Server checks `snippet:read`, computes the exact missing delta via `Y.encodeStateAsUpdate(room.yDoc, stateVectorBytes)`, and replies with `yjs:sync-step2`:
   ```json
   {
     "snippetId": "22222222-2222-4222-8222-222222222201",
     "update": "base64EncodedMissingDeltaUpdate==",
     "content": "full current text",
     "versionId": "33333333-3333-4333-8333-333333333302",
     "latestVersionNumber": 2
   }
   ```

---

## 5. Persistence & Snapshot Lifecycle (`yjs-room-hub.ts`)

1. **Periodic Background Flush (Every 10 Seconds)**:
   - Any room with `dirty === true` flushes its `Y.encodeStateAsUpdate(room.yDoc)` (`yjs_state`), plain text (`current_content`), and weighted PostgreSQL `search_vector` (`tsvector`) to the `snippets` table.
2. **Debounced Autosave Version Snapshot (15 Seconds after last edit)**:
   - Creates a new `snippet_versions` row (`source = 'autosave'`) with `author_id = lastEditorId` and increments `snippets.latest_version_number`.
3. **Explicit Manual Checkpoint (`snippet:save-version`)**:
   - Immediately flushes the `Y.Doc`, inserts a `snippet_versions` row (`source = 'manual'`), emits `snippet.edited` on `domainEventBus`, and broadcasts `version:created` to all room members.
4. **Empty-Room Flush & Eviction**:
   - When the last connected client leaves `snippet:<snippetId>` (via `snippet:leave` or `disconnect`), `removeClientAndFlushIfEmpty` immediately persists any dirty state (and creates an autosave version snapshot if content changed since the last version) before evicting the `Y.Doc` from memory.

---

## 6. Access Revocation, Token Expiry Sweep & Payload Caps

### 6.1 Real-Time Access Revocation (`revokeSnippetAccess`)
When a snippet's visibility is changed to `private` or a collaborator is removed or downgraded via REST, the server triggers `yjsRoomHub.revokeSnippetAccess(snippetId)`:
- Loads current snippet visibility, owner, and active collaborator list.
- Re-evaluates permissions for every connected socket in `snippet:<snippetId>`.
- Any socket that no longer has `snippet:read` authorization is removed from the room, has its Socket.io membership kicked, and receives a `snippet:access-revoked` event with `{ snippetId, reason: 'Snippet visibility or collaborator status changed' }`.
- If a user's role is downgraded (e.g., from `editor` to `viewer`), their cached role in the room is updated, and `snippet:role-changed` is emitted to notify the client.
- `snippet:invalidate` is emitted to prompt client stores to refetch metadata without leaking snippet code in the broadcast event.

### 6.2 Token Expiry Sweep
A server background sweep runs every 60 seconds inspecting active socket connections:
- Identifies authenticated sockets whose `tokenExp` has passed and whose client has failed to provide a valid token via `auth:refresh`.
- Forcibly disconnects stale sockets to prevent zombie connections from receiving real-time broadcasts.

### 6.3 Strict Payload Bounds
To protect the server and client workers against memory exhaustion and denial-of-service:
- `yjs:update` payloads are strictly validated via Zod and capped at 256 KB (`262_144` characters).
- `yjs:sync-step1` state vectors are capped at 64 KB (`65_536` characters).
- Socket.io transport enforces `maxHttpBufferSize: 300_000` bytes.
