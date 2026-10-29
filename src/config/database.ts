import { Sequelize } from "sequelize"
import { env } from "./env"
import { logger } from "../shared/logger"

const credentials = { username: env.db.user, password: env.db.password, port: env.db.port }

// Writes (and read-your-writes inside transactions) go to the primary; plain reads are
// spread over the replica when one is configured. Replication is asynchronous, so reads
// that must be fresh (booking availability, payment state) use `useMaster: true`.
export const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
    dialect: "postgres",
    replication: {
        write: { host: env.db.host, ...credentials },
        read: [{ host: env.db.replicaHost || env.db.host, ...credentials }],
    },
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

    // Keep one active checkout per booking. Preserve existing payment rows while demoting
    // duplicate pending attempts; a late success from those Stripe sessions is still handled
    // by the webhook and compensated if another payment has already confirmed the booking.
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
    await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS payments_one_pending_per_booking
        ON payments ("bookingId")
        WHERE status = 'Pending';
    `)
    await sequelize.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "confirmedPaymentId" UUID;`)
    // Backfill the best available confirmation link for bookings created before this column existed.
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
    `)
}

export const pingDatabase = async () => {
    await sequelize.query("SELECT 1", { useMaster: true })
}
