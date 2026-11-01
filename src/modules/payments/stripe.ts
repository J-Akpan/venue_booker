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
    (paymentIntent: string, idempotencyKey: string, amount?: number, reverseTransfer = false, refundApplicationFee = reverseTransfer) => stripe().refunds.create({
        payment_intent: paymentIntent,
        ...(amount !== undefined ? { amount } : {}),
        ...(reverseTransfer ? { reverse_transfer: true } : {}),
        ...(reverseTransfer && refundApplicationFee ? { refund_application_fee: true } : {}),
    }, { idempotencyKey }),
    { isClientError },
)

export const createConnectedAccount = withBreaker(
    "stripe",
    (params: Stripe.AccountCreateParams, idempotencyKey: string) => stripe().accounts.create(params, { idempotencyKey }),
    { isClientError },
)

export const createAccountLink = withBreaker(
    "stripe",
    (account: string, refreshUrl: string, returnUrl: string) => stripe().accountLinks.create({ account, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" }),
    { isClientError },
)

export const retrieveConnectedAccount = withBreaker("stripe", (account: string) => stripe().accounts.retrieve(account), { isClientError })
