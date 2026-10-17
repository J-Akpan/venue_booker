import { Router } from "express"
import { pingDatabase } from "../config/database"
import { redis, redisHealthy } from "./redis"
import { registry } from "./metrics"
import { env } from "../config/env"

export const lifecycle = { draining: false }

const router = Router()

/** Liveness: "is the process responsive?" Orchestrators restart the container if this fails. Checks nothing external. */
router.get("/health/live", (_req, res) => {
    res.json({ status: "ok" })
})

/**
 * Readiness: "should the load balancer send me traffic?" Fails when draining or when the
 * database (a hard dependency) is down. Redis is a soft dependency: its absence reports
 * "degraded" but stays ready, because the app serves from the database without it.
 */
router.get("/health/ready", async (_req, res) => {
    if (lifecycle.draining) return res.status(503).json({ status: "draining" })
    try {
        await pingDatabase()
    } catch {
        return res.status(503).json({ status: "unavailable", database: "down" })
    }
    const cache = !redis ? "disabled" : redisHealthy() ? "up" : "down"
    res.json({ status: cache === "down" ? "degraded" : "ok", database: "up", cache })
})

router.get("/metrics", async (req, res) => {
    // In production, keep this on an internal network or require the token.
    if (env.metricsToken && req.header("authorization") !== `Bearer ${env.metricsToken}`) return res.status(401).end()
    res.set("Content-Type", registry.contentType).send(await registry.metrics())
})

export default router
