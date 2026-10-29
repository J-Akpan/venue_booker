import Stripe from "stripe"
import { sequelize } from "../../config/database"
import { env } from "../../config/env"
import { badRequest, conflict, notFound } from "../../shared/errors"
import { logger } from "../../shared/logger"
import { businessEvents } from "../../shared/metrics"
import { enqueue, registerJob } from "../../shared/queue"
import { subscribe } from "../../shared/events"
import { Booking, confirmBooking } from "../bookings"
import { getVenueSummaries } from "../venues"
import { getContact } from "../users"
import { Payment } from "./payment.model"
import { shouldRefundPaidPayment } from "./payment.logic"
import { createCheckoutSession, createRefund, stripe } from "./stripe"
import { UniqueConstraintError } from "sequelize"

const REFUND_JOB = "payments.refund"
const STRIPE_MIN_SESSION_MINUTES = 30

/**
 * Start paying for a PENDING booking. The amount comes from the booking row (itself computed
 * server-side), never from the client. Returns a Stripe-hosted checkout URL.
 */
export const startCheckout = async (userId: string, bookingId: string) => {
    let checkout: { booking: Booking; payment: Payment }
    try {
        checkout = await sequelize.transaction(async (transaction) => {
            // This lock serializes checkout creation with other checkouts and paid webhooks.
            const booking = await Booking.findByPk(bookingId, { transaction, lock: transaction.LOCK.UPDATE })
            if (!booking || booking.userId !== userId) throw notFound("Booking")
            if (booking.status !== "pending") throw conflict(`Booking is ${booking.status} and can't be paid`)
            if (booking.expiresAt && booking.expiresAt < new Date()) throw conflict("The hold on this booking has expired, please book again")

            const completed = await Payment.findOne({ where: { bookingId, status: "Completed" }, transaction, lock: transaction.LOCK.UPDATE })
            if (completed) throw conflict("This booking already has a completed payment")

            // Re-use a pending payment row, including one whose Stripe call is still in progress.
            const open = await Payment.findOne({ where: { bookingId, status: "Pending" }, transaction, lock: transaction.LOCK.UPDATE })
            if (open) return { booking, payment: open }

            const payment = await Payment.create(
                {
                    bookingId,
                    userId,
                    stripeSessionId: null,
                    stripePaymentIntentId: null,
                    checkoutUrl: null,
                    amount: booking.totalPrice,
                    currency: booking.currency,
                    paidAt: null,
                    refundedAt: null,
                },
                { transaction },
            )
            return { booking, payment }
        })
    } catch (err) {
        // Also handle requests from an older replica that won the partial unique-index race.
        if (!(err instanceof UniqueConstraintError)) throw err
        const booking = await Booking.findByPk(bookingId, { useMaster: true })
        const payment = await Payment.findOne({ where: { bookingId, status: "Pending" }, useMaster: true })
        if (!booking || booking.userId !== userId) throw notFound("Booking")
        if (booking.status !== "pending") throw conflict(`Booking is ${booking.status} and can't be paid`)
        if (booking.expiresAt && booking.expiresAt < new Date()) throw conflict("The hold on this booking has expired, please book again")
        const completed = await Payment.findOne({ where: { bookingId, status: "Completed" }, useMaster: true })
        if (completed) throw conflict("This booking already has a completed payment")
        if (!payment) throw err
        checkout = { booking, payment }
    }

    const { booking, payment } = checkout
    if (payment.checkoutUrl) return { paymentId: payment.paymentId, url: payment.checkoutUrl }

    const [contact, venues] = await Promise.all([getContact(userId), getVenueSummaries([booking.venueId])])
    const venueName = venues.get(booking.venueId)?.name ?? "Venue"

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
                            unit_amount: Math.round(Number(booking.totalPrice) * 100),
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
        // A concurrent retry or webhook may already have associated a live session with this row.
        await Payment.update(
            { status: "Failed" },
            { where: { paymentId: payment.paymentId, status: "Pending", stripeSessionId: null } },
        ).catch(() => {})
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
            return onExpired(session)
        }
        default:
            logger.debug({ type: event.type }, "ignoring stripe event")
    }
}

const findPaymentForSession = async (session: Stripe.Checkout.Session) => {
    const paymentId = session.metadata?.paymentId
    const bySession = await Payment.findOne({ where: { stripeSessionId: session.id }, useMaster: true })
    if (bySession && paymentId && bySession.paymentId !== paymentId) {
        throw new Error(`Stripe session ${session.id} metadata does not match its payment record`)
    }
    if (bySession) return bySession
    if (paymentId) return Payment.findByPk(paymentId, { useMaster: true })
    return null // A valid Stripe event for another checkout in the same Stripe account.
}

const onExpired = async (session: Stripe.Checkout.Session) => {
    const candidate = await findPaymentForSession(session)
    if (!candidate) return

    await sequelize.transaction(async (transaction) => {
        // Keep lock ordering consistent with checkout creation and paid-event handling.
        const booking = await Booking.findByPk(candidate.bookingId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!booking) return
        const payment = await Payment.findByPk(candidate.paymentId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!payment || (payment.stripeSessionId && payment.stripeSessionId !== session.id) || payment.status !== "Pending") return
        await payment.update({ stripeSessionId: session.id, status: "Failed" }, { transaction })
    })
}

const onPaid = async (session: Stripe.Checkout.Session) => {
    const candidate = await findPaymentForSession(session)
    if (!candidate) {
        if (session.metadata?.paymentId) {
            // The payment row may be temporarily unavailable after a partial failure. A 500
            // makes Stripe retry instead of acknowledging and dropping the paid event.
            throw new Error(`Paid Stripe session ${session.id} has no matching payment record`)
        }
        logger.warn({ sessionId: session.id }, "ignoring paid session without Venue Booker metadata")
        return
    }

    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null)
    if (!paymentIntentId) throw new Error(`Paid Stripe session ${session.id} has no payment intent`)

    let newlyCompleted = false
    let alreadyRefunded = false
    let unexpectedSession = false
    await sequelize.transaction(async (transaction) => {
        // Serialize paid events with checkout creation and cancellation for this booking.
        const booking = await Booking.findByPk(candidate.bookingId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!booking) throw new Error(`Payment ${candidate.paymentId} references a missing booking`)
        const payment = await Payment.findByPk(candidate.paymentId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!payment) throw new Error(`Payment ${candidate.paymentId} disappeared while processing its webhook`)

        if (payment.stripeSessionId && payment.stripeSessionId !== session.id) {
            // A second paid session carrying this payment's metadata must not be left charged.
            // Stripe's idempotency key makes retries of this compensation safe.
            unexpectedSession = true
            return
        }
        if (payment.status === "Refunded") {
            alreadyRefunded = true
            return
        }
        if (payment.status === "Pending" || payment.status === "Failed") {
            await payment.update(
                {
                    stripeSessionId: session.id,
                    status: "Completed",
                    paidAt: new Date(),
                    stripePaymentIntentId: paymentIntentId,
                },
                { transaction },
            )
            newlyCompleted = true
        } else if (!payment.stripeSessionId) {
            // Recover the crash window after Stripe created the session but before its ID was saved.
            await payment.update({ stripeSessionId: session.id, stripePaymentIntentId: paymentIntentId }, { transaction })
        }
    })

    if (unexpectedSession) {
        await createRefund(paymentIntentId, `refund:orphan-session:${session.id}`)
        logger.warn({ paymentId: candidate.paymentId, sessionId: session.id }, "refunded an unexpected duplicate checkout session")
        return
    }
    if (alreadyRefunded) return
    if (newlyCompleted) {
        businessEvents.inc({ event: "payment_completed" })
    }

    // Always (re)run: if a previous attempt crashed between the two steps this heals it.
    const confirmation = await confirmBooking(candidate.bookingId, candidate.paymentId)
    if (shouldRefundPaidPayment(confirmation.outcome, newlyCompleted, confirmation.confirmedPaymentId, candidate.paymentId)) {
        // Compensation: the customer paid but the slot is no longer ours (hold lapsed and it was re-booked, or it was cancelled).
        logger.warn({ paymentId: candidate.paymentId, bookingId: candidate.bookingId }, "paid for a slot that is gone, refunding")
        await enqueue(REFUND_JOB, { paymentId: candidate.paymentId }, { jobId: `refund-${candidate.paymentId}` })
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
        const payments = await Payment.findAll({ where: { bookingId, status: "Completed" }, useMaster: true })
        await Promise.all(
            payments.map((payment) => enqueue(REFUND_JOB, { paymentId: payment.paymentId }, { jobId: `refund-${payment.paymentId}` })),
        )
    })
}
