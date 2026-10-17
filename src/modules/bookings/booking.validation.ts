import Joi from "joi"
import { paginationSchema } from "../../shared/pagination"

export const createBookingSchema = Joi.object({
    venueId: Joi.string().uuid().required(),
    startsAt: Joi.date().iso().required(),
    endsAt: Joi.date().iso().required(),
    // `totalPrice` is deliberately not accepted: the server computes it.
})

export const idempotencyKeySchema = Joi.string().pattern(/^[\w-]{8,64}$/)

export const bookingIdSchema = Joi.object({ bookingId: Joi.string().uuid().required() })
export const venueIdParamSchema = Joi.object({ venueId: Joi.string().uuid().required() })
export const listBookingsSchema = Joi.object({ ...paginationSchema })
