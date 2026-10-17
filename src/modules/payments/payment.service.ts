import Stripe from "stripe"
import { env } from "../../config/env"
import { badRequest, conflict, notFound } from "../../shared/errors"
import { logger } from "../../shared/logger"
import { businessEvents } from "../../shared/metrics"
import { enqueue, registerJob } from "../../shared/queue"
import { subscribe } from "../../shared/events"
import { confirmBooking, getBookingForPayment } from "../bookings"
import { getVenueSummaries } from "../venues"
import { getContact } from "../users"
import { Payment } from "./payment.model"
import { createCheckoutSession, createRefund, stripe } from "./stripe"

const REFUND_JOB = "payments.refund"
const STRIPE_MIN_SESSION_MINUTES = 30

/**
 * Start paying for a PENDING booking. The amount comes from the booking row (itself computed
 * server-side), never from the client. Returns a Stripe-hosted checkout URL.
 */
export const startCheckout = async (userId: string, bookingId: string) => {
    const booking = await getBookingForPayment(bookingId)
    if (!booking || booking.userId !== userId) throw notFound("Booking")
    if (booking.status !== "pending") throw conflict(`Booking is ${booking.status} and can't be paid`)
    if (booking.expiresAt && booking.expiresAt < new Date()) throw conflict("The hold on this booking has expired, please book again")

    // Re-use the open checkout for this booking rather than creating a second one.
    const open = await Payment.findOne({ where: { bookingId, status: "Pending" }, order: [["createdAt", "DESC"]], useMaster: true })
    if (open?.checkoutUrl) return { paymentId: open.paymentId, url: open.checkoutUrl }

    const [contact, venues] = await Promise.all([getContact(userId), getVenueSummaries([booking.venueId])])
    const venueName = venues.get(booking.venueId)?.name ?? "Venue"

    // Record intent first so a crash after the Stripe call can't leave an untracked charge.
    const payment = await Payment.create({
        bookingId,
        userId,
        stripeSessionId: null,
        stripePaymentIntentId: null,
        checkoutUrl: null,
        amount: String(booking.totalPrice),
        currency: booking.currency,
        paidAt: null,
        refundedAt: null,
    })

    try {
        const session = await createCheckoutSession(
            {
                mode: "payment",
                payment_method_types: ["card"],
                ...(contact ? { customer_email: contact.email } : {}),
                client_reference_id: payment.paymentId,
                metadata: { paymentId: payment.paymentId, bookingId },
                expires_at: Math.floor(Date.now() / 1000) + STRIPE_MIN_SESSION_MINUTES * 60,
                success_url: env.stripe.successUrl,
                cancel_url: env.stripe.cancelUrl,
                line_items: [
                    {
                        quantity: 1,
                        price_data: {
                            currency: booking.currency.toLowerCase(),
                            unit_amount: Math.round(booking.totalPrice * 100),
                            product_data: {
                                name: `Booking: ${venueName}`,
                                description: `${booking.startsAt.toISOString()} to ${booking.endsAt.toISOString()}`,
                            },
                        },
                    },
                ],
            },
            `checkout:${payment.paymentId}`,
        )
        await payment.update({ stripeSessionId: session.id, checkoutUrl: session.url })
        return { paymentId: payment.paymentId, url: session.url }
    } catch (err) {
        await payment.update({ status: "Failed" })
        throw err
    }
}

export const getPaymentsForBooking = async (userId: string, bookingId: string) => {
    const payments = await Payment.findAll({ where: { bookingId, userId }, order: [["createdAt", "DESC"]], useMaster: true })
    return payments.map((p) => ({
        paymentId: p.paymentId,
        status: p.status,
        amount: Number(p.amount),
        currency: p.currency,
        paidAt: p.paidAt,
        refundedAt: p.refundedAt,
    }))
}

// ---- webhook (saga step 2) ------------------------------------------------------------------

export const parseWebhook = (rawBody: Buffer, signature: string | undefined): Stripe.Event => {
    if (!env.stripe.webhookSecret || !signature) throw badRequest("Webhook not configured or signature missing")
    try {
        // Verifies the HMAC signature and timestamp tolerance: only Stripe can trigger payment state changes.
        return stripe().webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret)
    } catch {
        throw badRequest("Invalid webhook signature")
    }
}

/**
 * Every branch is idempotent because Stripe delivers at-least-once and retries on any non-2xx.
 * Throwing here => 500 => Stripe retries later, which is the behaviour we want for transient failures.
 */
export const handleWebhookEvent = async (event: Stripe.Event) => {
    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session
            if (session.payment_status !== "paid") return
            return onPaid(session)
        }
        case "checkout.session.expired": {
            const session = event.data.object as Stripe.Checkout.Session
            await Payment.update({ status: "Failed" }, { where: { stripeSessionId: session.id, status: "Pending" } })
            return
        }
        default:
            logger.debug({ type: event.type }, "ignoring stripe event")
    }
}

const onPaid = async (session: Stripe.Checkout.Session) => {
    const payment = await Payment.findOne({ where: { stripeSessionId: session.id }, useMaster: true })
    if (!payment) {
        logger.error({ sessionId: session.id }, "paid session has no matching payment record")
        return
    }

    if (payment.status === "Pending" || payment.status === "Failed") {
        await payment.update({
            status: "Completed",
            paidAt: new Date(),
            stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
        })
        businessEvents.inc({ event: "payment_completed" })
    }

    // Always (re)run: if a previous attempt crashed between the two steps this heals it.
    const outcome = await confirmBooking(payment.bookingId)
    if (outcome === "slot_lost" && payment.status !== "Refunded") {
        // Compensation: the customer paid but the slot is no longer ours (hold lapsed and it was re-booked, or it was cancelled).
        logger.warn({ paymentId: payment.paymentId, bookingId: payment.bookingId }, "paid for a slot that is gone, refunding")
        await enqueue(REFUND_JOB, { paymentId: payment.paymentId }, { jobId: `refund-${payment.paymentId}` })
    }
}

// ---- refunds (saga compensation) ------------------------------------------------------------

const refundPayment = async ({ paymentId }: { paymentId: string }) => {
    const payment = await Payment.findByPk(paymentId, { useMaster: true })
    if (!payment || payment.status !== "Completed" || !payment.stripePaymentIntentId) return // already handled / nothing to refund
    await createRefund(payment.stripePaymentIntentId, `refund:${payment.paymentId}`)
    await payment.update({ status: "Refunded", refundedAt: new Date() })
    businessEvents.inc({ event: "payment_refunded" })
}

export const initPayments = () => {
    registerJob(REFUND_JOB, refundPayment)

    // Booking cancelled after payment => refund, asynchronously and with retries.
    subscribe("booking.cancelled", async ({ bookingId, refund }) => {
        if (!refund) return
        const payment = await Payment.findOne({ where: { bookingId, status: "Completed" }, useMaster: true })
        if (payment) await enqueue(REFUND_JOB, { paymentId: payment.paymentId }, { jobId: `refund-${payment.paymentId}` })
    })
}
