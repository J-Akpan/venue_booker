import { Op, UniqueConstraintError } from "sequelize"
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { sequelize } from "../../config/database"
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors"
import { isStaff, type AuthUser } from "../../shared/middleware/auth"
import { Booking, cancelBooking } from "../bookings"
import { Payment } from "../payments/payment.model"
import { Review } from "../reviews/review.model"
import { SupportCase } from "../support/case.model"
import { Venue } from "../venues/venue.model"
import { VenueSettlement } from "../payments/payout.model"
import { RefreshToken, User } from "./user.model"
import { PrivacyRequest, type PrivacyRequestStatus, type PrivacyRequestType } from "./privacy-request.model"

export const exportPersonalData = async (userId: string) => {
    const user = await User.findByPk(userId, { useMaster: true })
    if (!user || user.privacyDeletedAt) throw notFound("User")
    const [bookings, payments, cases, reviews, venues, settlements, requests] = await Promise.all([
        Booking.findAll({ where: { userId }, order: [["createdAt", "DESC"]], useMaster: true }),
        Payment.findAll({ where: { userId }, order: [["createdAt", "DESC"]], useMaster: true }),
        SupportCase.findAll({ where: { raisedBy: userId }, order: [["createdAt", "DESC"]], useMaster: true }),
        Review.findAll({ where: { authorId: userId }, order: [["createdAt", "DESC"]], useMaster: true }),
        Venue.findAll({ where: { ownerId: userId }, order: [["createdAt", "DESC"]], paranoid: false, useMaster: true }),
        VenueSettlement.findAll({ where: { ownerId: userId }, order: [["createdAt", "DESC"]], useMaster: true }),
        PrivacyRequest.findAll({ where: { userId }, order: [["createdAt", "DESC"]], useMaster: true }),
    ])
    const safePayments = payments.map((payment) => ({
        paymentId: payment.paymentId,
        bookingId: payment.bookingId,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paidAt,
        refundedAmount: Number(payment.refundedAmount),
        refundedAt: payment.refundedAt,
    }))
    const paymentByBooking = new Map<string, typeof safePayments>()
    for (const payment of safePayments) paymentByBooking.set(payment.bookingId, [...(paymentByBooking.get(payment.bookingId) ?? []), payment])
    return {
        exportedAt: new Date().toISOString(),
        profile: {
            userId: user.userId, username: user.username, email: user.email, role: user.role,
            firstname: user.firstname, lastname: user.lastname, contact: user.contact,
            whatsappOptIn: user.whatsappOptIn, whatsappOptInAt: user.whatsappOptInAt,
            address: user.address, gender: user.gender, createdAt: user.createdAt,
        },
        bookings: bookings.map((booking) => {
            const { confirmedPaymentId: _confirmedPaymentId, idempotencyKey: _idempotencyKey, ...safe } = booking.toJSON()
            return { ...safe, payments: paymentByBooking.get(booking.bookingId) ?? [] }
        }),
        payments: safePayments,
        supportCases: cases.map((row) => row.toJSON()),
        reviews: reviews.map((row) => row.toJSON()),
        ownedVenues: venues.map((venue) => {
            const { calendarTokenHash: _calendarTokenHash, ...safe } = venue.toJSON()
            return safe
        }),
        venueSettlements: settlements.map((row) => ({ ...row.toJSON(), grossAmount: Number(row.grossAmount), platformFeeAmount: Number(row.platformFeeAmount), venueAmount: Number(row.venueAmount), refundedAmount: Number(row.refundedAmount) })),
        privacyRequests: requests.map((row) => row.toJSON()),
    }
}

export const recordExportRequest = async (userId: string) => PrivacyRequest.create({
    userId,
    requestType: "export",
    status: "completed",
    note: "Self-service data export generated.",
    resolvedBy: userId,
    resolvedAt: new Date(),
})

export const listMyPrivacyRequests = async (userId: string) => {
    const requests = await PrivacyRequest.findAll({ where: { userId }, order: [["createdAt", "DESC"]], useMaster: true })
    return requests.map((row) => row.toJSON())
}

export const createPrivacyRequest = async (userId: string, requestType: PrivacyRequestType) => {
    const user = await User.findByPk(userId, { useMaster: true })
    if (!user || user.privacyDeletedAt) throw notFound("User")
    if (user.role === "Admin" || user.role === "Super Admin") throw forbidden("Platform staff accounts must be handled by another Super Admin")
    const active = await PrivacyRequest.findOne({ where: { userId, requestType, status: { [Op.in]: ["open", "in_review"] } }, useMaster: true })
    if (active) return { request: active, replayed: true }
    try {
        const request = await PrivacyRequest.create({ userId, requestType, status: "open", note: null, resolvedBy: null, resolvedAt: null })
        return { request, replayed: false }
    } catch (err) {
        if (!(err instanceof UniqueConstraintError)) throw err
        const raced = await PrivacyRequest.findOne({ where: { userId, requestType, status: { [Op.in]: ["open", "in_review"] } }, useMaster: true })
        if (!raced) throw err
        return { request: raced, replayed: true }
    }
}

export const listPrivacyRequests = async (page: { page: number; limit: number }, status?: PrivacyRequestStatus) => {
    const { rows, count } = await PrivacyRequest.findAndCountAll({
        where: status ? { status } : undefined,
        order: [["createdAt", "ASC"]],
        limit: page.limit,
        offset: (page.page - 1) * page.limit,
        useMaster: true,
    })
    const users = await User.findAll({ where: { userId: rows.map((row) => row.userId) }, attributes: ["userId", "username", "email", "role"], useMaster: true })
    const subjects = new Map(users.map((user) => [user.userId, { username: user.username, email: user.email, role: user.role }]))
    return { rows: rows.map((row) => ({ ...row.toJSON(), subject: subjects.get(row.userId) ?? null })), total: count }
}

export const resolvePrivacyRequest = async (requestId: string, actor: AuthUser, decision: "review" | "complete" | "reject", note?: string) => {
    if (!isStaff(actor.role)) throw forbidden()
    return sequelize.transaction(async (transaction) => {
        const request = await PrivacyRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!request) throw notFound("Privacy request")
        if (request.status === "completed" || request.status === "rejected") throw conflict("This request has already been resolved")
        if (decision === "review") {
            await request.update({ status: "in_review", note: note ?? request.note }, { transaction })
            return request.toJSON()
        }
        if (decision === "complete" && request.requestType === "deletion") {
            const user = await User.findByPk(request.userId, { transaction, lock: transaction.LOCK.UPDATE })
            if (!user) throw notFound("User")
            if (user.role === "Admin" || user.role === "Super Admin") throw badRequest("Staff account deletion must be completed by another Super Admin")
            const activeBookings = await Booking.findAll({
                where: { userId: user.userId, status: { [Op.in]: ["requested", "pending", "confirmed"] } },
                attributes: ["bookingId"], transaction, lock: transaction.LOCK.UPDATE,
            })
            for (const booking of activeBookings) {
                await cancelBooking(booking.bookingId, { userId: actor.userId, role: actor.role }, transaction)
            }
            const ownedVenues = await Venue.findAll({ where: { ownerId: user.userId }, attributes: ["venueId"], paranoid: false, transaction })
            for (const venue of ownedVenues) await venue.destroy({ transaction })
            const deletedAt = new Date()
            const randomPassword = await bcrypt.hash(randomBytes(48).toString("hex"), 12)
            await user.update({
                username: `deleted_${user.userId.replace(/-/g, "").slice(0, 22)}`,
                email: `deleted+${user.userId}@deleted.invalid`,
                password: randomPassword,
                firstname: null,
                lastname: null,
                contact: null,
                whatsappOptIn: false,
                whatsappOptInAt: null,
                address: null,
                gender: null,
                otpHash: null,
                otpExpiry: null,
                otpAttempts: 0,
                privacyDeletedAt: deletedAt,
                role: "User",
            }, { transaction })
            await RefreshToken.update({ revokedAt: deletedAt }, { where: { userId: user.userId, revokedAt: null }, transaction })
        }
        await request.update({
            status: decision === "complete" ? "completed" : "rejected",
            note: note ?? null,
            resolvedBy: actor.userId,
            resolvedAt: new Date(),
        }, { transaction })
        return request.toJSON()
    })
}
