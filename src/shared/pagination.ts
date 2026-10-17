import Joi from "joi"

export const paginationSchema = {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
}

export interface PageQuery {
    page: number
    limit: number
}

export const toOffset = ({ page, limit }: PageQuery) => ({ limit, offset: (page - 1) * limit })

export const pageMeta = ({ page, limit }: PageQuery, total: number) => ({
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
})
