# Venue Booker

Book venues for events. Node 20+ · Express 5 · TypeScript · PostgreSQL · Redis · Stripe.

Design rationale, trade-offs and the systems-design checklist: **[docs/DESIGN.md](docs/DESIGN.md)**.

## Run locally

```bash
cp .env.example .env            # fill in DB_PASSWORD (+ JWT_SECRET, ≥ 32 chars)
docker compose -f docker-compose.dev.yml up -d     # Postgres + Redis (override ports with PG_PORT / REDIS_PORT)
npm install
npm run dev                     # DB_SYNC=true creates tables on boot
```

Production-like stack (nginx load balancer → 2 app replicas → Postgres + Redis):

```bash
DB_PASSWORD=... JWT_SECRET=... METRICS_TOKEN=... docker compose up --build     # http://localhost:8080
```

Create the Super Admin (no HTTP endpoint exists for this on purpose):
`SUPER_ADMIN_USERNAME=root SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='at-least-12-chars' npm run create-super-admin`

Other scripts: `npm test` · `npm run typecheck` · `npm run build` · `npm run db:migrate` (also available as `npm run db:init` in source) · `npm run db:migrate:compiled` (production image) · `scripts/backup-db.sh`.

Redis is optional for local development. Without `REDIS_URL`, jobs run in-process and can be lost on restart; production should configure Redis for durable jobs and shared rate limits. See [production operations](docs/PRODUCTION.md) and [privacy operations](docs/PRIVACY.md).

## API (`/api/v1`)

Errors always look like `{ "error": { "code", "message", "details?", "requestId" } }`. Lists return `{ data, meta: { page, limit, total, totalPages } }`.

| Method & path | Who | Notes |
|---|---|---|
| `POST /users/signup` | public | role `User` (default) or `Venue Owner` |
| `POST /users/login` | public | `{ username \| email, password }` → `{ accessToken, refreshToken }` |
| `POST /users/refresh` · `/logout` | public | rotate / revoke a refresh token |
| `POST /users/forgot-password` · `/reset-password` | public | emailed 6-digit code |
| `GET·PATCH /users/me` · `PUT /users/me/password` | signed in | Profile update includes WhatsApp consent; changing the number clears existing consent |
| `GET /users/me/export` | signed in | JSON copy of profile and related account records |
| `POST /users/me/deletion-request` · `GET /users/me/privacy-requests` | signed in | Request and track staff-reviewed account anonymization |
| `GET /users` | Admin | paginated |
| `GET /venues` | public | `q, location, minCapacity, maxPrice, eventType, amenities, verifiedOnly, sort, page, limit` (cached) |
| `GET /venues/:id` | public | |
| `POST /venues` · `PATCH·DELETE /venues/:id` | Venue Owner (own venues) | Includes amenities, event types, add-ons, cleaning fee, refundable deposit, overtime rate and structured cancellation rules |
| `POST /venues/:id/image-upload-signature` | Venue Owner (own venue) | Signed Cloudinary upload parameters; needs Cloudinary credentials |
| `POST /venues/:id/calendar-token` | Venue Owner (own venue) | Rotates a private iCalendar URL; feed contains busy times without guest details |
| `POST /venues/:id/availability-confirmation` | Venue Owner (own venues) | Publicly records when availability was last checked |
| `POST /venues/:id/verification` | Admin | `{ verified: boolean }`; verification changes are audit-logged |
| `GET /venues/mine` | Venue Owner | |
| `GET /bookings/availability` | public | `venueId, from, to` (ISO dates); returns confirmed bookings and active holds, never cached |
| `GET /bookings/calendar/:venueId.ics?token=...` | calendar client | Private busy-time feed; token is rotated by the venue owner |
| `GET /bookings/quote` | public | `venueId, startsAt, endsAt, eventType?, attendeeCount?, addOns`; returns itemized due-now price and venue terms |
| `POST /bookings` | signed in | `{ venueId, startsAt, endsAt, eventType?, attendeeCount?, addOns? }`; header `Idempotency-Key`; price is computed and snapshotted; creates an owner approval request |
| `GET /bookings` · `GET /bookings/:id` | booker (or venue owner / Admin) | |
| `GET /bookings/venue/:venueId` | Venue Owner | bookings on a venue |
| `GET /bookings/venue/:venueId/analytics` | Venue Owner | Request conversion, response time, cancellations, and confirmed gross |
| `POST /bookings/:id/accept` · `/decline` | Venue Owner | Accept creates a short payment hold; decline releases the slot |
| `POST /bookings/:id/cancel` | booker / venue owner / Admin | refunds if paid |
| `POST /payments/checkout` | booker | `{ bookingId }` → Stripe Checkout `url`; Checkout chooses among methods enabled for the Stripe account and booking currency |
| `GET /payments/booking/:bookingId` | booker | |
| `POST /payments/connect/onboarding` · `GET /payments/connect/status` | Venue Owner | Stripe Connect onboarding and readiness; disabled until configured |
| `GET /payments/connect/settlements` | Venue Owner | Paginated routed amount, platform fee, and refund ledger |
| `POST /payments/webhook` | Stripe | signature-verified; point Stripe at it |
| `GET /reviews/venues/:venueId` | public | Paginated reviews and rating summary |
| `POST /reviews` | signed in | `{ bookingId, rating, comment? }`; one review per confirmed booking, after the event ends |
| `POST·GET /support/cases` · `GET /support/cases/:id` | booker / venue owner | raise a `complaint` or a `dispute` (needs `bookingId`, caller must be a party to it); follow your own cases |
| `GET /admin/cases` · `GET /admin/cases/:id` | Admin, Super Admin | queue; filters `status, type, assignedTo, unassigned` (oldest first) |
| `POST /admin/cases/:id/assign` | Admin (self), Super Admin (anyone) | |
| `POST /admin/cases/:id/resolve` | assignee, or Super Admin | `{ outcome: resolved\|rejected, resolution, bookingAction? }`; `bookingAction: "cancel_and_refund"` is Super Admin only |
| `GET·POST /admin/staff` · `DELETE /admin/staff/:userId` | Super Admin | list / create Admin staff / demote to User |
| `PUT /admin/users/:userId/role` | Super Admin | `User`, `Venue Owner` or `Admin`; not yourself, not another Super Admin |
| `GET /admin/privacy` · `POST /admin/privacy/:requestId/resolve` | Admin, Super Admin | Review, complete, or reject account deletion requests |
| `GET /health/live` · `/health/ready` · `/metrics` | ops | outside `/api` |

Typical flow: browse a venue → check availability and quote → sign in → `POST /bookings` → owner accepts with `POST /bookings/:id/accept` → booker pays through Stripe Checkout → signed webhook confirms the booking. Requests hold the slot for `BOOKING_REQUEST_HOLD_HOURS`; acceptance starts the shorter `BOOKING_HOLD_MINUTES` payment hold. Enable payment methods in Stripe Dashboard. Booking responses include a price breakdown; cleaning and selected add-ons are included in the online amount, while refundable deposits due to the venue are shown separately. Cancellation rules are copied onto the booking so later venue edits do not rewrite existing bookings.

## Breaking changes from the previous version

- Routes moved under `/api/v1` and are resource-style (`PATCH /venues/:id`, no `/venues/update` with the name in the body).
- Environment variable names are now `JWT_SECRET`, `DB_HOST`, `DB_USER`, `STRIPE_SECRET_KEY`. The old names (`privateKey`, `HOST`, `DB_USERNAME`, `stripe_secret_key`) still work. `JWT_SECRET` must be ≥ 32 characters or the app won't start.
- Venue fields: `names` → `name`; `capacity` and `pricePerHour` are numbers. Bookings use `startsAt`/`endsAt` (ISO timestamps) instead of separate date/time fields, and no longer accept `totalPrice`.
- Schema changes use recorded additive migrations. Run `npm run db:migrate` once before deploying the API; do not start production replicas with pending migrations.
- Tables are no longer auto-altered on every start (`alter: true` was removed because it can drop columns).
