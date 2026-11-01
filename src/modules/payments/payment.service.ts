import Stripe from "stripe"
import { sequelize } from "../../config/database"
import { env } from "../../config/env"
import { badRequest, conflict, notFound, unavailable } from "../../shared/errors"
import { logger } from "../../shared/logger"
import { businessEvents } from "../../shared/metrics"
import { enqueue, registerJob } from "../../shared/queue"
import { subscribe } from "../../shared/events"
import { Booking, confirmBooking } from "../bookings"
import { getVenueSummaries } from "../venues"
import { getContact } from "../users"
import { Payment } from "./payment.model"
import { shouldRefundPaidPayment } from "./payment.logic"
import { createAccountLink, createCheckoutSession, createConnectedAccount, createRefund, retrieveConnectedAccount, stripe } from "./stripe"
import { UniqueConstraintError } from "sequelize"
import { VenuePayoutAccount, VenueSettlement } from "./payout.model"
import { Venue } from "../venues/venue.model"

const REFUND_JOB = "payments.refund"
const STRIPE_MIN_SESSION_MINUTES = 30
const REFUND_RECOVERY_LOCK_ID = 7_426_003
let refundRecoveryRunning = false

interface RefundRecoveryCandidate {
    paymentId: string
    amount: string
    refundedAmount: string
    bookingStatus: string
    paidAt: Date | null
    cancelledAt: Date | null
    cancellationRefundPercent: number
    confirmedPaymentId: string | null
}

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
                    destinationAccountId: null,
                    platformFeeAmount: "0.00",
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
    let destinationAccount: string | undefined
    if (env.stripe.connectEnabled) {
        const venue = await Venue.findByPk(booking.venueId, { attributes: ["ownerId"], useMaster: true })
        const account = venue ? await VenuePayoutAccount.findOne({ where: { ownerId: venue.ownerId }, useMaster: true }) : null
        if (!account || !account.detailsSubmitted || !account.transfersEnabled || !account.payoutsEnabled) {
            throw conflict("This venue is not ready to receive payments yet")
        }
        destinationAccount = account.stripeAccountId
    }
    const grossCents = Math.round(Number(booking.totalPrice) * 100)
    const applicationFee = Math.round(grossCents * env.stripe.platformFeeBps / 10_000)
    await payment.update({
        destinationAccountId: destinationAccount ?? null,
        platformFeeAmount: destinationAccount ? (applicationFee / 100).toFixed(2) : "0.00",
    })

    try {
        const session = await createCheckoutSession(
            {
                mode: "payment",
                // Let Stripe Checkout dynamically show payment methods enabled for this account,
                // currency and customer location (including compatible local methods).
                ...(contact ? { customer_email: contact.email } : {}),
                client_reference_id: payment.paymentId,
                metadata: { paymentId: payment.paymentId, bookingId },
                ...(destinationAccount ? {
                    payment_intent_data: {
                        transfer_data: { destination: destinationAccount },
                        ...(applicationFee > 0 ? { application_fee_amount: applicationFee } : {}),
                    },
                } : {}),
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
        refundedAmount: Number(p.refundedAmount),
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
        case "checkout.session.async_payment_succeeded": {
            const session = event.data.object as Stripe.Checkout.Session
            return onPaid(session)
        }
        case "checkout.session.async_payment_failed": {
            const session = event.data.object as Stripe.Checkout.Session
            return onExpired(session)
        }
        case "account.updated": {
            const account = event.data.object as Stripe.Account
            const payoutAccount = await VenuePayoutAccount.findOne({ where: { stripeAccountId: account.id }, useMaster: true })
            if (payoutAccount) await payoutAccount.update({
                detailsSubmitted: account.details_submitted,
                chargesEnabled: account.charges_enabled,
                transfersEnabled: account.capabilities?.transfers === "active",
                payoutsEnabled: account.payouts_enabled,
            })
            return
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
    let destinationAccountId: string | null = null
    let platformFeeAmount = "0.00"
    await sequelize.transaction(async (transaction) => {
        // Serialize paid events with checkout creation and cancellation for this booking.
        const booking = await Booking.findByPk(candidate.bookingId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!booking) throw new Error(`Payment ${candidate.paymentId} references a missing booking`)
        const payment = await Payment.findByPk(candidate.paymentId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!payment) throw new Error(`Payment ${candidate.paymentId} disappeared while processing its webhook`)

        destinationAccountId = payment.destinationAccountId
        platformFeeAmount = payment.platformFeeAmount
        if (payment.stripeSessionId && payment.stripeSessionId !== session.id) {
            // A second paid session carrying this payment's metadata must not be left charged.
            // Stripe's idempotency key makes retries of this compensation safe.
            unexpectedSession = true
            return
        }
        if (payment.status === "Refunded" || payment.status === "PartiallyRefunded") {
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
        await createRefund(paymentIntentId, `refund:orphan-session:${session.id}`, undefined, Boolean(destinationAccountId), Number(platformFeeAmount) > 0)
        logger.warn({ paymentId: candidate.paymentId, sessionId: session.id }, "refunded an unexpected duplicate checkout session")
        return
    }
    if (alreadyRefunded) return
    if (newlyCompleted) {
        businessEvents.inc({ event: "payment_completed" })
    }
    if (destinationAccountId) await recordSettlement(candidate.paymentId, candidate.bookingId, paymentIntentId)

    // Always (re)run: if a previous attempt crashed between the two steps this heals it.
    const confirmation = await confirmBooking(candidate.bookingId, candidate.paymentId)
    if (shouldRefundPaidPayment(confirmation.outcome, newlyCompleted, confirmation.confirmedPaymentId, candidate.paymentId)) {
        // Compensation: the customer paid but the slot is no longer ours (hold lapsed and it was re-booked, or it was cancelled).
        logger.warn({ paymentId: candidate.paymentId, bookingId: candidate.bookingId }, "paid for a slot that is gone, refunding")
        await enqueue(REFUND_JOB, { paymentId: candidate.paymentId, refundPercent: 100 }, { jobId: `refund-${candidate.paymentId}-100` })
    }
}

// ---- refunds (saga compensation) ------------------------------------------------------------

const refundPayment = async ({ paymentId, refundPercent = 100 }: { paymentId: string; refundPercent?: number }) => {
    const payment = await Payment.findByPk(paymentId, { useMaster: true })
    if (!payment || !["Completed", "PartiallyRefunded"].includes(payment.status) || !payment.stripePaymentIntentId) return
    const originalCents = Math.round(Number(payment.amount) * 100)
    const targetRefundCents = Math.round(originalCents * Math.max(0, Math.min(100, refundPercent)) / 100)
    const alreadyRefundedCents = Math.round(Number(payment.refundedAmount) * 100)
    const refundCents = Math.max(0, targetRefundCents - alreadyRefundedCents)
    if (refundCents === 0) return

    const settlement = await VenueSettlement.findOne({ where: { paymentId }, useMaster: true })
    await createRefund(payment.stripePaymentIntentId, `refund:${payment.paymentId}:target:${targetRefundCents}`, refundCents, Boolean(settlement), Number(payment.platformFeeAmount) > 0)
    const totalRefundedCents = alreadyRefundedCents + refundCents
    const fullyRefunded = totalRefundedCents >= originalCents
    await payment.update({
        status: fullyRefunded ? "Refunded" : "PartiallyRefunded",
        refundedAmount: (totalRefundedCents / 100).toFixed(2),
        refundedAt: fullyRefunded ? new Date() : null,
    })
    if (settlement) await settlement.update({
        refundedAmount: (totalRefundedCents / 100).toFixed(2),
        status: fullyRefunded ? "refunded" : "partially_refunded",
    })
    businessEvents.inc({ event: fullyRefunded ? "payment_refunded" : "payment_partially_refunded" })
}

const recordSettlement = async (paymentId: string, bookingId: string, paymentIntentId: string) => {
    const payment = await Payment.findByPk(paymentId, { attributes: ["amount", "platformFeeAmount"], useMaster: true })
    if (!payment) throw new Error(`Payment ${paymentId} disappeared while creating its settlement record`)
    const booking = await Booking.findByPk(bookingId, { attributes: ["venueId", "totalPrice", "currency"], useMaster: true })
    if (!booking) throw new Error(`Payment ${paymentId} references a missing booking`)
    const venue = await Venue.findByPk(booking.venueId, { attributes: ["ownerId"], useMaster: true })
    if (!venue) throw new Error(`Booking ${bookingId} references a missing venue`)
    const grossCents = Math.round(Number(payment.amount) * 100)
    const platformFeeCents = Math.round(Number(payment.platformFeeAmount) * 100)
    await VenueSettlement.findOrCreate({
        where: { paymentId },
        defaults: {
            paymentId,
            bookingId,
            venueId: booking.venueId,
            ownerId: venue.ownerId,
            grossAmount: (grossCents / 100).toFixed(2),
            platformFeeAmount: (platformFeeCents / 100).toFixed(2),
            venueAmount: ((grossCents - platformFeeCents) / 100).toFixed(2),
            refundedAmount: "0.00",
            currency: booking.currency,
            status: "routed",
            stripePaymentIntentId: paymentIntentId,
        },
    })
}

export const createConnectOnboardingLink = async (ownerId: string) => {
    if (!env.stripe.connectEnabled) throw unavailable("Venue payouts are not configured")
    if (!(await Venue.findOne({ where: { ownerId }, attributes: ["venueId"], useMaster: true }))) throw notFound("Venue")
    let account = await VenuePayoutAccount.findOne({ where: { ownerId }, useMaster: true })
    if (!account) {
        const stripeAccount = await createConnectedAccount({
            type: "express",
            country: env.stripe.connectCountry,
            capabilities: { transfers: { requested: true } },
            metadata: { venueBookerOwnerId: ownerId },
        }, `connect-owner-${ownerId}`)
        try {
            account = await VenuePayoutAccount.create({
                ownerId,
                stripeAccountId: stripeAccount.id,
                detailsSubmitted: stripeAccount.details_submitted,
                chargesEnabled: stripeAccount.charges_enabled,
                transfersEnabled: stripeAccount.capabilities?.transfers === "active",
                payoutsEnabled: stripeAccount.payouts_enabled,
            })
        } catch (err) {
            if (!(err instanceof UniqueConstraintError)) throw err
            account = await VenuePayoutAccount.findOne({ where: { ownerId }, useMaster: true })
            if (!account) throw err
        }
    }
    const link = await createAccountLink(account.stripeAccountId, env.stripe.connectRefreshUrl, env.stripe.connectReturnUrl)
    return { url: link.url, status: payoutStatus(account) }
}

const payoutStatus = (account: VenuePayoutAccount) => ({
    detailsSubmitted: account.detailsSubmitted,
    chargesEnabled: account.chargesEnabled,
    transfersEnabled: account.transfersEnabled,
    payoutsEnabled: account.payoutsEnabled,
    ready: account.detailsSubmitted && account.transfersEnabled && account.payoutsEnabled,
})

export const getConnectStatus = async (ownerId: string) => {
    if (!env.stripe.connectEnabled) return { enabled: false, account: null }
    const account = await VenuePayoutAccount.findOne({ where: { ownerId }, useMaster: true })
    if (account) {
        const stripeAccount = await retrieveConnectedAccount(account.stripeAccountId)
        await account.update({
            detailsSubmitted: stripeAccount.details_submitted,
            chargesEnabled: stripeAccount.charges_enabled,
            transfersEnabled: stripeAccount.capabilities?.transfers === "active",
            payoutsEnabled: stripeAccount.payouts_enabled,
        })
    }
    return { enabled: true, account: account ? payoutStatus(account) : null }
}

export const getOwnerSettlements = async (ownerId: string, page: { page: number; limit: number }, venueId?: string) => {
    const where = { ownerId, ...(venueId ? { venueId } : {}) }
    const { rows, count } = await VenueSettlement.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit: page.limit,
        offset: (page.page - 1) * page.limit,
        useMaster: true,
    })
    return { rows: rows.map((row) => ({ ...row.toJSON(), grossAmount: Number(row.grossAmount), platformFeeAmount: Number(row.platformFeeAmount), venueAmount: Number(row.venueAmount), refundedAmount: Number(row.refundedAmount) })), total: count }
}

export const initPayments = () => {
    registerJob(REFUND_JOB, refundPayment)

    // Booking cancelled after payment => refund, asynchronously and with retries.
    subscribe("booking.cancelled", async ({ bookingId, refundPercent }) => {
        if (refundPercent <= 0) return
        const payments = await Payment.findAll({ where: { bookingId, status: "Completed" }, useMaster: true })
        await Promise.all(
            payments.map((payment) => enqueue(REFUND_JOB, { paymentId: payment.paymentId, refundPercent }, { jobId: `refund-${payment.paymentId}-${refundPercent}` })),
        )
    })
}

/** Repair missed compensation jobs after a crash, queue outage, or failed inline delivery. */
export const recoverOutstandingRefunds = async () => {
    if (refundRecoveryRunning) return 0
    refundRecoveryRunning = true
    let lockConn: any
    let lockAcquired = false
    try {
        lockConn = await sequelize.connectionManager.getConnection({ type: "write" })
        const lockResult = await lockConn.query(`SELECT pg_try_advisory_lock(${REFUND_RECOVERY_LOCK_ID}) AS locked`)
        lockAcquired = Boolean(lockResult.rows?.[0]?.locked)
        if (!lockAcquired) return 0

        const candidateResult = await lockConn.query(`
            SELECT p."paymentId", p.amount, p."refundedAmount", p."paidAt",
                   b.status AS "bookingStatus", b."cancelledAt", b."cancellationRefundPercent", b."confirmedPaymentId"
            FROM payments p
            JOIN bookings b ON b."bookingId" = p."bookingId"
            WHERE p.status IN ('Completed', 'PartiallyRefunded')
              AND (b.status IN ('cancelled', 'declined', 'expired')
                   OR (b.status = 'confirmed' AND b."confirmedPaymentId" IS NOT NULL AND b."confirmedPaymentId" <> p."paymentId"))
            ORDER BY p."updatedAt" ASC
            LIMIT 500
        `)
        const candidates = candidateResult.rows as RefundRecoveryCandidate[]

        let queued = 0
        for (const row of candidates) {
            const lostConfirmedSlot = row.bookingStatus === "confirmed"
            const paidAfterCancellation = row.bookingStatus === "cancelled" && row.paidAt && row.cancelledAt && row.paidAt > row.cancelledAt
            const refundPercent = lostConfirmedSlot || paidAfterCancellation || row.bookingStatus === "declined" || row.bookingStatus === "expired"
                ? 100
                : row.cancellationRefundPercent
            const amountCents = Math.round(Number(row.amount) * 100)
            const targetCents = Math.round(amountCents * Math.max(0, Math.min(100, refundPercent)) / 100)
            if (targetCents <= Math.round(Number(row.refundedAmount) * 100)) continue
            await enqueue(REFUND_JOB, { paymentId: row.paymentId, refundPercent }, { jobId: `refund-${row.paymentId}-${refundPercent}` })
            queued++
        }
        return queued
    } finally {
        if (lockConn) {
            if (lockAcquired) {
                await lockConn.query(`SELECT pg_advisory_unlock(${REFUND_RECOVERY_LOCK_ID})`).catch(() => {})
            }
            sequelize.connectionManager.releaseConnection(lockConn)
        }
        refundRecoveryRunning = false
    }
}
