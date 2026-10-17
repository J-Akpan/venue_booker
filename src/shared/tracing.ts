// Opt-in OpenTelemetry tracing. Must be imported before anything else in server.ts so the
// auto-instrumentations can patch http/express/pg/ioredis before they are loaded.
import { env } from "../config/env"

let shutdownTracing: () => Promise<void> = async () => {}

if (env.otelEndpoint) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NodeSDK } = require("@opentelemetry/sdk-node")
    const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node")
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http")

    const sdk = new NodeSDK({
        serviceName: process.env.OTEL_SERVICE_NAME ?? "venue-booker",
        traceExporter: new OTLPTraceExporter({ url: `${env.otelEndpoint.replace(/\/$/, "")}/v1/traces` }),
        instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })],
    })
    sdk.start()
    shutdownTracing = () => sdk.shutdown()
}

export { shutdownTracing }
