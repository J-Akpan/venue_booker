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

export const get = async (req: Request, res: Response) => {
    res.json({ booking: await bookings.getBooking(String(req.params.bookingId), req.user!) })
}

export const cancel = async (req: Request, res: Response) => {
    const bookingId = String(req.params.bookingId)
    const booking = await bookings.cancelBooking(bookingId, req.user!)
    await audit(req, { action: "booking.cancel", entity: "booking", entityId: bookingId })
    res.json({ booking })
}
