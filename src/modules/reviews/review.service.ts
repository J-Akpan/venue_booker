import { fn, col, UniqueConstraintError } from "sequelize"
import { conflict, notFound } from "../../shared/errors"
import { PageQuery, toOffset } from "../../shared/pagination"
import { Booking } from "../bookings/booking.model"
import { getVenueForBooking, isVenueOwner } from "../venues"
import { Review } from "./review.model"

const present = (review: Review) => ({
    reviewId: review.reviewId,
    rating: review.rating,
    comment: review.comment,
    verifiedBooking: true,
    createdAt: review.createdAt,
})

export const createReview = async (authorId: string, input: { bookingId: string; rating: number; comment?: string | null }) => {
    const booking = await Booking.findByPk(input.bookingId, { useMaster: true })
    if (!booking || booking.userId !== authorId) throw notFound("Booking")
    if (await isVenueOwner(booking.venueId, authorId)) throw notFound("Booking")
    if (booking.status !== "confirmed" || booking.endsAt > new Date()) {
        throw conflict("Reviews are available after a confirmed event has ended")
    }

    try {
        const review = await Review.create({
            bookingId: booking.bookingId,
            venueId: booking.venueId,
            authorId,
            rating: input.rating,
            comment: input.comment?.trim() || null,
        })
        return present(review)
    } catch (err) {
        if (err instanceof UniqueConstraintError) throw conflict("This booking already has a review")
        throw err
    }
}

export const listVenueReviews = async (venueId: string, page: PageQuery) => {
    await getVenueForBooking(venueId)
    const { rows, count } = await Review.findAndCountAll({
        where: { venueId },
        order: [["createdAt", "DESC"]],
        ...toOffset(page),
    })
    const aggregate = await Review.findOne({
        where: { venueId },
        attributes: [
            [fn("AVG", col("rating")), "averageRating"],
            [fn("COUNT", col("reviewId")), "reviewCount"],
        ],
        raw: true,
    }) as unknown as { averageRating: string | null; reviewCount: string }

    return {
        rows: rows.map(present),
        total: count,
        summary: {
            averageRating: aggregate?.averageRating ? Number(Number(aggregate.averageRating).toFixed(2)) : 0,
            reviewCount: Number(aggregate?.reviewCount ?? 0),
        },
    }
}
