import express from "express"
import helmet from "helmet"
import cors from "cors"
import compression from "compression"
import { pinoHttp } from "pino-http"
import { env } from "./config/env"
import { logger } from "./shared/logger"
import { metricsMiddleware } from "./shared/metrics"
import healthRoutes from "./shared/health"
import { requestId } from "./shared/middleware/requestId"
import { apiLimiter } from "./shared/middleware/rateLimit"
import { errorHandler, notFoundHandler } from "./shared/middleware/errorHandler"
import { userRoutes, userAdminRoutes } from "./modules/users"
import { supportRoutes, caseAdminRoutes } from "./modules/support"
import { venueRoutes } from "./modules/venues"
import { bookingRoutes } from "./modules/bookings"
import { paymentRoutes, stripeWebhook } from "./modules/payments"

export const createApp = () => {
    const app = express()

    app.disable("x-powered-by")
    app.set("trust proxy", env.trustProxy) // number of reverse proxies in front (LB, ingress): makes req.ip and rate limiting correct

    app.use(requestId)
    app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id, autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false } }))
    app.use(helmet())
    app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : false, credentials: true, maxAge: 600 }))
    app.use(compression())
    app.use(metricsMiddleware)

    // Operational endpoints sit outside the rate limiter and the /api prefix.
    app.use(healthRoutes)

    // Stripe signs the exact bytes it sends, so this route must see the raw body, before express.json().
    app.post("/api/v1/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook)

    app.use(express.json({ limit: "100kb" }))

    const api = express.Router()
    api.use(apiLimiter)
    api.use("/users", userRoutes)
    api.use("/venues", venueRoutes)
    api.use("/bookings", bookingRoutes)
    api.use("/payments", paymentRoutes)
    api.use("/support", supportRoutes)
    api.use("/admin/cases", caseAdminRoutes)
    api.use("/admin", userAdminRoutes)
    app.use("/api/v1", api)

    app.use(notFoundHandler)
    app.use(errorHandler)
    return app
}
