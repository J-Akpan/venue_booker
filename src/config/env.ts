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
    FRONTEND_URL: Joi.string().uri({ scheme: ["http", "https"] }).allow("").default(""),
    CORS_ORIGINS: Joi.string().allow("").default(""),
    APP_PUBLIC_URL: Joi.string().uri().default("http://localhost:4000"),

    // Database (primary + optional read replica)
    DB_NAME: Joi.string().required(),
    DB_USER: Joi.string().required(),
    DB_PASSWORD: Joi.string().allow("").required(),
    DB_HOST: Joi.string().default("localhost"),
    DB_PORT: Joi.number().port().default(5432),
    DB_REPLICA_HOST: Joi.string().allow("").default(""),
    DB_POOL_MAX: Joi.number().integer().min(1).default(3),
    DB_SSL: Joi.boolean().default(process.env.NODE_ENV === "production"),
    DB_SSL_CA: Joi.string().allow("").default(""),
    // Creates missing tables on boot. On by default outside production; in production run `npm run db:init` or set it explicitly.
    DB_SYNC: Joi.boolean().default(process.env.NODE_ENV !== "production"),

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
    STRIPE_CONNECT_ENABLED: Joi.boolean().default(false),
    STRIPE_CONNECT_COUNTRY: Joi.string().length(2).uppercase().default("NG"),
    PLATFORM_FEE_BPS: Joi.number().integer().min(0).max(10000).default(0),
    STRIPE_CONNECT_RETURN_URL: Joi.string().uri().default("http://localhost:3000/owner/payouts?setup=complete"),
    STRIPE_CONNECT_REFRESH_URL: Joi.string().uri().default("http://localhost:3000/owner/payouts?setup=refresh"),

    // Booking
    BOOKING_HOLD_MINUTES: Joi.number().integer().min(1).default(15),
    BOOKING_REQUEST_HOLD_HOURS: Joi.number().integer().min(1).max(72).default(12),

    // Email
    EMAIL_USER: Joi.string().allow("").default(""),
    EMAIL_PASS: Joi.string().allow("").default(""),
    SMTP_HOST: Joi.string().default("smtp.gmail.com"),
    SMTP_PORT: Joi.number().port().default(587),
    SMTP_SECURE: Joi.boolean().default(false),
    EMAIL_FROM: Joi.string().allow("").default(""),

    // Optional signed direct-to-Cloudinary image uploads.
    CLOUDINARY_CLOUD_NAME: Joi.string().allow("").default(""),
    CLOUDINARY_API_KEY: Joi.string().allow("").default(""),
    CLOUDINARY_API_SECRET: Joi.string().allow("").default(""),
    CLOUDINARY_UPLOAD_PRESET: Joi.string().allow("").default(""),

    // Optional WhatsApp Cloud API template notifications.
    WHATSAPP_GRAPH_API_VERSION: Joi.string().pattern(/^v\d+\.\d+$/).allow("").default(""),
    WHATSAPP_PHONE_NUMBER_ID: Joi.string().allow("").default(""),
    WHATSAPP_ACCESS_TOKEN: Joi.string().allow("").default(""),
    WHATSAPP_BOOKING_TEMPLATE: Joi.string().allow("").default(""),
    WHATSAPP_TEMPLATE_LOCALE: Joi.string().default("en"),

    // Observability
    METRICS_TOKEN: Joi.when("NODE_ENV", {
        is: "production",
        then: Joi.string().min(32).required(),
        otherwise: Joi.string().allow("").default(""),
    }),
    OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().allow("").default(""),
}).custom((value, helpers) => {
    const cloudinary = [value.CLOUDINARY_CLOUD_NAME, value.CLOUDINARY_API_KEY, value.CLOUDINARY_API_SECRET, value.CLOUDINARY_UPLOAD_PRESET]
    if (cloudinary.some(Boolean) && !cloudinary.every(Boolean)) return helpers.error("any.invalid", { setting: "Cloudinary credentials and a restricted upload preset must be provided together" })
    const whatsapp = [value.WHATSAPP_GRAPH_API_VERSION, value.WHATSAPP_PHONE_NUMBER_ID, value.WHATSAPP_ACCESS_TOKEN, value.WHATSAPP_BOOKING_TEMPLATE]
    if (whatsapp.some(Boolean) && !whatsapp.every(Boolean)) return helpers.error("any.invalid", { setting: "WhatsApp settings must be provided together" })
    if (Boolean(value.EMAIL_USER) !== Boolean(value.EMAIL_PASS)) return helpers.error("any.invalid", { setting: "EMAIL_USER and EMAIL_PASS must be provided together" })
    if (value.STRIPE_CONNECT_ENABLED && !value.STRIPE_SECRET_KEY) return helpers.error("any.invalid", { setting: "STRIPE_SECRET_KEY is required when Stripe Connect is enabled" })
    return value
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
    corsOrigins: [...new Set([
        ...(value.FRONTEND_URL ? [new URL(value.FRONTEND_URL as string).origin] : []),
        ...(value.CORS_ORIGINS as string).split(",").map((s) => s.trim()).filter(Boolean),
    ])],
    publicBaseUrl: (value.APP_PUBLIC_URL as string).replace(/\/$/, ""),
    db: {
        name: value.DB_NAME as string,
        user: value.DB_USER as string,
        password: value.DB_PASSWORD as string,
        host: value.DB_HOST as string,
        port: value.DB_PORT as number,
        replicaHost: value.DB_REPLICA_HOST as string,
        poolMax: value.DB_POOL_MAX as number,
        ssl: value.DB_SSL as boolean,
        sslCa: value.DB_SSL_CA as string,
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
        connectEnabled: value.STRIPE_CONNECT_ENABLED as boolean,
        connectCountry: value.STRIPE_CONNECT_COUNTRY as string,
        platformFeeBps: value.PLATFORM_FEE_BPS as number,
        connectReturnUrl: value.STRIPE_CONNECT_RETURN_URL as string,
        connectRefreshUrl: value.STRIPE_CONNECT_REFRESH_URL as string,
    },
    bookingHoldMinutes: value.BOOKING_HOLD_MINUTES as number,
    bookingRequestHoldHours: value.BOOKING_REQUEST_HOLD_HOURS as number,
    email: {
        user: value.EMAIL_USER as string,
        pass: value.EMAIL_PASS as string,
        smtpHost: value.SMTP_HOST as string,
        smtpPort: value.SMTP_PORT as number,
        smtpSecure: value.SMTP_SECURE as boolean,
        from: value.EMAIL_FROM as string,
    },
    cloudinary: {
        cloudName: value.CLOUDINARY_CLOUD_NAME as string,
        apiKey: value.CLOUDINARY_API_KEY as string,
        apiSecret: value.CLOUDINARY_API_SECRET as string,
        uploadPreset: value.CLOUDINARY_UPLOAD_PRESET as string,
    },
    whatsapp: {
        graphApiVersion: value.WHATSAPP_GRAPH_API_VERSION as string,
        phoneNumberId: value.WHATSAPP_PHONE_NUMBER_ID as string,
        accessToken: value.WHATSAPP_ACCESS_TOKEN as string,
        bookingTemplate: value.WHATSAPP_BOOKING_TEMPLATE as string,
        locale: value.WHATSAPP_TEMPLATE_LOCALE as string,
    },
    metricsToken: value.METRICS_TOKEN as string,
    otelEndpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT as string,
}
