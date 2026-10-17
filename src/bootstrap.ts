import { applyDatabaseConstraints, sequelize } from "./config/database"
import { logger } from "./shared/logger"
import { startQueue } from "./shared/queue"
import { initNotifications } from "./modules/notifications"
import { initPayments } from "./modules/payments"
import { expireStaleHolds } from "./modules/bookings"
import "./modules/audit"

const SCHEMA_LOCK_ID = 7_426_001 // arbitrary app-wide constant

const sleep =(ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait for the database with backoff, so a container that starts before Postgres doesn't crash-loop. */
export const connectDatabase = async (attempts = 8) => {
    for (let i = 1; ; i++) {
        try {
            await sequelize.authenticate()
            logger.info("database connected")
            return
        } catch (err) {
            if (i >= attempts) throw err
            const delay = Math.min(500 * 2 ** i, 8_000)
            logger.warn({ attempt: i, delay }, "database not ready, retrying")
            await sleep(delay)
        }
    }
}

/**
 * Create missing tables and DB-level constraints. No `alter`: it can drop or rewrite columns.
 * For evolving an existing production schema use reviewed, versioned migrations instead.
 */
export const initSchema = async () => {
    // Several instances booting together would race on CREATE TABLE. A session-level advisory lock,
    // held on one dedicated connection, makes them take turns; later ones find nothing left to do.
    const lockConn: any = await sequelize.connectionManager.getConnection({ type: "write" })
    try {
        await lockConn.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_ID])
        await sequelize.sync()
        await applyDatabaseConstraints()
    } finally {
        await lockConn.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_ID]).catch(() => {})
        sequelize.connectionManager.releaseConnection(lockConn)
    }
    logger.info("schema ready")
}

/** Wire modules together (event subscribers, job handlers) and start background work. */
export const startBackground = () => {
    initNotifications()
    initPayments()
    startQueue()

    const sweeper = setInterval(() => {
        expireStaleHolds().catch((err) => logger.error({ err }, "hold expiry sweep failed"))
    }, 30_000)
    sweeper.unref()
    return () => clearInterval(sweeper)
}
