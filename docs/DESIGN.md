# Venue Booker: system design

This document walks the system-design checklist and says, for each item, **what the app does, where it lives, and what it deliberately does not do (and when that would change).** Items that don't fit a system this size are marked *Not applicable yet*, with the trigger that would make them worth building.

## 1. Requirements & scope

**Functional**
- Users sign up, sign in (JWT + rotating refresh tokens), reset passwords by emailed one-time code.
- Venue owners list, update and delete venues. Everyone can browse and search them.
- Users book a venue for a time slot; the slot is held while they pay; payment (Stripe Checkout) confirms it; cancelling a paid booking refunds it.
- Admins can list users. Every sensitive action is audit-logged.

**Non-functional targets** (assumed; adjust to reality)

| Concern | Target |
|---|---|
| Availability | 99.9% (~43 min/month). No single point of failure in the app tier |
| Latency | p95 < 200 ms for reads, < 500 ms for booking creation (excluding Stripe) |
| Correctness | **Zero double-bookings. Zero double-charges.** (the two things users can't forgive) |
| Durability | No lost bookings or payments; RPO ≤ 5 min with WAL archiving, RTO ≤ 1 h |
| Security | OWASP API Top-10 covered; no secrets in code or logs |

**Back-of-envelope** (assumptions: 100k registered users, 20k daily actives, browse:book ≈ 10:1)

| Quantity | Estimate |
|---|---|
| Browse traffic | 20k DAU × ~20 requests = 400k/day ≈ **5 req/s average, ~50 req/s peak** |
| Booking traffic | ~2k bookings/day ≈ **0.02 req/s** (writes are rare; this is a read-heavy system) |
| Storage | booking ≈ 0.5 KB → ~365 MB/year; venues 10k × 5 KB = 50 MB; audit log ≈ 3 GB/year. **Fits one Postgres node for years** |
| Bandwidth | 50 req/s × ~10 KB ≈ 0.5 MB/s ≈ 4 Mbit/s peak (CDN-cacheable catalogue lowers it) |

Consequence: one well-indexed Postgres primary + a cache comfortably handles the load. Everything below is about **reliability and correctness**, not raw scale.

## 2. Architecture

**Modular monolith** (`src/modules/*`): one deployable, hard internal boundaries.

```
src/
  modules/
    users/         accounts, auth tokens, passwords
    venues/        catalogue (cached)
    bookings/      slots, holds, pricing        ← owns double-booking guarantee
    payments/      Stripe checkout, webhook, refunds
    notifications/ email (pure event subscriber)
    audit/         append-only audit log
  shared/          logger, errors, cache, queue, events, metrics, middleware
  config/          env validation, database
```

Rules that keep the boundaries real (so a module *could* be extracted later):
1. A module exposes only what its `index.ts` exports; others never import its internals.
2. **No cross-module ORM associations or joins.** Modules reference each other by ID (foreign keys exist at the DB level) and call each other's public functions.
3. Modules communicate **asynchronously through domain events** (`shared/events.ts`) where the caller doesn't need an answer. `bookings` publishes `booking.cancelled`; `payments` reacts by refunding; `notifications` reacts by emailing. Bookings never imports payments. That is also what prevents a circular dependency.

**Client-server / REST.** Versioned (`/api/v1`), resource-oriented, correct verbs and codes (`201` + `Location` on create, `204` on delete, `409` on conflicts, `429` when throttled). Uniform error envelope `{ error: { code, message, details, requestId } }`. Collections are paginated.

**Asynchronous communication.** Email and refunds run as background jobs (`shared/queue.ts`): durable BullMQ on Redis with retries and exponential backoff; failed jobs are retained as the dead-letter record. Without Redis, jobs run in-process (dev only, not durable). The Stripe webhook is the asynchronous completion signal for payments.

## 3. Data

**Model** (Postgres, `src/modules/*/*.model.ts`)

`users` 1—* `venues` (owner) · `users` 1—* `bookings` *—1 `venues` · `bookings` 1—* `payments` · `users` 1—* `refresh_tokens` · `audit_logs` (append-only)

Notable choices:
- Money is `DECIMAL`, never float; arithmetic is done in integer cents (`booking.pricing.ts`).
- Time is `TIMESTAMPTZ` start/end (`startsAt`/`endsAt`), replacing separate date and time columns that couldn't express overlap correctly.
- Venues are **soft-deleted** (`paranoid`) so historic bookings and payments keep a valid reference.
- Secrets (`password`, OTP hash) are excluded from every query by default (`defaultScope`).
- The server computes `totalPrice`. Clients can't send it.

**SQL vs NoSQL: Postgres.** The core invariants (no overlapping bookings, booking ↔ payment consistency, foreign keys) need transactions and constraints. The data is relational and small. NoSQL would trade away exactly what this domain needs. JSONB is used where a flexible shape helps (audit metadata).

**The key consistency mechanism:** a Postgres **exclusion constraint** on `bookings`:
```sql
EXCLUDE USING gist ("venueId" WITH =, tstzrange("startsAt","endsAt") WITH &&)
WHERE (status IN ('pending','confirmed'))
```
Overlapping active bookings are *impossible*, whatever the number of app instances, retries or races. (Verified: 5 concurrent requests for one slot → exactly one `201`, four `409`.) The application code relies on this constraint rather than a racy check-then-insert.

**Indexing** (declared on the models): FK lookups (`userId`, `venueId`, `ownerId`), `(venueId, startsAt)` for availability, `(status, expiresAt)` for the hold sweeper, unique `email`/`username`/`tokenHash`/`stripeSessionId`, unique `(userId, idempotencyKey)`, partial unique `(ownerId, name) WHERE deletedAt IS NULL`.

**Consistency model**
- **Strong** for anything involving money or availability: single primary, transactions, constraints, `useMaster: true` reads.
- **Eventual** for the catalogue (cache TTL ≤ 60 s + explicit invalidation on write), emails, and replica reads.

**Replication.** Optional leader–follower: set `DB_REPLICA_HOST` and Sequelize routes plain reads to the replica and writes/transactions to the primary. Replica lag is acceptable for browsing; anything that must be fresh (availability, payment state) pins to the primary. *Multi-leader: not applicable.* It adds conflict resolution for no benefit at this write volume.

**Partitioning / sharding: not applicable yet.** ~1 GB/year does not justify it. When needed, the natural keys are, in order of preference:
1. Partition `bookings` and `audit_logs` **by time** (native Postgres range partitioning) so old data can be detached/archived. This is the first thing to do and is non-disruptive.
2. If a single primary ever becomes the bottleneck, shard by **region/city** (`venues.location`): bookings only ever contend within one venue, so a venue-keyed shard needs no cross-shard transactions.

## 4. Scalability

- **Horizontal scaling.** The app is stateless (sessions are JWTs; rate limits, cache and queue are in Redis), so any number of replicas can run. `docker-compose.yml` runs two behind nginx; `deploy/k8s/app.yaml` has an HPA (3–20 pods on CPU). Vertical scaling is the first lever for Postgres.
- **Load balancing.** nginx uses `least_conn` (requests vary in duration: a checkout call vs a cached read) with passive health checks and failover; the k8s ingress uses latency-aware `ewma`. *Round robin* is fine for uniform requests; *consistent hashing* is unnecessary because there is no per-instance state. It would matter for a sharded cache.
- **Caching, layered:**
  1. **Client/CDN:** public catalogue endpoints send `Cache-Control: public, max-age=30, stale-while-revalidate=60` (Express adds ETags).
  2. **Application:** Redis cache-aside (`shared/cache.ts`) with namespace-version invalidation (one `INCR` invalidates every list/search key), TTL jitter against synchronized expiry, and single-flight to prevent stampedes.
  3. **Database:** Postgres buffer cache + indexes. Never cached: availability, bookings, payments.
- **Read replicas / connection pooling.** Replica routing as above; Sequelize pool (`DB_POOL_MAX`, acquire/idle timeouts). With many replicas use PgBouncer (transaction mode) in front of Postgres so `replicas × pool` can't exhaust `max_connections`.

## 5. Reliability & availability

- **Redundancy & failover.** ≥ 2 app replicas always (k8s: `minReplicas: 3`, `PodDisruptionBudget`, topology spread). Postgres: use a managed HA offering or Patroni (automatic primary failover); the app reconnects with retry/backoff (`retry` in `database.ts`, `connectDatabase`).
- **Health checks.** `/health/live` (process is responsive; no dependencies, so a DB blip doesn't restart-loop pods) and `/health/ready` (DB reachable; reports `degraded` if Redis is down but stays ready; returns `503` while draining).
- **Circuit breaker.** All Stripe calls go through `shared/circuitBreaker.ts` (opossum): timeouts, opens at 50% errors, half-opens after 30 s, and fails fast with `503` rather than stacking requests behind a dead provider. 4xx from Stripe don't count as failures.
- **Rate limiting.** Redis-backed so it holds across instances: 300/min per IP on the API, 20/15 min on credential endpoints, 5/hour on email/checkout endpoints.
- **Graceful degradation** (all verified by stopping the dependency):
  - Redis down → cache and limiter are skipped, queue falls back inline; API keeps serving from Postgres; readiness says `degraded`.
  - Stripe down → breaker opens, checkout returns `503`; browsing and booking holds still work.
  - Email down → jobs retry with backoff; no request is affected.
  - Postgres down → `503` with a retryable message; liveness still passes (no restart storm); recovers automatically.
- **Graceful shutdown.** On `SIGTERM`: readiness flips to `503`, wait for the LB to notice, stop accepting connections, let in-flight requests finish, close queue/Redis/DB, exit (hard stop after 25 s).
- **Disaster recovery.** `scripts/backup-db.sh` (nightly `pg_dump`, verified readable, retention pruning) and `scripts/restore-db.sh`. For RPO of minutes, enable continuous WAL archiving / managed point-in-time recovery. **Rehearse a restore regularly.** Redis uses AOF but holds only derived/ephemeral data plus the job queue.

## 6. Consistency & distributed systems

- **CAP.** Postgres primary is a CP choice for bookings/payments: during a partition we refuse writes (`503`) rather than risk a double-booking. The catalogue cache is AP: slightly stale reads are fine.
- **Consensus (Paxos/Raft): not applicable in application code.** We don't run our own replicated state. Consensus is delegated to infrastructure that already implements it (Postgres HA via Patroni/etcd, Kubernetes via etcd). It would only become our concern if we built our own distributed store.
- **Idempotency for retries.**
  - `POST /bookings` accepts an `Idempotency-Key`; a unique `(userId, key)` index makes retries (and racing duplicates) return the original booking.
  - Stripe calls carry idempotency keys (`checkout:<paymentId>`, `refund:<paymentId>`), so retries never double-charge or double-refund.
  - Webhook handling is idempotent state transitions, because Stripe delivers at-least-once. A duplicate delivery is a no-op.
  - Cancel is idempotent; refund jobs use a deterministic `jobId`.
- **Distributed transaction → saga** (a DB transaction can't span Stripe):
  1. `POST /bookings` → booking `pending`, slot **held** for `BOOKING_HOLD_MINUTES` (the exclusion constraint covers pending + confirmed).
  2. `POST /payments/checkout` → Stripe session; payment `Pending`.
  3. Webhook `checkout.session.completed` → payment `Completed` → booking `confirmed`.
  - **Compensations:** hold lapses unpaid → sweeper marks it `expired` and the slot frees; user cancels a paid booking → refund job; user paid *after* the hold lapsed and someone else took the slot → booking reports `slot_lost` and the payment is refunded automatically.
  - Each step is safe to re-run, so a crash between steps heals on the next webhook retry.
- **Message queues.** BullMQ on Redis for background work (email, refunds). *Kafka/RabbitMQ/SQS: not applicable yet.* At < 1 job/s a Redis queue is the right size; domain events sit behind an interface (`shared/events.ts`) so the transport can be swapped for a broker if a module is extracted.

## 7. Performance

- **Latency vs throughput.** Reads are cheap and cached; the only slow dependency (Stripe) is off the hot path and bounded by a timeout + breaker. bcrypt cost 12 is a deliberate latency-for-security trade on login only.
- **Async processing.** Emails and refunds never block a request.
- **Batching & pagination.** All collections are paginated (`page`, `limit ≤ 100`) with a total count. For deep paging on big tables, move to keyset pagination.
- **Query optimisation.** Indexes above; no N+1 (booking lists fetch venue summaries in one `IN` query); `findAndCountAll` with limits; statement timeout of 10 s and slow-query logging (> 200 ms) so regressions surface.
- **Payload.** gzip, 100 KB JSON body cap.

## 8. Security

- **AuthN.** bcrypt (cost 12) with dummy-hash comparison so login timing doesn't reveal which accounts exist; short-lived (15 min) HS256 access JWTs with pinned algorithm + issuer; **rotating refresh tokens** stored hashed, with reuse detection (replaying an old token revokes the whole family); password change/reset revokes all sessions. Brute-force limits on login/reset; reset codes are 6-digit, single-use, 10-minute, HMAC-hashed at rest, max 5 attempts; `forgot-password` never reveals whether an email exists. *OAuth/social login: not implemented*; add via a provider (e.g., Google OIDC) if desired.
- **AuthZ (RBAC + ownership).** Roles `User`, `Venue Owner`, `Admin` (support staff) and `Super Admin`, enforced per route. Super Admin alone manages staff and roles, and is the only role that can cancel-and-refund a booking to settle a dispute; Admin staff work the complaint/dispute queue on cases assigned to them. Role changes revoke the target's refresh tokens (their current access token lives up to 15 min) (`requireRole`). Ownership is enforced in services (only the owner or an Admin can edit/delete a venue; bookings visible only to the booker, venue owner, or Admin; other people's resource ids return `404`, not `403`). **Admin can't be self-assigned at signup.**
- **Encryption.** In transit: terminate TLS at the ingress/LB (HSTS via helmet), `DB_SSL` for managed Postgres, `rediss://` for Redis. At rest: enable disk/volume encryption on Postgres, Redis and backups (infrastructure setting).
- **Input validation.** Joi on every body/query/param with `stripUnknown` (blocks mass assignment: clients can no longer send `role`, `status`, `totalPrice`); LIKE wildcards escaped in search; parameterised queries via the ORM; helmet security headers; CORS allow-list; body size limits.
- **Webhook security.** Stripe signature + timestamp verified on the raw body; unsigned/forged events are rejected with `400`.
- **Secrets management.** All config from environment, validated at boot (the app refuses to start without a ≥ 32-char `JWT_SECRET`). `.env` is git-ignored; `.env.example` documents variables; k8s manifests read a `Secret`; logs redact tokens and passwords. In production source secrets from a manager (AWS Secrets Manager, Vault, External Secrets).

> `.env` is git-ignored. If a secret has ever been committed, pasted into a chat or shared, rotate it.

## 9. Observability

- **Logging.** Structured JSON (pino), one line per request with `requestId`, secrets redacted. `X-Request-Id` is accepted from the LB or generated, returned to the client, included in every error body and every log line.
- **Metrics.** Prometheus at `/metrics` (optionally token-protected; blocked at the nginx LB): request latency histogram by method/route/status, default Node metrics, cache hit/miss/error, business counters (`booking_created`, `payment_completed`, …), circuit-breaker state.
- **Tracing.** OpenTelemetry auto-instrumentation (http, express, pg, ioredis) enabled by setting `OTEL_EXPORTER_OTLP_ENDPOINT`; `traceId`/`spanId` are added to log lines.
- **Alerting & dashboards** (suggested starting rules): 5xx rate > 1% for 5 min; p95 latency > 500 ms; `/health/ready` failing; `circuit_breaker_open == 1`; `cache_operations_total{result="error"}` rising; bookings stuck `pending` past expiry; failed BullMQ jobs > 0.
- **Audit trail.** `audit_logs` records actor, action, entity, request id and IP for signups, logins, password changes, venue changes, bookings, cancellations, checkouts and payment webhooks.

## 10. Operations

- **CI/CD.** `.github/workflows/ci.yml`: typecheck → tests → build → `npm audit` on every PR; on `main`, build and push a SHA-tagged image, then roll out (behind a protected `production` environment for manual approval) with automatic `rollout undo` on failure.
- **Deployment strategy.** Default is **rolling** (`maxUnavailable: 0`, readiness-gated, `preStop` + graceful shutdown ⇒ zero dropped requests). For **blue-green**, run a second Deployment with a new `version` label and flip the Service selector. For **canary**, use ingress-nginx canary annotations or Argo Rollouts to shift 5% → 25% → 100% while watching the alert rules above. Schema changes should be backward compatible (expand → migrate → contract) so old and new versions can run together.
- **Infrastructure as code.** `Dockerfile` (multi-stage, non-root), `docker-compose*.yml`, `deploy/nginx.conf`, `deploy/k8s/app.yaml` (Deployment, Service, HPA, PDB, Ingress, ConfigMap). Cloud resources (managed Postgres/Redis, VPC) are not defined here; codify them in Terraform when the target cloud is chosen.
- **Cost.** The footprint is small: 2–3 small app pods, one Postgres, one Redis. Biggest levers: don't over-provision Postgres (the data is tiny), let the HPA scale in at night, cache the catalogue (and put a CDN in front), and set log retention and sampling rates for traces.

## Known gaps / next steps

1. **Migrations.** Tables are created with `sequelize.sync()` (race-safe via an advisory lock, never `alter`). Before the first production schema change, adopt versioned migrations (umzug or sequelize-cli).
2. **Integration tests** against a real Postgres (the double-booking and saga behaviour were verified manually end-to-end; unit tests cover pricing, slot rules, auth/RBAC and validation).
3. Table partitioning for `bookings`/`audit_logs` when they reach tens of millions of rows.
4. OAuth/social login, venue image upload (currently HTTPS URLs only), and a venue-owner payout flow (Stripe Connect) are product features, not yet built.
