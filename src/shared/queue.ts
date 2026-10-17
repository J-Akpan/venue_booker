import { Queue, Worker } from "bullmq"
import { createRedis, redisEnabled } from "./redis"
import { logger } from "./logger"

type Handler = (data: any) => Promise<void>

const handlers = new Map<string, Handler>()
let queue: Queue | null = null
let worker: Worker | null = null

/** Register the code that runs for a job name. Modules call this at import time. */
export const registerJob = (name: string, handler: Handler) => {
    handlers.set(name, handler)
}

const runInline = async (name: string, data: unknown, attempt = 1): Promise<void> => {
    try {
        await handlers.get(name)!(data)
    } catch (err) {
        if (attempt >= 3) return logger.error({ err, job: name }, "inline job failed permanently")
        setTimeout(() => void runInline(name, data, attempt + 1), 1_000 * 2 ** attempt)
    }
}

/**
 * Hand work to the background so the HTTP request can return immediately.
 * With Redis: durable BullMQ job with retries + exponential backoff (survives restarts).
 * Without Redis: in-process fire-and-forget with retries (dev only, not durable).
 * Jobs must be idempotent: delivery is at-least-once.
 */
export const enqueue = async (name: string, data: unknown, opts: { jobId?: string; delayMs?: number } = {}) => {
    if (!handlers.has(name)) throw new Error(`No handler registered for job "${name}"`)
    if (queue) {
        try {
            await queue.add(name, data, { jobId: opts.jobId, delay: opts.delayMs })
            return
        } catch (err) {
            logger.warn({ err: (err as Error).message, job: name }, "queue unavailable, running job inline")
        }
    }
    setImmediate(() => void runInline(name, data))
}

export const startQueue = () => {
    if (!redisEnabled) return logger.warn("REDIS_URL not set: background jobs run in-process and are not durable")

    // BullMQ requires blocking connections that never give up on commands.
    const connection = () => createRedis({ maxRetriesPerRequest: null, enableOfflineQueue: true })
    queue = new Queue("jobs", {
        connection: connection(),
        defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 2_000 },
            removeOnComplete: { age: 3_600, count: 1_000 },
            removeOnFail: { age: 7 * 24 * 3_600 }, // failed jobs act as the dead-letter record
        },
    })
    worker = new Worker(
        "jobs",
        async (job) => {
            const handler = handlers.get(job.name)
            if (!handler) throw new Error(`No handler for job "${job.name}"`)
            await handler(job.data)
        },
        { connection: connection(), concurrency: 5 },
    )
    worker.on("failed", (job, err) => logger.error({ err: err.message, job: job?.name, attempts: job?.attemptsMade }, "job failed"))
    queue.on("error", (err) => logger.warn({ err: err.message }, "queue error"))
    worker.on("error", (err) => logger.warn({ err: err.message }, "worker error"))
}

export const stopQueue = async () => {
    await worker?.close()
    await queue?.close()
}
