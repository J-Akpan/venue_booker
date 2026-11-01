# Privacy operations

## User requests

- `GET /api/v1/users/me/export` returns the authenticated user's profile, bookings and payment summaries, support cases, reviews, owned venues, and settlement records as JSON. Every export is recorded in `privacy_requests` and the audit log.
- `POST /api/v1/users/me/deletion-request` opens a deletion request. The user can see its status at `GET /api/v1/users/me/privacy-requests`.
- Admins review requests at `GET /api/v1/admin/privacy`. `POST /api/v1/admin/privacy/:requestId/resolve` accepts `decision: "review"`, `"complete"`, or `"reject"` and an optional note.

Completing a deletion request cancels active bookings, schedules applicable refunds, hides the user's venues, revokes refresh tokens, and removes account profile details by replacing the login identifiers and password. Authentication checks the database, so the account stops working immediately. Booking, payment, support, settlement, and audit references are retained for reconciliation and dispute handling. This is pseudonymization of the account record, not physical erasure of every transaction reference.

Venue payout accounts are held by Stripe. Closing or removing a connected Stripe account, handling remaining balances, and removing processor-held information require a separate operator action in Stripe. Confirm outstanding refunds, disputes, and payout records before completing deletion. Define retention periods for records and backups with local legal and accounting advisers; the app's default backup retention is documented in the backup script.

## WhatsApp consent

Store a valid international phone number before opting in. The app records the opt-in timestamp and audit event, skips messages for users without consent, and clears consent when the saved number changes. Opt-outs stop future WhatsApp messages. Email notices are separate from WhatsApp consent.

## Suspected data incident

1. Restrict access to the affected account, secret, or service and rotate exposed credentials.
2. Preserve relevant application, database, queue, and provider audit records; do not delete evidence while investigating.
3. Identify affected data, accounts, systems, and time range. Coordinate with the database, hosting, payment, messaging, and image providers as applicable.
4. Record containment and remediation actions in the incident log. Have the responsible privacy and legal contacts determine any required notices and deadlines.
5. Restore from a verified clean backup only after the entry point is understood, then review access and alerting.

This runbook supports operations; it does not determine legal obligations or reporting deadlines.
