import { Op, UniqueConstraintError, ExclusionConstraintError, Transaction } from "sequelize"
import { env } from "../../config/env"
import { sequelize } from "../../config/database"
import { businessEvents } from "../../shared/metrics"
import { conflict, forbidden, notFound, badRequest } from "../../shared/errors"
import { publish } from "../../shared/events"
import { PageQuery, toOffset } from "../../shared/pagination"
import { isStaff, type AuthUser } from "../../shared/middleware/auth"
import { getVenueForBooking, getVenueSummaries, isVenueOwner } from "../venues"
import { assertValidSlot, calculateTotal } from "./booking.pricing"
import { Booking } from "./booking.model"

const present = (b: Booking) => {
    const { confirmedPaymentId: _confirmedPaymentId, ...data } = b.toJSON()
    return { ...data, totalPrice: Number(b.totalPrice) }
}

/**
 * Create a PENDING booking that holds the slot for BOOKING_HOLD_MINUTES while the customer pays.
 * (Saga step 1; step 2 is the payment, whose success confirms the booking and whose failure or
 * timeout releases the slot via the expiry sweeper below.)
 */
export const createBooking = async (
    userId: string,
    input: { venueId: string; startsAt: Date; endsAt: Date },
    idempotencyKey: string | null,
) => {
    // Idempotent retry: same key => same booking, no duplicate and no error.
    if (idempotencyKey) {
        const existing = await Booking.findOne({ where: { userId, idempotencyKey }, useMaster: true })
        if (existing) return { booking: present(existing), replayed: true }
    }

    assertValidSlot(input.startsAt, input.endsAt)
    const venue = await getVenueForBooking(input.venueId)
    const totalPrice = calculateTotal(input.startsAt, input.endsAt, venue.pricePerHour)

    try {
        const booking = await sequelize.transaction(async (transaction) => {
            // Free any lapsed unpaid holds on this venue first, so they don't block a legitimate booking.
            await Booking.update(
                { status: "expired" },
                { where: { venueId: input.venueId, status: "pending", expiresAt: { [Op.lt]: new Date() } }, transaction },
            )
            // The EXCLUDE constraint rejects overlaps atomically, so two concurrent requests can't both win.
            return Booking.create(
                {
                    userId,
                    venueId: input.venueId,
                    startsAt: input.startsAt,
                    endsAt: input.endsAt,
                    totalPrice: totalPrice.toFixed(2),
                    currency: venue.currency,
                    status: "pending",
                    expiresAt: new Date(Date.now() + env.bookingHoldMinutes * 60_000),
                    idempotencyKey,
                    cancelledAt: null,
                },
                { transaction },
            )
        })
        businessEvents.inc({ event: "booking_created" })
        publish("booking.created", { bookingId: booking.bookingId, userId, venueId: booking.venueId })
        return { booking: present(booking), replayed: false }
    } catch (err) {
        if (err instanceof ExclusionConstraintError) throw conflict("That time slot is already booked")
        if (err instanceof UniqueConstraintError && idempotencyKey) {
            // Two identical requests raced: the loser returns the winner's booking.
            const existing = await Booking.findOne({ where: { userId, idempotencyKey }, useMaster: true })
            if (existing) return { booking: present(existing), replayed: true }
        }
        throw err
    }
}

const withVenues = async (bookings: Booking[]) => {
    const venues = await getVenueSummaries([...new Set(bookings.map((b) => b.venueId))])
    return bookings.map((b) => ({ ...present(b), venue: venues.get(b.venueId) ?? null }))
}

export const listUserBookings = async (userId: string, page: PageQuery) => {
    const { rows, count } = await Booking.findAndCountAll({ where: { userId }, order: [["createdAt", "DESC"]], ...toOffset(page), useMaster: true })
    return { rows: await withVenues(rows), total: count }
}

export const listVenueBookings = async (venueId: string, actor: AuthUser, page: PageQuery) => {
    if (!isStaff(actor.role) && !(await isVenueOwner(venueId, actor.userId))) throw forbidden("You do not own this venue")
    const { rows, count } = await Booking.findAndCountAll({ where: { venueId }, order: [["startsAt", "DESC"]], ...toOffset(page), useMaster: true })
    return { rows: rows.map(present), total: count }
}

export const getBooking = async (bookingId: string, actor: AuthUser) => {
    const booking = await Booking.findByPk(bookingId, { useMaster: true })
    if (!booking) throw notFound("Booking")
    if (booking.userId !== actor.userId && !isStaff(actor.role) && !(await isVenueOwner(booking.venueId, actor.userId))) {
        throw notFound("Booking") // 404, not 403: don't reveal that someone else's booking id exists
    }
    return (await withVenues([booking]))[0]!
}

export const cancelBooking = async (bookingId: string, actor: AuthUser, parentTransaction?: Transaction) => {
    const update = async (transaction: Transaction) => {
        const booking = await Booking.findByPk(bookingId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!booking) throw notFound("Booking")
        const isOwner = booking.userId === actor.userId
        if (!isOwner && !isStaff(actor.role) && !(await isVenueOwner(booking.venueId, actor.userId))) throw notFound("Booking")

        if (booking.status === "cancelled") return { booking, refund: false, changed: false } // idempotent
        if (booking.status === "expired") throw badRequest("Booking has already expired")
        if (isOwner && !isStaff(actor.role) && booking.startsAt <= new Date()) throw badRequest("Booking has already started")

        const refund = booking.status === "confirmed"
        await booking.update({ status: "cancelled", cancelledAt: new Date(), expiresAt: null }, { transaction })
        return { booking, refund, changed: true }
    }
    const result = parentTransaction ? await update(parentTransaction) : await sequelize.transaction(update)

    if (result.changed) {
        const afterCommit = () => {
            businessEvents.inc({ event: "booking_cancelled" })
            // Compensation step of the saga: the payments module listens and refunds if money was taken.
            publish("booking.cancelled", { bookingId, userId: result.booking.userId, venueId: result.booking.venueId, refund: result.refund })
        }
        if (parentTransaction) parentTransaction.afterCommit(afterCommit)
        else afterCommit()
    }
    return present(result.booking)
}

// ---- used by the payments module (via ./index) ----------------------------------------------

export const getBookingForPayment = async (bookingId: string) => {
    const b = await Booking.findByPk(bookingId, { useMaster: true })
    return b ? { ...present(b) } : null
}

export interface ConfirmResult {
    outcome: "confirmed" | "already_confirmed" | "slot_lost"
    confirmedPaymentId: string | null
}

/** Called when payment succeeds. Idempotent, so duplicate webhook deliveries are harmless. */
export const confirmBooking = async (bookingId: string, paymentId?: string): Promise<ConfirmResult> => {
    try {
        const { result, booking } = await sequelize.transaction(async (transaction) => {
            const booking = await Booking.findByPk(bookingId, { transaction, lock: transaction.LOCK.UPDATE })
            if (!booking) throw notFound("Booking")
            if (booking.status === "confirmed") {
                // Backfill a legacy confirmed booking the first time its paid webhook is replayed.
                if (!booking.confirmedPaymentId && paymentId) await booking.update({ confirmedPaymentId: paymentId }, { transaction })
                return { result: "already_confirmed" as const, booking }
            }
            if (booking.status === "cancelled") return { result: "slot_lost" as const, booking }
            // 'pending', or 'expired' where the customer paid just after the hold lapsed: try to take the slot back.
            // If someone else booked it in the meantime the EXCLUDE constraint rejects this and we report slot_lost.
            await booking.update({ status: "confirmed", expiresAt: null, confirmedPaymentId: paymentId ?? null }, { transaction })
            return { result: "confirmed" as const, booking }
        })
        if (result === "confirmed") {
            businessEvents.inc({ event: "booking_confirmed" })
            publish("booking.confirmed", { bookingId, userId: booking.userId, venueId: booking.venueId })
        }
        return { outcome: result, confirmedPaymentId: booking.confirmedPaymentId }
    } catch (err) {
        if (err instanceof ExclusionConstraintError) return { outcome: "slot_lost", confirmedPaymentId: null }
        throw err
    }
}

/** Release slots whose payment window lapsed. Safe to run on every instance: the UPDATE is idempotent. */
export const expireStaleHolds = async () => {
    const [count] = await Booking.update({ status: "expired" }, { where: { status: "pending", expiresAt: { [Op.lt]: new Date() } } })
    if (count) businessEvents.inc({ event: "booking_expired" }, count)
    return count
}
