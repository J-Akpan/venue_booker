# Production operations

## Database and deploys

Use PostgreSQL with `btree_gist` and `pg_trgm` extension privileges, TLS, and a dedicated application user. Set `NODE_ENV=production`, `DB_SYNC=false`, and a strong `JWT_SECRET`. Run `npm run build`, then `npm run db:migrate:compiled` once as a deployment step before starting or scaling API replicas. The compiled command is included in the runtime image. The app checks that migrations are current at startup. Add future schema changes as new immutable entries in `src/shared/migrations.ts`.

Back up the primary database nightly with `scripts/backup-db.sh`, copy dumps to versioned storage outside the database host, and set a retention policy. Enable managed point-in-time recovery or WAL archiving where available. Rehearse `scripts/restore-db.sh` against a disposable database and verify the application can read the restored data.

Redis is optional for local development. In production, configure `REDIS_URL` so rate limits are shared between replicas and jobs survive restarts. Without it, background tasks run in process and are not durable. Monitor `background_queue_durable`; refund recovery scans retry missed refund jobs, but this is a recovery path, not a substitute for Redis.

## Payments and venue payouts

Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, checkout return URLs, and the Stripe webhook endpoint `/api/v1/payments/webhook`. Subscribe the endpoint to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `account.updated`.

Stripe Connect is disabled by default. Before enabling it, confirm the platform and connected-account country are supported in your Stripe account, configure the platform's country and fee, and set `STRIPE_CONNECT_RETURN_URL` and `STRIPE_CONNECT_REFRESH_URL` to frontend pages. Owners then complete hosted onboarding at `POST /api/v1/payments/connect/onboarding`. Destination charges are created only for accounts marked ready. App refunds reverse the destination transfer and application fee. Use the app's cancellation flow for refunds; dashboard refunds need an operator reconciliation. The settlement API is the app's charge/fee ledger; Stripe remains authoritative for bank payout timing and payout failures.

Set `PLATFORM_FEE_BPS` deliberately. `100` means 1%. The configured fee is snapshotted when checkout starts. Review tax, consumer, marketplace, and payout terms with the appropriate local advisers before charging customers.

## Images, messages, and consent

Cloudinary uploads remain disabled until credentials and `CLOUDINARY_UPLOAD_PRESET` are set. Configure the preset as signed-only with file-size, format, transformation, and moderation limits in Cloudinary. The owner API returns short lived signed upload parameters scoped to that venue's folder; save the returned `secure_url` through the venue update endpoint.

Email uses the configured SMTP connection. WhatsApp stays disabled until the Graph API version, phone number ID, access token, and approved template are configured together. The template must accept one body variable. Users must save an E.164 phone number and opt in; changing the number clears consent until they opt in again. Revoke consent by setting `whatsappOptIn` to `false` on `PATCH /api/v1/users/me`.

## Monitoring and recovery

Scrape `/metrics` from a private network. In production, send `Authorization: Bearer <METRICS_TOKEN>` and keep the token in your secret manager. Load `deploy/monitoring/venue-booker-alerts.yml` into Prometheus and connect Alertmanager to an actively monitored channel. Also probe `/health/ready` from outside the application cluster so a database outage pages operators.

Inspect the failed BullMQ jobs in Redis before retrying them. Refund jobs use Stripe idempotency keys, and a periodic recovery scan re-enqueues refunds for cancelled, expired, declined, or otherwise lost bookings. Review processor state before manually retrying a charge or refund.

Keep provider credentials out of source control and logs. Rotate Stripe, SMTP, WhatsApp, Cloudinary, JWT, and metrics credentials after suspected exposure. Do not include calendar feed tokens in support tickets or public venue pages; rotating the venue calendar token invalidates the old feed URL.
