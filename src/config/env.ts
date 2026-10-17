import dotenv from "dotenv"
import Joi from "joi"
dotenv.config()

// Legacy variable names (privateKey, HOST, ...) are still honoured so existing .env files keep working.
const raw = {
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET ?? process.env.privateKey,
    DB_HOST: process.env.DB_HOST ?? process.env.HOST,
    DB_USER: process.env.DB_USER ?? process.env.DB_USERNAME,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? process.env.stripe_secret_key,
}

const schema = Joi.object({
    NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
    PORT: Joi.number().port().default(4000),
    LOG_LEVEL: Joi.string().valid("fatal", "error", "warn", "info", "debug", "trace", "silent").default("info"),
    TRUST_PROXY: Joi.number().integer().min(0).default(0),
    CORS_ORIGINS: Joi.string().allow("").default(""),

    // Database (primary + optional read replica)
    DB_NAME: Joi.string().required(),
    DB_USER: Joi.string().required(),
    DB_PASSWORD: Joi.string().allow("").required(),
    DB_HOST: Joi.string().default("localhost"),
    DB_PORT: Joi.number().port().default(5432),
    DB_REPLICA_HOST: Joi.string().allow("").default(""),
    DB_POOL_MAX: Joi.number().integer().min(1).default(10),
    DB_SSL: Joi.boolean().default(false),
    DB_SYNC: Joi.boolean().default(false), // dev convenience only; use migrations in production

    // Redis (cache, rate limit, queue). Optional: the app degrades gracefully without it.
    REDIS_URL: Joi.string().uri({ scheme: ["redis", "rediss"] }).allow("").default(""),

    // Auth
    JWT_SECRET: Joi.string().min(32).required(),
    JWT_ISSUER: Joi.string().default("venue-booker"),
    ACCESS_TOKEN_TTL: Joi.string().default("15m"),
    REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(14),

    // Stripe
    STRIPE_SECRET_KEY: Joi.string().allow("").default(""),
    STRIPE_WEBHOOK_SECRET: Joi.string().allow("").default(""),
    CHECKOUT_SUCCESS_URL: Joi.string().uri().default("http://localhost:3000/payment/success"),
    CHECKOUT_CANCEL_URL: Joi.string().uri().default("http://localhost:3000/payment/cancel"),

    // Booking
    BOOKING_HOLD_MINUTES: Joi.number().integer().min(1).default(15),

    // Email
    EMAIL_USER: Joi.string().allow("").default(""),
    EMAIL_PASS: Joi.string().allow("").default(""),

    // Observability
    METRICS_TOKEN: Joi.string().allow("").default(""),
    OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().allow("").default(""),
}).unknown(true)

const { value, error } = schema.validate(raw, { abortEarly: false })
if (error) {
    // Fail fast at boot: a misconfigured instance must never receive traffic.
    console.error("Invalid environment configuration:\n" + error.details.map((d) => ` - ${d.message}`).join("\n"))
    process.exit(1)
}

export const env = {
    nodeEnv: value.NODE_ENV as string,
    isProd: value.NODE_ENV === "production",
    isTest: value.NODE_ENV === "test",
    port: value.PORT as number,
    logLevel: value.LOG_LEVEL as string,
    trustProxy: value.TRUST_PROXY as number,
    corsOrigins: (value.CORS_ORIGINS as string).split(",").map((s) => s.trim()).filter(Boolean),
    db: {
        name: value.DB_NAME as string,
        user: value.DB_USER as string,
        password: value.DB_PASSWORD as string,
        host: value.DB_HOST as string,
        port: value.DB_PORT as number,
        replicaHost: value.DB_REPLICA_HOST as string,
        poolMax: value.DB_POOL_MAX as number,
        ssl: value.DB_SSL as boolean,
        sync: value.DB_SYNC as boolean,
    },
    redisUrl: value.REDIS_URL as string,
    jwt: {
        secret: value.JWT_SECRET as string,
        issuer: value.JWT_ISSUER as string,
        accessTtl: value.ACCESS_TOKEN_TTL as string,
        refreshTtlDays: value.REFRESH_TOKEN_TTL_DAYS as number,
    },
    stripe: {
        secretKey: value.STRIPE_SECRET_KEY as string,
        webhookSecret: value.STRIPE_WEBHOOK_SECRET as string,
        successUrl: value.CHECKOUT_SUCCESS_URL as string,
        cancelUrl: value.CHECKOUT_CANCEL_URL as string,
    },
    bookingHoldMinutes: value.BOOKING_HOLD_MINUTES as number,
    email: { user: value.EMAIL_USER as string, pass: value.EMAIL_PASS as string },
    metricsToken: value.METRICS_TOKEN as string,
    otelEndpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT as string,
}
