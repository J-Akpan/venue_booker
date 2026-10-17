import Stripe from "stripe"
import { env } from "../../config/env"
import { withBreaker } from "../../shared/circuitBreaker"
import { unavailable } from "../../shared/errors"

let client: Stripe | null = null

export const stripe = (): Stripe => {
    if (!env.stripe.secretKey) throw unavailable("Payments are not configured")
    return (client ??= new Stripe(env.stripe.secretKey, { maxNetworkRetries: 2, timeout: 7_000 }))
}

// Stripe 4xx errors are our fault (bad request, card declined...), not a sign Stripe is down,
// so they must not trip the breaker.
const isClientError = (err: unknown) => {
    const status = (err as { statusCode?: number })?.statusCode
    return status !== undefined && status >= 400 && status < 500
}

/** `idempotencyKey` makes retries (ours or the SDK's) safe: Stripe returns the original result instead of charging twice. */
export const createCheckoutSession = withBreaker(
    "stripe",
    (params: Stripe.Checkout.SessionCreateParams, idempotencyKey: string) => stripe().checkout.sessions.create(params, { idempotencyKey }),
    { isClientError },
)

export const createRefund = withBreaker(
    "stripe",
    (paymentIntent: string, idempotencyKey: string) => stripe().refunds.create({ payment_intent: paymentIntent }, { idempotencyKey }),
    { isClientError },
)
