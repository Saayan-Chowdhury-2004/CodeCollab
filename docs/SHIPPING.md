# Production Architecture & Reality Gap (SHIPPING.md)

This document outlines the core technical assumptions made in the CodeCollab monorepo for evaluation and local environments, contrasted with the architectural requirements needed when hosting and operating the platform at scale.

---

## 1. In-Memory State vs. Multi-Instance Horizontal Scaling

| Current Monorepo Assumption | Real-World Production Reality |
| :--- | :--- |
| **In-Process Socket.io & Yjs Rooms**: Socket rooms, presence awareness, and in-memory Y.Docs exist within a single Node.js runtime process. | **Multiple Container Replicas (Kubernetes / ECS / Cloud Run)**: Two collaborators editing the same snippet can land on different backend instances without shared memory. |
| **Local Rate Limiting**: `express-rate-limit` uses an in-memory `MemoryStore`. | **Fragmented Limits**: Behind $N$ instances, rate limits are effectively multiplied by $N$. Attackers round-robin past thresholds. |
| **Single-Node Event Bus**: Activity events emit via local Node `EventEmitter`. | **Disconnected Event Broadcasts**: A comment posted on Server A won't notify a socket connection listening on Server B. |

### Production Path:
- **Socket.io Redis / Valkey Adapter** (`@socket.io/redis-adapter`) for cross-node pub/sub message broadcast.
- **Centralized Rate Limiting** backed by Valkey/Redis (`rate-limit-redis`).
- **Distributed CRDT Architecture**: A stateful sync tier (e.g., Y-Sweet, Hocuspocus, or dedicated worker routing where all WebSocket connections for `snippet_id` pin to the same stateful agent/worker).

---

## 2. Document Lifecycle & Persistence Strategy

| Current Monorepo Assumption | Real-World Production Reality |
| :--- | :--- |
| **Relational Text Storage**: Full snippet text and every version snapshot are stored directly in PostgreSQL columns (`text`). | **Database Bloat & WAL Churn**: Frequent auto-checkpoints and large codebases bloat relational storage, table indexes, and backup sizes. |
| **Unbounded CRDT History**: In-memory Yjs transaction logs accumulate while the document stays open in an active session. | **Client Memory Pressure**: Uncompacted Yjs updates cause client memory leaks and slow initial load times for long-lived documents. |

### Production Path:
- **Blob / Object Storage Offloading**: Store active metadata in Postgres, but offload version diffs and historic snapshots to S3 / Cloudflare R2 / GCS.
- **Document Compaction & Snapshots**: Periodically compact Yjs update logs into a clean snapshot vector on idle, garbage-collecting deleted CRDT nodes.
- **Payload Limits**: Strict maximum snippet size guardrails (e.g., 500 KB / 10,000 lines) to prevent client-side Monaco crash loops.

---

## 3. Search & Database Workloads

| Current Monorepo Assumption | Real-World Production Reality |
| :--- | :--- |
| **Single PostgreSQL Engine**: Handles transactions, relational joins, authorization checks, and full-text search (`tsvector` + GIN) on the same instance. | **FTS CPU Spikes & Lock Contention**: Intensive searches with wildcard stems and facets compete for CPU and IOPS against real-time document saves. |
| **Direct Connections**: Backend connects directly to Postgres with a small Node connection pool (`max: 10`). | **Connection Exhaustion**: Hundreds of concurrent serverless or container tasks rapidly saturate Postgres connection limits. |

### Production Path:
- **Connection Pooling**: PgBouncer or Supabase Supavisor placed in front of PostgreSQL.
- **Dedicated Search Engine**: Offloading global snippet search to Algolia, Meilisearch, or Elasticsearch once snippet counts surpass $10^5$.

---

## 4. Authentication, OAuth & Security Boundaries

| Current Monorepo Assumption | Real-World Production Reality |
| :--- | :--- |
| **Fixed Origin PostMessage**: GitHub OAuth popup communicates back via `targetOrigin` based on static `APP_URL`. | **Dynamic Staging & Preview Environments**: Pull Request preview URLs (e.g., `pr-123.vercel.app`) break if OAuth requires exact callback matching. |
| **Single Active Secrets**: One `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in environment variables. | **Zero-Downtime Secret Rotation**: Production demands asymmetric signing (RS256 / EdDSA) with JWKS endpoints, or rolling secret lists with grace periods. |

### Production Path:
- **Asymmetric Token Verification**: Public/private key pairs so downstream services can verify access tokens without holding the signing secret.
- **Strict CORS & CSP Management**: Automated domain allow-listing for web, preview deployments, and desktop/mobile client shells.

---

## 5. Asynchronous Workers & Email Delivery

| Current Monorepo Assumption | Real-World Production Reality |
| :--- | :--- |
| **In-Band Notification Processing**: When a comment is added, mentions and notifications are processed within the HTTP request lifecycle. | **API Latency & Unreliable Delivery**: Network latency to external SMTP or third-party email providers delays the user's HTTP response. |
| **Console Mailer**: Emails print to stdout (`console.log`) by default. | **Deliverability Infrastructure**: Spam compliance (SPF, DKIM, DMARC), bounce tracking, and unsubscription management. |

### Production Path:
- **Job Queues (BullMQ / Celery / Cloud Tasks)**: Enqueue comment notifications and email dispatches to a background worker.
- **Transactional Email Provider**: Integration with Resend, Postmark, or AWS SES with webhook listening for delivery bounces and spam reports.

