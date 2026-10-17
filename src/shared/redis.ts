import Redis, { RedisOptions } from "ioredis"
import { env } from "../config/env"
import { logger } from "./logger"

export const redisEnabled = Boolean(env.redisUrl)

export const createRedis = (options: RedisOptions = {}): Redis => {
    const client = new Redis(env.redisUrl, {
        // Fail fast instead of queueing commands while Redis is down: callers fall back to the database.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
        ...options,
    })
    client.on("error", (err) => logger.warn({ err: err.message }, "redis error"))
    return client
}

// Shared client for cache + rate limiting. Null when Redis is not configured.
export const redis: Redis | null = redisEnabled ? createRedis() : null

// The rate limiter loads a Lua script at construction, before the connection is up, so it needs
// a client that queues commands while connecting. A short command timeout still bounds the damage of an outage.
export const limiterRedis: Redis | null = redisEnabled ? createRedis({ enableOfflineQueue: true, commandTimeout: 300 }) : null

export const redisHealthy = () => redis?.status === "ready"
