import Joi from "joi"
import { paginationSchema } from "../../shared/pagination"

export const createReviewSchema = Joi.object({
    bookingId: Joi.string().uuid().required(),
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().trim().max(2000).allow("", null),
})

export const venueReviewsSchema = Joi.object({
    ...paginationSchema,
})

export const venueReviewParamsSchema = Joi.object({ venueId: Joi.string().uuid().required() })
