import { Queue, Worker } from "bullmq"
import { createRedis, redisEnabled } from "./redis"
import { logger } from "./logger"
import client from "prom-client"
import { registry } from "./metrics"

type Handler = (data: any) => Promise<void>

const handlers = new Map<string, Handler>()
let queue: Queue | null = null
let worker: Worker | null = null
const QUEUE_ADD_TIMEOUT_MS = 5_000

class QueueAddTimeoutError extends Error {}

const jobRuns = new client.Counter({ name: "background_jobs_total", help: "Background jobs queued, completed, or retried", labelNames: ["job", "result"], registers: [registry] })
const durableQueue = new client.Gauge({ name: "background_queue_durable", help: "1 when BullMQ is connected and jobs are durable", registers: [registry] })

/** Register the code that runs for a job name. Modules call this at import time. */
export const registerJob = (name: string, handler: Handler) => {
    handlers.set(name, handler)
}

const addWithTimeout = async (name: string, data: unknown, opts: { jobId?: string; delayMs?: number }) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            queue!.add(name, data, { jobId: opts.jobId, delay: opts.delayMs }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new QueueAddTimeoutError("Timed out while adding a background job")), QUEUE_ADD_TIMEOUT_MS)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

const runInline = async (name: string, data: unknown, attempt = 1): Promise<void> => {
    try {
        await handlers.get(name)!(data)
        jobRuns.inc({ job: name, result: "completed" })
    } catch (err) {
        jobRuns.inc({ job: name, result: attempt >= 3 ? "failed" : "retrying" })
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
            await addWithTimeout(name, data, opts)
            durableQueue.set(1)
            jobRuns.inc({ job: name, result: "queued" })
            return
        } catch (err) {
            durableQueue.set(0)
            if (err instanceof QueueAddTimeoutError) {
                jobRuns.inc({ job: name, result: "enqueue_timeout" })
                logger.error({ err: err.message, job: name }, "background job enqueue timed out; caller may retry")
                throw err
            }
            jobRuns.inc({ job: name, result: "inline_fallback" })
            logger.warn({ err: (err as Error).message, job: name }, "queue unavailable, running job inline")
        }
    }
    if (!queue) {
        durableQueue.set(0)
        jobRuns.inc({ job: name, result: "inline_fallback" })
    }
    setImmediate(() => void runInline(name, data))
}

export const startQueue = () => {
    if (!redisEnabled) {
        durableQueue.set(0)
        return logger.warn("REDIS_URL not set: background jobs run in-process and are not durable")
    }

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
            try {
                await handler(job.data)
                jobRuns.inc({ job: job.name, result: "completed" })
            } catch (err) {
                jobRuns.inc({ job: job.name, result: "failed" })
                throw err
            }
        },
        { connection: connection(), concurrency: 5 },
    )
    worker.on("failed", (job, err) => logger.error({ err: err.message, job: job?.name, attempts: job?.attemptsMade }, "job failed"))
    queue.on("error", (err) => {
        durableQueue.set(0)
        logger.warn({ err: err.message }, "queue error")
    })
    worker.on("error", (err) => {
        durableQueue.set(0)
        logger.warn({ err: err.message }, "worker error")
    })
    durableQueue.set(1)
}

export const stopQueue = async () => {
    await worker?.close()
    await queue?.close()
}
