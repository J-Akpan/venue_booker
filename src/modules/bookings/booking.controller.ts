import { Request, Response } from "express"
import { audit } from "../audit"
import { badRequest } from "../../shared/errors"
import { pageMeta, PageQuery } from "../../shared/pagination"
import * as bookings from "./booking.service"
import { idempotencyKeySchema } from "./booking.validation"

const readIdempotencyKey = (req: Request): string | null => {
    const header = req.header("Idempotency-Key")
    if (header === undefined) return null
    const { error } = idempotencyKeySchema.validate(header)
    if (error) throw badRequest("Idempotency-Key must be 8-64 characters: letters, digits, '_' or '-'")
    return header
}

export const create = async (req: Request, res: Response) => {
    const { booking, replayed } = await bookings.createBooking(req.user!.userId, req.body, readIdempotencyKey(req))
    if (!replayed) await audit(req, { action: "booking.create", entity: "booking", entityId: booking.bookingId })
    res.status(replayed ? 200 : 201).location(`/api/v1/bookings/${booking.bookingId}`).json({ booking })
}

export const availability = async (req: Request, res: Response) => {
    const { venueId, from, to } = req.query as unknown as { venueId: string; from: Date; to: Date }
    res.set("Cache-Control", "private, no-store")
    const busySlots = await bookings.getPublicAvailability(venueId, from, to)
    res.json({ venueId, from, to, busySlots })
}

export const quote = async (req: Request, res: Response) => {
    const input = req.query as unknown as { venueId: string; startsAt: Date; endsAt: Date; eventType?: string; attendeeCount?: number; addOns?: Array<{ addOnId: string; quantity: number }> }
    res.set("Cache-Control", "private, no-store")
    res.json({ quote: await bookings.quoteBooking(input) })
}

export const mine = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total } = await bookings.listUserBookings(req.user!.userId, page)
    res.json({ data: rows, meta: pageMeta(page, total) })
}

export const forVenue = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total } = await bookings.listVenueBookings(String(req.params.venueId), req.user!, page)
    res.json({ data: rows, meta: pageMeta(page, total) })
}

export const venueAnalytics = async (req: Request, res: Response) => {
    res.json({ analytics: await bookings.getVenueAnalytics(String(req.params.venueId), req.user!, req.query as { from?: Date; to?: Date }) })
}

const icsEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
const icsDate = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")

export const calendarFeed = async (req: Request, res: Response) => {
    const events = await bookings.getCalendarEvents(String(req.params.venueId), String(req.query.token))
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Venue Booker//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    for (const event of events) {
        lines.push(
            "BEGIN:VEVENT",
            `UID:${event.bookingId}@venue-booker`,
            `DTSTAMP:${icsDate(new Date())}`,
            `DTSTART:${icsDate(event.startsAt)}`,
            `DTEND:${icsDate(event.endsAt)}`,
            `SUMMARY:${icsEscape(event.status === "confirmed" ? "Venue booked" : "Venue on hold")}`,
            `STATUS:${event.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
            "CLASS:PRIVATE",
            "END:VEVENT",
        )
    }
    lines.push("END:VCALENDAR")
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-store" }).send(lines.join("\r\n"))
}

export const get = async (req: Request, res: Response) => {
    res.json({ booking: await bookings.getBooking(String(req.params.bookingId), req.user!) })
}

export const cancel = async (req: Request, res: Response) => {
    const bookingId = String(req.params.bookingId)
    const booking = await bookings.cancelBooking(bookingId, req.user!)
    await audit(req, { action: "booking.cancel", entity: "booking", entityId: bookingId })
    res.json({ booking })
}

export const accept = async (req: Request, res: Response) => {
    const bookingId = String(req.params.bookingId)
    const booking = await bookings.acceptBookingRequest(bookingId, req.user!)
    await audit(req, { action: "booking.accept", entity: "booking", entityId: bookingId })
    res.json({ booking })
}

export const decline = async (req: Request, res: Response) => {
    const bookingId = String(req.params.bookingId)
    const booking = await bookings.declineBookingRequest(bookingId, req.user!, req.body.reason ?? undefined)
    await audit(req, { action: "booking.decline", entity: "booking", entityId: bookingId })
    res.json({ booking })
}
