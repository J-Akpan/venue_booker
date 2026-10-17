import "./shared/tracing" // must stay first: patches libraries before they are loaded
import { shutdownTracing } from "./shared/tracing"
import { env } from "./config/env"
import { sequelize } from "./config/database"
import { logger } from "./shared/logger"
import { stopQueue } from "./shared/queue"
import { redis } from "./shared/redis"
import { lifecycle } from "./shared/health"
import { createApp } from "./app"
import { connectDatabase, initSchema, startBackground } from "./bootstrap"

const SHUTDOWN_GRACE_MS = 25_000
const LB_DRAIN_DELAY_MS = env.isProd ? 5_000 : 0

const main = async () => {
    await connectDatabase()
    if (env.db.sync) await initSchema()
    const stopSweeper = startBackground()

    const server = createApp().listen(env.port, () => logger.info({ port: env.port, env: env.nodeEnv }, "server listening"))
    // Defend against slow-loris style connections and keep-alive races with the load balancer.
    server.headersTimeout = 20_000
    server.requestTimeout = 30_000
    server.keepAliveTimeout = 65_000

    let shuttingDown = false
    const shutdown = async (signal: string) => {
        if (shuttingDown) return
        shuttingDown = true
        logger.info({ signal }, "shutting down gracefully")
        const force = setTimeout(() => {
            logger.error("graceful shutdown timed out, forcing exit")
            process.exit(1)
        }, SHUTDOWN_GRACE_MS)
        force.unref()

        lifecycle.draining = true // /health/ready now returns 503: the load balancer stops sending new requests
        await new Promise((r) => setTimeout(r, LB_DRAIN_DELAY_MS))
        stopSweeper()
        await new Promise<void>((resolve) => server.close(() => resolve())) // lets in-flight requests finish
        await stopQueue().catch(() => {})
        await redis?.quit().catch(() => {})
        await sequelize.close().catch(() => {})
        await shutdownTracing().catch(() => {})
        logger.info("shutdown complete")
        process.exit(0)
    }
    process.on("SIGTERM", () => void shutdown("SIGTERM"))
    process.on("SIGINT", () => void shutdown("SIGINT"))
}

process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled rejection"))
process.on("uncaughtException", (err) => {
    // State is undefined after an uncaught exception: log and let the orchestrator restart us.
    logger.fatal({ err }, "uncaught exception")
    process.exit(1)
})

main().catch((err) => {
    logger.fatal({ err }, "failed to start")
    process.exit(1)
})
