import { redis, redisHealthy } from "./redis"
import { cacheOps } from "./metrics"
import { logger } from "./logger"

const inflight = new Map<string, Promise<unknown>>()

const versionOf = async (namespace: string): Promise<string> => {
    const v = await redis!.get(`cache:${namespace}:v`)
    return v ?? "0"
}

/**
 * Cache-aside with:
 *  - namespace versioning (invalidate a whole family of keys with one INCR, no SCAN/DEL),
 *  - single-flight (concurrent misses on one instance trigger one DB query, not N),
 *  - graceful degradation (any Redis failure silently falls through to the loader).
 */
export const cached = async <T>(namespace: string, key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> => {
    if (!redis || !redisHealthy()) return loader()

    let fullKey: string
    try {
        fullKey = `cache:${namespace}:${await versionOf(namespace)}:${key}`
        const hit = await redis.get(fullKey)
        if (hit !== null) {
            cacheOps.inc({ result: "hit" })
            return JSON.parse(hit) as T
        }
    } catch (err) {
        cacheOps.inc({ result: "error" })
        logger.warn({ err: (err as Error).message }, "cache read failed, using database")
        return loader()
    }

    cacheOps.inc({ result: "miss" })
    const pending = inflight.get(fullKey)
    if (pending) return pending as Promise<T>

    const promise = (async () => {
        try {
            const value = await loader()
            // Jitter the TTL so keys written together don't all expire together.
            const ttl = Math.round(ttlSeconds * (0.9 + Math.random() * 0.2))
            redis.set(fullKey, JSON.stringify(value), "EX", ttl).catch(() => {})
            return value
        } finally {
            inflight.delete(fullKey)
        }
    })()
    inflight.set(fullKey, promise)
    return promise
}

export const invalidateNamespace = async (namespace: string): Promise<void> => {
    if (!redis || !redisHealthy()) return
    try {
        await redis.incr(`cache:${namespace}:v`)
    } catch (err) {
        logger.warn({ err: (err as Error).message, namespace }, "cache invalidation failed")
    }
}
