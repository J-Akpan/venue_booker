import CircuitBreaker from "opossum"
import { breakerState } from "./metrics"
import { logger } from "./logger"
import { unavailable } from "./errors"

/**
 * Wrap a call to an external dependency. After enough failures the breaker opens and calls
 * fail immediately (503) instead of piling up behind a dead provider; it probes again after
 * `resetTimeout`. Business errors (4xx from the provider) don't count towards opening.
 */
export const withBreaker = <A extends unknown[], R>(
    name: string,
    fn: (...args: A) => Promise<R>,
    opts: { timeout?: number; isClientError?: (err: unknown) => boolean } = {},
) => {
    const breaker = new CircuitBreaker(fn, {
        timeout: opts.timeout ?? 8_000,
        errorThresholdPercentage: 50,
        volumeThreshold: 5,
        resetTimeout: 30_000,
        errorFilter: opts.isClientError,
    })
    breaker.on("open", () => {
        breakerState.set({ name }, 1)
        logger.error({ breaker: name }, "circuit breaker opened")
    })
    breaker.on("close", () => {
        breakerState.set({ name }, 0)
        logger.info({ breaker: name }, "circuit breaker closed")
    })
    breakerState.set({ name }, 0)

    return async (...args: A): Promise<R> => {
        try {
            return await breaker.fire(...args)
        } catch (err: any) {
            if (err?.code === "EOPENBREAKER" || err?.code === "ETIMEDOUT") {
                throw unavailable(`${name} is temporarily unavailable, please retry shortly`)
            }
            throw err
        }
    }
}
