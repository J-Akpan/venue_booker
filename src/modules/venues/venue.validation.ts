import Joi from "joi"
import { paginationSchema } from "../../shared/pagination"

export const createVenueSchema = Joi.object({
    name: Joi.string().trim().max(120).required(),
    description: Joi.string().trim().max(5000).required(),
    location: Joi.string().trim().max(160).required(),
    capacity: Joi.number().integer().min(1).max(1_000_000).required(),
    pricePerHour: Joi.number().precision(2).min(0).max(10_000_000).required(),
    currency: Joi.string().uppercase().length(3).valid("USD", "NGN").default("USD"),
    contact: Joi.string().trim().max(64).required(),
    pictures: Joi.array().items(Joi.string().uri({ scheme: ["https"] })).max(10).default([]),
})

export const updateVenueSchema = Joi.object({
    name: Joi.string().trim().max(120),
    description: Joi.string().trim().max(5000),
    location: Joi.string().trim().max(160),
    capacity: Joi.number().integer().min(1).max(1_000_000),
    pricePerHour: Joi.number().precision(2).min(0).max(10_000_000),
    contact: Joi.string().trim().max(64),
    pictures: Joi.array().items(Joi.string().uri({ scheme: ["https"] })).max(10),
}).min(1)

export const venueIdSchema = Joi.object({ venueId: Joi.string().uuid().required() })

export const listVenuesSchema = Joi.object({
    ...paginationSchema,
    q: Joi.string().trim().max(100),
    location: Joi.string().trim().max(100),
    minCapacity: Joi.number().integer().min(1),
    maxPrice: Joi.number().min(0),
    sort: Joi.string().valid("newest", "price_asc", "price_desc", "capacity_desc").default("newest"),
})
