import { sequelize } from "./config/database"
import { logger } from "./shared/logger"
import { startQueue } from "./shared/queue"
import { initNotifications } from "./modules/notifications"
import { initPayments, recoverOutstandingRefunds } from "./modules/payments"
import { expireStaleHolds } from "./modules/bookings"
import "./modules/audit"
import "./modules/support"
import "./modules/reviews/review.model"
import "./modules/users/privacy-request.model"
import { runMigrations } from "./shared/migrations"

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
 * Apply recorded, additive schema migrations. Production deploys run the same command explicitly
 * before app replicas start; local development can apply pending migrations on startup.
 */
export const initSchema = async () => {
    await runMigrations()
    logger.info("schema ready")
}

/** Wire modules together (event subscribers, job handlers) and start background work. */
export const startBackground = () => {
    initNotifications()
    initPayments()
    startQueue()

    void recoverOutstandingRefunds().catch((err) => logger.error({ err }, "refund recovery scan failed"))
    const refundRecovery = setInterval(() => {
        recoverOutstandingRefunds().catch((err) => logger.error({ err }, "refund recovery scan failed"))
    }, 60_000)
    refundRecovery.unref()

    const sweeper = setInterval(() => {
        expireStaleHolds().catch((err) => logger.error({ err }, "hold expiry sweep failed"))
    }, 30_000)
    sweeper.unref()
    return () => {
        clearInterval(sweeper)
        clearInterval(refundRecovery)
    }
}
