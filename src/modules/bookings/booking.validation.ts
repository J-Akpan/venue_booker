import Joi from "joi"
import { paginationSchema } from "../../shared/pagination"

export const createBookingSchema = Joi.object({
    venueId: Joi.string().uuid().required(),
    startsAt: Joi.date().iso().required(),
    endsAt: Joi.date().iso().required(),
    eventType: Joi.string().trim().min(2).max(80),
    attendeeCount: Joi.number().integer().min(1).max(1_000_000),
    // `totalPrice` is deliberately not accepted: the server computes it.
})

export const quoteBookingSchema = Joi.object({
    venueId: Joi.string().uuid().required(),
    startsAt: Joi.date().iso().required(),
    endsAt: Joi.date().iso().required(),
    eventType: Joi.string().trim().min(2).max(80),
    attendeeCount: Joi.number().integer().min(1).max(1_000_000),
})

export const availabilityQuerySchema = Joi.object({
    venueId: Joi.string().uuid().required(),
    from: Joi.date().iso().required(),
    to: Joi.date().iso().required(),
}).custom((value, helpers) => {
    if (value.to <= value.from) return helpers.error("any.invalid", { message: "to must be after from" })
    if (value.to.getTime() - value.from.getTime() > 31 * 24 * 60 * 60 * 1000) {
        return helpers.error("any.invalid", { message: "availability range cannot exceed 31 days" })
    }
    return value
})

export const idempotencyKeySchema = Joi.string().pattern(/^[\w-]{8,64}$/)

export const bookingIdSchema = Joi.object({ bookingId: Joi.string().uuid().required() })
export const venueIdParamSchema = Joi.object({ venueId: Joi.string().uuid().required() })
export const listBookingsSchema = Joi.object({ ...paginationSchema })
