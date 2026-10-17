import { badRequest } from "../../shared/errors"

export const MIN_SLOT_MINUTES = 30
export const MAX_BOOKING_DAYS = 14

/**
 * Price is always computed on the server from the venue's current rate; the client never
 * supplies a total. Works in integer cents to avoid floating point drift.
 */
export const calculateTotal = (startsAt: Date, endsAt: Date, pricePerHour: number): number => {
    const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000
    return Math.round((minutes * Math.round(pricePerHour * 100)) / 60) / 100
}

export const assertValidSlot = (startsAt: Date, endsAt: Date, now = new Date()) => {
    if (!(endsAt > startsAt)) throw badRequest("endsAt must be after startsAt")
    if (startsAt <= now) throw badRequest("Bookings must start in the future")
    const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000
    if (minutes % MIN_SLOT_MINUTES !== 0) throw badRequest(`Duration must be a multiple of ${MIN_SLOT_MINUTES} minutes`)
    if (minutes > MAX_BOOKING_DAYS * 24 * 60) throw badRequest(`Bookings can't exceed ${MAX_BOOKING_DAYS} days`)
}
