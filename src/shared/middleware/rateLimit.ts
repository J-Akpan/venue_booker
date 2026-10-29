import rateLimit, { Options, Store } from "express-rate-limit"
import { RedisStore } from "rate-limit-redis"
import { limiterRedis } from "../redis"
import { env } from "../../config/env"

/**
 * Redis-backed store that is created on first use instead of at boot. RedisStore loads Lua scripts
 * when initialised; doing that at startup fails if Redis isn't up yet, and the limiter would then
 * silently stay broken until the next restart. Here every request retries until Redis is ready.
 */
class LazyRedisStore implements Store {
    private inner: RedisStore | null = null
    private starting: Promise<RedisStore> | null = null
    private windowMs = 60_000
    localKeys = false

    constructor(public prefix: string) {}

    init(options: Options) {
        this.windowMs = options.windowMs
    }

    private async store(): Promise<RedisStore> {
        if (this.inner) return this.inner
        if (limiterRedis?.status !== "ready") throw new Error("redis not ready")
        this.starting ??= (async () => {
            const store = new RedisStore({
                prefix: this.prefix,
                sendCommand: (...args: string[]) => limiterRedis!.call(args[0]!, ...args.slice(1)) as Promise<any>,
            })
            await store.init({ windowMs: this.windowMs } as Options)
            return (this.inner = store)
        })().finally(() => (this.starting = null))
        return this.starting
    }

    async increment(key: string) {
        return (await this.store()).increment(key)
    }
    async decrement(key: string) {
        return (await this.store()).decrement(key)
    }
    async resetKey(key: string) {
        return (await this.store()).resetKey(key)
    }
}

// Counters live in Redis so the limit holds across all app instances behind the load balancer.
// Without Redis it falls back to per-process memory. `passOnStoreError` fails open: an
// outage of the limiter must not become an outage of the API.
const make = (prefix: string, windowMs: number, limit: number) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        passOnStoreError: true,
        skip: () => env.isTest,
        message: { error: { code: "RATE_LIMITED", message: "Too many requests, slow down and retry later" } },
        ...(limiterRedis ? { store: new LazyRedisStore(`rl:${prefix}:`) } : {}),
    })

/** Default for the whole API. */
export const apiLimiter = make("api", 60_000, 300)

/** Dedicated limit for the raw-body Stripe endpoint, which is mounted before the API router. */
export const webhookLimiter = make("stripe-webhook", 60_000, 300)

/** Brute-force protection for credential endpoints (login, signup, OTP). */
export const authLimiter = make("auth", 15 * 60_000, 20)

/** Endpoints that send email or call paid third parties. */
export const sensitiveLimiter = make("sensitive", 60 * 60_000, 5)
