import Joi from "joi"
import { paginationSchema } from "../../shared/pagination"

export const createBookingSchema = Joi.object({
    venueId: Joi.string().uuid().required(),
    startsAt: Joi.date().iso().required(),
    endsAt: Joi.date().iso().required(),
    eventType: Joi.string().trim().min(2).max(80),
    attendeeCount: Joi.number().integer().min(1).max(1_000_000),
    addOns: Joi.array().items(Joi.object({ addOnId: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).max(1000).default(1) })).unique("addOnId").max(10),
    // `totalPrice` is deliberately not accepted: the server computes it.
})

export const quoteBookingSchema = Joi.object({
    venueId: Joi.string().uuid().required(),
    startsAt: Joi.date().iso().required(),
    endsAt: Joi.date().iso().required(),
    eventType: Joi.string().trim().min(2).max(80),
    attendeeCount: Joi.number().integer().min(1).max(1_000_000),
    addOns: Joi.array().items(Joi.object({ addOnId: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).max(1000).default(1) })).unique("addOnId").max(10),
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
export const declineBookingSchema = Joi.object({ reason: Joi.string().trim().max(500).allow("", null) })
export const venueIdParamSchema = Joi.object({ venueId: Joi.string().uuid().required() })
export const listBookingsSchema = Joi.object({ ...paginationSchema })

export const venueAnalyticsQuerySchema = Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso(),
}).custom((value, helpers) => {
    if (value.from && value.to && value.to <= value.from) return helpers.error("any.invalid")
    if (value.from && value.to && value.to.getTime() - value.from.getTime() > 366 * 24 * 60 * 60 * 1000) return helpers.error("any.invalid")
    return value
})

export const calendarFeedSchema = Joi.object({ token: Joi.string().min(32).max(128).required() })
