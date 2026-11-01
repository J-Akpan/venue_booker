import { Op, UniqueConstraintError, ExclusionConstraintError, QueryTypes, Transaction } from "sequelize"
import { env } from "../../config/env"
import { sequelize } from "../../config/database"
import { businessEvents } from "../../shared/metrics"
import { conflict, forbidden, notFound, badRequest } from "../../shared/errors"
import { publish } from "../../shared/events"
import { PageQuery, toOffset } from "../../shared/pagination"
import { isStaff, type AuthUser } from "../../shared/middleware/auth"
import { getVenueForBooking, getVenueSummaries, isVenueOwner, isValidVenueCalendarToken } from "../venues"
import { assertValidSlot, calculateTotal, cancellationRefundPercent } from "./booking.pricing"
import { Booking, type BookingPriceBreakdown } from "./booking.model"

const present = (b: Booking) => {
    const { confirmedPaymentId: _confirmedPaymentId, ...data } = b.toJSON()
    return { ...data, totalPrice: Number(b.totalPrice) }
}

const requestMatchesBooking = (
    booking: Booking,
    input: { venueId: string; startsAt: Date; endsAt: Date; eventType?: string; attendeeCount?: number; addOns?: Array<{ addOnId: string; quantity: number }> },
) => {
    const requestedAddOns = (input.addOns ?? [])
        .map(({ addOnId, quantity }) => ({ addOnId, quantity: quantity ?? 1 }))
        .sort((a, b) => a.addOnId.localeCompare(b.addOnId))
    const bookedAddOns = (booking.priceBreakdown?.addOns ?? [])
        .map(({ addOnId, quantity }) => ({ addOnId, quantity }))
        .sort((a, b) => a.addOnId.localeCompare(b.addOnId))

    return booking.venueId === input.venueId &&
        booking.startsAt.getTime() === input.startsAt.getTime() &&
        booking.endsAt.getTime() === input.endsAt.getTime() &&
        booking.eventType === (input.eventType ?? null) &&
        booking.attendeeCount === (input.attendeeCount ?? null) &&
        JSON.stringify(bookedAddOns) === JSON.stringify(requestedAddOns)
}

const replayBooking = (
    booking: Booking,
    input: Parameters<typeof requestMatchesBooking>[1],
) => {
    if (!requestMatchesBooking(booking, input)) {
        throw conflict("Idempotency-Key was already used for a different booking request")
    }
    return { booking: present(booking), replayed: true }
}

/**
 * Create a venue request. The owner accepts before the customer can pay.
 */
export const createBooking = async (
    userId: string,
    input: { venueId: string; startsAt: Date; endsAt: Date; eventType?: string; attendeeCount?: number; addOns?: Array<{ addOnId: string; quantity: number }> },
    idempotencyKey: string | null,
) => {
    // Idempotent retry: same key => same booking, no duplicate and no error.
    if (idempotencyKey) {
        const existing = await Booking.findOne({ where: { userId, idempotencyKey }, useMaster: true })
        if (existing) return replayBooking(existing, input)
    }

    const quote = await quoteBooking(input)

    try {
        const booking = await sequelize.transaction(async (transaction) => {
            // Free any lapsed unpaid holds on this venue first, so they don't block a legitimate booking.
            await Booking.update(
                { status: "expired" },
                { where: { venueId: input.venueId, status: { [Op.in]: ["requested", "pending"] }, expiresAt: { [Op.lt]: new Date() } }, transaction },
            )
            // The EXCLUDE constraint rejects overlaps atomically, so two concurrent requests can't both win.
            return Booking.create(
                {
                    userId,
                    venueId: input.venueId,
                    startsAt: input.startsAt,
                    endsAt: input.endsAt,
                    totalPrice: quote.priceBreakdown.amountDueNow.toFixed(2),
                    currency: quote.priceBreakdown.currency,
                    eventType: input.eventType ?? null,
                    attendeeCount: input.attendeeCount ?? null,
                    priceBreakdown: quote.priceBreakdown,
                    cancellationPolicySnapshot: quote.cancellationPolicy,
                    cancellationRulesSnapshot: quote.cancellationRules,
                    cancellationRefundPercent: 0,
                    ownerRespondedAt: null,
                    status: "requested",
                    expiresAt: new Date(Date.now() + env.bookingRequestHoldHours * 3_600_000),
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
            if (existing) return replayBooking(existing, input)
        }
        throw err
    }
}

export const quoteBooking = async (input: { venueId: string; startsAt: Date; endsAt: Date; eventType?: string; attendeeCount?: number; addOns?: Array<{ addOnId: string; quantity: number }> }) => {
    assertValidSlot(input.startsAt, input.endsAt)
    const venue = await getVenueForBooking(input.venueId)
    if (input.attendeeCount !== undefined && input.attendeeCount > venue.capacity) {
        throw badRequest(`This venue supports up to ${venue.capacity} attendees`)
    }
    if (input.eventType && venue.eventTypes.length > 0 && !venue.eventTypes.some((type) => type.toLowerCase() === input.eventType!.toLowerCase())) {
        throw badRequest("This venue is not listed for that event type")
    }
    const venueRental = calculateTotal(input.startsAt, input.endsAt, venue.pricePerHour)
    const durationHours = (input.endsAt.getTime() - input.startsAt.getTime()) / 3_600_000
    const requestedAddOns = input.addOns ?? []
    const addOnLines = requestedAddOns.map((requested) => {
        const addOn = venue.addOns.find((candidate) => candidate.addOnId === requested.addOnId)
        if (!addOn) throw badRequest("One of the selected add-ons is no longer available")
        if (addOn.chargeUnit === "per_person" && input.attendeeCount === undefined) {
            throw badRequest(`Attendee count is required to quote ${addOn.name}`)
        }
        const multiplier = addOn.chargeUnit === "per_hour"
            ? durationHours * requested.quantity
            : addOn.chargeUnit === "per_person"
                ? (input.attendeeCount ?? 0) * requested.quantity
                : requested.quantity
        const lineTotal = Math.round(addOn.price * multiplier * 100) / 100
        return { addOnId: addOn.addOnId, name: addOn.name, chargeUnit: addOn.chargeUnit, unitPrice: addOn.price, quantity: requested.quantity, lineTotal }
    })
    const addOnTotal = addOnLines.reduce((sum, line) => sum + line.lineTotal, 0)
    const priceBreakdown: BookingPriceBreakdown = {
        venueRental,
        cleaningFee: venue.cleaningFee,
        amountDueNow: Math.round((venueRental + venue.cleaningFee + addOnTotal) * 100) / 100,
        refundableDepositDueToVenue: venue.refundableDeposit,
        overtimePricePerHour: venue.overtimePricePerHour,
        currency: venue.currency,
        addOns: addOnLines,
    }
    return {
        venueId: venue.venueId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        priceBreakdown,
        cancellationPolicy: venue.cancellationPolicy,
        cancellationRules: venue.cancellationRules,
    }
}

/** Busy intervals for public date picking. Pending holds are visible only until their hold expires. */
export const getPublicAvailability = async (venueId: string, from: Date, to: Date) => {
    await getVenueForBooking(venueId) // also returns 404 for an unknown venue
    const rows = await Booking.findAll({
        where: {
            venueId,
            startsAt: { [Op.lt]: to },
            endsAt: { [Op.gt]: from },
            [Op.or]: [
                { status: "confirmed" },
                { status: { [Op.in]: ["requested", "pending"] }, expiresAt: { [Op.gt]: new Date() } },
            ],
        },
        attributes: ["startsAt", "endsAt", "status"],
        order: [["startsAt", "ASC"]],
        useMaster: true,
    })
    return rows.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, status: row.status }))
}

export const getCalendarEvents = async (venueId: string, token: string) => {
    if (!(await isValidVenueCalendarToken(venueId, token))) throw notFound("Calendar feed")
    const from = new Date()
    const to = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000)
    return Booking.findAll({
        where: {
            venueId,
            startsAt: { [Op.lt]: to },
            endsAt: { [Op.gt]: from },
            [Op.or]: [
                { status: "confirmed" },
                { status: { [Op.in]: ["requested", "pending"] }, expiresAt: { [Op.gt]: from } },
            ],
        },
        attributes: ["bookingId", "startsAt", "endsAt", "status"],
        order: [["startsAt", "ASC"]],
        useMaster: true,
    })
}

export const acceptBookingRequest = async (bookingId: string, actor: AuthUser) => {
    const result = await sequelize.transaction(async (transaction) => {
        const booking = await Booking.findByPk(bookingId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!booking) throw notFound("Booking")
        if (!(await isVenueOwner(booking.venueId, actor.userId))) throw notFound("Booking")
        if (booking.status !== "requested") throw conflict(`Booking is ${booking.status} and can't be accepted`)
        if (!booking.expiresAt || booking.expiresAt <= new Date()) throw conflict("The venue response window has expired")
        await booking.update({ status: "pending", expiresAt: new Date(Date.now() + env.bookingHoldMinutes * 60_000), ownerRespondedAt: new Date() }, { transaction })
        return booking
    })
    publish("booking.accepted", { bookingId, userId: result.userId, venueId: result.venueId })
    return present(result)
}

export const declineBookingRequest = async (bookingId: string, actor: AuthUser, reason?: string) => {
    const result = await sequelize.transaction(async (transaction) => {
        const booking = await Booking.findByPk(bookingId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!booking) throw notFound("Booking")
        if (!(await isVenueOwner(booking.venueId, actor.userId))) throw notFound("Booking")
        if (booking.status !== "requested") throw conflict(`Booking is ${booking.status} and can't be declined`)
        await booking.update({ status: "declined", expiresAt: null, ownerRespondedAt: new Date() }, { transaction })
        return booking
    })
    publish("booking.declined", { bookingId, userId: result.userId, venueId: result.venueId, reason: reason ?? null })
    return present(result)
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

export const getVenueAnalytics = async (venueId: string, actor: AuthUser, range: { from?: Date; to?: Date }) => {
    if (!isStaff(actor.role) && !(await isVenueOwner(venueId, actor.userId))) throw notFound("Venue")
    const from = range.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = range.to ?? new Date()
    const [summary] = await sequelize.query<{
        requests: number
        confirmed: number
        declined: number
        cancelled: number
        expired: number
        averageOwnerResponseMinutes: string | null
        confirmedGross: string
    }>(`
        SELECT
            COUNT(*)::INTEGER AS requests,
            COUNT(*) FILTER (WHERE status = 'confirmed')::INTEGER AS confirmed,
            COUNT(*) FILTER (WHERE status = 'declined')::INTEGER AS declined,
            COUNT(*) FILTER (WHERE status = 'cancelled')::INTEGER AS cancelled,
            COUNT(*) FILTER (WHERE status = 'expired')::INTEGER AS expired,
            AVG(EXTRACT(EPOCH FROM ("ownerRespondedAt" - "createdAt")) / 60)
                FILTER (WHERE "ownerRespondedAt" IS NOT NULL) AS "averageOwnerResponseMinutes",
            COALESCE(SUM("totalPrice") FILTER (WHERE status = 'confirmed'), 0)::TEXT AS "confirmedGross"
        FROM bookings
        WHERE "venueId" = :venueId AND "createdAt" >= :from AND "createdAt" <= :to
    `, {
        replacements: { venueId, from, to },
        type: QueryTypes.SELECT,
        useMaster: true,
    })
    const requests = Number(summary?.requests ?? 0)
    const confirmed = Number(summary?.confirmed ?? 0)
    const averageOwnerResponseMinutes = summary?.averageOwnerResponseMinutes == null
        ? null
        : Number(summary.averageOwnerResponseMinutes)
    const confirmedGross = Number(summary?.confirmedGross ?? 0)
    return {
        from,
        to,
        requests,
        confirmed,
        declined: Number(summary?.declined ?? 0),
        cancelled: Number(summary?.cancelled ?? 0),
        expired: Number(summary?.expired ?? 0),
        conversionPercent: requests ? Math.round((confirmed / requests) * 10_000) / 100 : 0,
        averageOwnerResponseMinutes: averageOwnerResponseMinutes === null
            ? null
            : Math.round(averageOwnerResponseMinutes * 10) / 10,
        confirmedGross: Math.round(confirmedGross * 100) / 100,
    }
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
        const isBooker = booking.userId === actor.userId
        const isOwner = await isVenueOwner(booking.venueId, actor.userId)
        if (!isBooker && !isOwner && !isStaff(actor.role)) throw notFound("Booking")

        if (booking.status === "cancelled") return { booking, refund: false, changed: false } // idempotent
        if (booking.status === "expired" || booking.status === "declined") throw badRequest(`Booking has already ${booking.status}`)
        if (isBooker && !isStaff(actor.role) && booking.startsAt <= new Date()) throw badRequest("Booking has already started")

        const cancelledAt = new Date()
        const refundPercent = booking.status !== "confirmed" ? 0 : (!isBooker || isStaff(actor.role)
            ? 100
            : cancellationRefundPercent(booking.cancellationRulesSnapshot, booking.startsAt, cancelledAt))
        await booking.update({ status: "cancelled", cancelledAt, expiresAt: null, cancellationRefundPercent: refundPercent }, { transaction })
        return { booking, refund: refundPercent > 0, refundPercent, changed: true }
    }
    const result = parentTransaction ? await update(parentTransaction) : await sequelize.transaction(update)

    if (result.changed) {
        const afterCommit = () => {
            businessEvents.inc({ event: "booking_cancelled" })
            // Compensation step of the saga: the payments module listens and refunds if money was taken.
            publish("booking.cancelled", { bookingId, userId: result.booking.userId, venueId: result.booking.venueId, refund: result.refund, refundPercent: result.refundPercent ?? 0 })
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
            if (booking.status === "cancelled" || booking.status === "declined" || booking.status === "requested") return { result: "slot_lost" as const, booking }
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

/** Release expired holds from one instance at a time, even when the API is horizontally scaled. */
export const expireStaleHolds = async () => {
    const count = await sequelize.transaction(async (transaction) => {
        const [lockRows] = await sequelize.query(
            "SELECT pg_try_advisory_xact_lock(7426002) AS locked",
            { transaction },
        )
        if (!(lockRows as Array<{ locked: boolean }>)[0]?.locked) return 0
        const [updated] = await Booking.update(
            { status: "expired" },
            { where: { status: { [Op.in]: ["requested", "pending"] }, expiresAt: { [Op.lt]: new Date() } }, transaction },
        )
        return updated
    })
    if (count) businessEvents.inc({ event: "booking_expired" }, count)
    return count
}
