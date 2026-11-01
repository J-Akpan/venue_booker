import { Sequelize } from "sequelize"
import { env } from "./env"
import { logger } from "../shared/logger"

const credentials = { username: env.db.user, password: env.db.password, port: env.db.port }

// Writes (and read-your-writes inside transactions) go to the primary; plain reads are
// spread over the replica when one is configured. Replication is asynchronous, so reads
// that must be fresh (booking availability, payment state) use `useMaster: true`.
const replication = env.db.replicaHost
    ? {
          write: { host: env.db.host, ...credentials },
          read: [{ host: env.db.replicaHost, ...credentials }],
      }
    : undefined

export const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
    dialect: "postgres",
    ...(replication ? { replication } : { host: env.db.host, port: env.db.port }),
    pool: { max: env.db.poolMax, min: 1, acquire: 10_000, idle: 10_000 },
    dialectOptions: {
        statement_timeout: 10_000,
        idle_in_transaction_session_timeout: 15_000,
        ...(env.db.ssl
            ? { ssl: { rejectUnauthorized: true, ...(env.db.sslCa ? { ca: env.db.sslCa } : {}) } }
            : {}),
    },
    retry: { max: 3, match: [/ECONNRESET/, /ETIMEDOUT/, /ECONNREFUSED/, /SequelizeConnectionError/] },
    benchmark: true,
    logging: (sql, ms) => {
        if (typeof ms === "number" && ms > 200) logger.warn({ ms, sql }, "slow query")
        else logger.trace({ sql, ms }, "query")
    },
})

/**
 * Constraints Sequelize can't express. The exclusion constraint makes double-booking
 * impossible at the database level, regardless of how many app instances are running.
 */
export const applyDatabaseConstraints = async () => {
    await sequelize.query("CREATE EXTENSION IF NOT EXISTS btree_gist")
    await sequelize.query("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    await sequelize.query(`
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
                ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
                EXCLUDE USING gist ("venueId" WITH =, tstzrange("startsAt", "endsAt") WITH &&)
                WHERE (status IN ('pending', 'confirmed'));
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_valid_range') THEN
                ALTER TABLE bookings ADD CONSTRAINT bookings_valid_range CHECK ("endsAt" > "startsAt");
            END IF;
        END $$;`)

    // Do the duplicate cleanup once, before building the unique index. Subsequent app starts
    // only do a catalog lookup, instead of ranking the entire payments table on every boot.
    const [pendingIndexRows] = await sequelize.query(`
        SELECT COALESCE((
            SELECT i.indisvalid
            FROM pg_index AS i
            WHERE i.indexrelid = to_regclass('payments_one_pending_per_booking')
        ), FALSE) AS valid;
    `)
    const pendingIndexValid = (pendingIndexRows as Array<{ valid: boolean }>)[0]?.valid
    if (!pendingIndexValid) {
        await sequelize.query(`
            WITH ranked AS (
                SELECT "paymentId",
                       ROW_NUMBER() OVER (PARTITION BY "bookingId" ORDER BY "createdAt" DESC, "paymentId" DESC) AS position
                FROM payments
                WHERE status = 'Pending'
            )
            UPDATE payments AS p
            SET status = 'Failed'
            FROM ranked
            WHERE p."paymentId" = ranked."paymentId" AND ranked.position > 1;
        `)
        // A failed concurrent build can leave an invalid index under this name.
        await sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS payments_one_pending_per_booking`)
        await sequelize.query(`
            CREATE UNIQUE INDEX CONCURRENTLY payments_one_pending_per_booking
            ON payments ("bookingId")
            WHERE status = 'Pending';
        `)
    }

    // A fresh schema already has this column from sequelize.sync(). For an older schema,
    // add and backfill it together so startup does not repeat an O(bookings × payments) scan.
    const [columnRows] = await sequelize.query(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'bookings' AND column_name = 'confirmedPaymentId'
        ) AS present;
    `)
    const confirmedPaymentColumnPresent = (columnRows as Array<{ present: boolean }>)[0]?.present
    if (!confirmedPaymentColumnPresent) {
        await sequelize.transaction(async (transaction) => {
            await sequelize.query(`ALTER TABLE bookings ADD COLUMN "confirmedPaymentId" UUID;`, { transaction })
            await sequelize.query(`
                UPDATE bookings AS b
                SET "confirmedPaymentId" = (
                    SELECT p."paymentId"
                    FROM payments AS p
                    WHERE p."bookingId" = b."bookingId" AND p.status = 'Completed'
                    ORDER BY p."paidAt" ASC NULLS LAST, p."createdAt" ASC
                    LIMIT 1
                )
                WHERE b.status = 'confirmed' AND b."confirmedPaymentId" IS NULL;
            `, { transaction })
        })
    }

    // Additive product fields used by the venue discovery and booking-confidence APIs.
    // Keep these idempotent so existing installations can run `npm run db:init` safely.
    const productColumns = [
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "cleaningFee" DECIMAL(10,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "refundableDeposit" DECIMAL(10,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "overtimePricePerHour" DECIMAL(10,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "eventTypes" VARCHAR(60)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(60)[]`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS amenities VARCHAR(60)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(60)[]`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "cancellationPolicy" TEXT`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT FALSE`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMPTZ`,
        `ALTER TABLE venues ADD COLUMN IF NOT EXISTS "availabilityConfirmedAt" TIMESTAMPTZ`,
        `ALTER TABLE venues ALTER COLUMN currency SET DEFAULT 'NGN'`,
        `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "eventType" VARCHAR(80)`,
        `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "attendeeCount" INTEGER`,
        `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "priceBreakdown" JSONB NOT NULL DEFAULT '{}'::jsonb`,
        `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "cancellationPolicySnapshot" TEXT`,
    ]
    for (const statement of productColumns) await sequelize.query(statement)

    // Query indexes added with CONCURRENTLY so deploying them does not block catalogue writes.
    const indexes = [
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_active_name_trgm ON venues USING gin ("name" gin_trgm_ops) WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_active_description_trgm ON venues USING gin ("description" gin_trgm_ops) WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_active_location_trgm ON venues USING gin ("location" gin_trgm_ops) WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_event_types_gin ON venues USING gin ("eventTypes") WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_amenities_gin ON venues USING gin (amenities) WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_active_created_at ON venues ("createdAt" DESC) WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_active_price ON venues ("pricePerHour") WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_owner_created_at ON venues ("ownerId", "createdAt" DESC) WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS users_created_at ON users ("createdAt" DESC)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS users_role_created_at ON users ("role", "createdAt" DESC)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS support_cases_created_at ON support_cases ("createdAt" ASC)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS support_cases_status_created_at ON support_cases ("status", "createdAt" ASC)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS support_cases_type_created_at ON support_cases ("type", "createdAt" ASC)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS support_cases_assignee_created_at ON support_cases ("assignedTo", "createdAt" ASC)`,
    ]
    for (const index of indexes) await sequelize.query(index)
}

export const pingDatabase = async () => {
    await sequelize.query("SELECT 1", { useMaster: true })
}
