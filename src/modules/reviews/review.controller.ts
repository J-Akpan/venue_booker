import { Request, Response } from "express"
import { audit } from "../audit"
import { pageMeta, PageQuery } from "../../shared/pagination"
import * as reviews from "./review.service"

export const create = async (req: Request, res: Response) => {
    const review = await reviews.createReview(req.user!.userId, req.body)
    await audit(req, { action: "review.create", entity: "review", entityId: review.reviewId })
    res.status(201).json({ review })
}

export const forVenue = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total, summary } = await reviews.listVenueReviews(String(req.params.venueId), page)
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60")
        .json({ data: rows, meta: pageMeta(page, total), summary })
}
