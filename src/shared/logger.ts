import pino from "pino"
import { trace } from "@opentelemetry/api"
import { env } from "../config/env"

export const logger = pino({
    level: env.logLevel,
    // Never write credentials or tokens to logs.
    redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.otp", "*.token", "*.refreshToken"],
        censor: "[redacted]",
    },
    // Correlate log lines with distributed traces when tracing is enabled.
    mixin() {
        const ctx = trace.getActiveSpan()?.spanContext()
        return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : {}
    },
    ...(env.isProd || env.isTest ? {} : { transport: { target: "pino-pretty" } }),
})
