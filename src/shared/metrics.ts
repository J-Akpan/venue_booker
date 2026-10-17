import { Request, Response, NextFunction } from "express"
import client from "prom-client"

export const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry })

const httpDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request latency",
    labelNames: ["method", "route", "status"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
})

export const cacheOps = new client.Counter({
    name: "cache_operations_total",
    help: "Cache hits, misses and errors",
    labelNames: ["result"],
    registers: [registry],
})

export const businessEvents = new client.Counter({
    name: "business_events_total",
    help: "Domain events (bookings created, payments completed, ...)",
    labelNames: ["event"],
    registers: [registry],
})

export const breakerState = new client.Gauge({
    name: "circuit_breaker_open",
    help: "1 when the circuit breaker is open",
    labelNames: ["name"],
    registers: [registry],
})

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export const metricsMiddleware =(req: Request, res: Response, next: NextFunction) => {
    const end = httpDuration.startTimer()
    res.on("finish", () => {
        // Keep label cardinality bounded: unmatched paths collapse into one label and ids are masked.
        // (req.baseUrl is already reset by the time errors unwind, so derive the path from the original URL.)
        const route = req.route ? (req.originalUrl.split("?")[0] ?? "").replace(UUID, ":id") : "unmatched"
        end({ method: req.method, route, status: res.statusCode })
    })
    next()
}
