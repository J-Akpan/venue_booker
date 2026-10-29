import { Op, WhereOptions } from "sequelize"
import { sequelize } from "../../config/database"
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors"
import { publish } from "../../shared/events"
import { isStaff, type AuthUser } from "../../shared/middleware/auth"
import { PageQuery, toOffset } from "../../shared/pagination"
import { cancelBooking, getBookingForPayment } from "../bookings"
import { getStaffRole } from "../users"
import { isVenueOwner } from "../venues"
import { BookingAction, CaseStatus, CaseType, SupportCase } from "./case.model"

const OPEN: CaseStatus[] = ["open", "in_review"]

// ---- raising & reading (bookers and venue owners) -------------------------------------------

export const createCase = async (
    user: AuthUser,
    input: { type: CaseType; subject: string; description: string; bookingId?: string; venueId?: string },
) => {
    if (input.type === "dispute" && !input.bookingId) throw badRequest("A dispute must reference a booking (bookingId)")

    let venueId = input.venueId ?? null
    if (input.bookingId) {
        const booking = await getBookingForPayment(input.bookingId)
        // Only the two parties to a booking may raise a case about it. 404 so ids can't be probed.
        if (!booking || (booking.userId !== user.userId && !(await isVenueOwner(booking.venueId, user.userId)))) throw notFound("Booking")
        venueId = booking.venueId
    }

    return sequelize.transaction(async (transaction) => {
        if (input.bookingId) {
            // Serialize submissions for this booking/actor/type across all app instances.
            // A database advisory lock avoids a check-then-insert race without rewriting old cases.
            const lockKey = `${user.userId}:${input.bookingId}:${input.type}`
            await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:key), hashtext('support-case'))", {
                replacements: { key: lockKey },
                transaction,
            })
            const duplicate = await SupportCase.findOne({
                where: { raisedBy: user.userId, bookingId: input.bookingId, type: input.type, status: { [Op.in]: OPEN } },
                transaction,
            })
            if (duplicate) throw conflict(`You already have an open ${input.type} for this booking`)
        }

        return SupportCase.create(
            {
                type: input.type,
                raisedBy: user.userId,
                bookingId: input.bookingId ?? null,
                venueId,
                subject: input.subject,
                description: input.description,
                assignedTo: null,
                resolution: null,
                resolvedBy: null,
                resolvedAt: null,
            },
            { transaction },
        )
    })
}

export const listMyCases = async (userId: string, page: PageQuery) => {
    const { rows, count } = await SupportCase.findAndCountAll({ where: { raisedBy: userId }, order: [["createdAt", "DESC"]], ...toOffset(page), useMaster: true })
    return { rows, total: count }
}

export const getCase = async (caseId: string, actor: AuthUser) => {
    const found = await SupportCase.findByPk(caseId, { useMaster: true })
    if (!found || (found.raisedBy !== actor.userId && !isStaff(actor.role))) throw notFound("Case")
    return found
}

// ---- staff queue ----------------------------------------------------------------------------

export const listCases = async (filters: PageQuery & { status?: CaseStatus; type?: CaseType; assignedTo?: string; unassigned?: boolean }) => {
    const where: WhereOptions = {}
    if (filters.status) Object.assign(where, { status: filters.status })
    if (filters.type) Object.assign(where, { type: filters.type })
    if (filters.assignedTo) Object.assign(where, { assignedTo: filters.assignedTo })
    if (filters.unassigned) Object.assign(where, { assignedTo: null })
    // Oldest first: the queue is worked in the order people have been waiting.
    const { rows, count } = await SupportCase.findAndCountAll({ where, order: [["createdAt", "ASC"]], ...toOffset(filters), useMaster: true })
    return { rows, total: count }
}

/** Staff pick up a case for themselves; only a Super Admin can hand a case to someone else. */
export const assignCase = async (caseId: string, actor: AuthUser, assigneeId?: string) => {
    const target = assigneeId ?? actor.userId
    if (target !== actor.userId && actor.role !== "Super Admin") throw forbidden("Only a Super Admin can assign cases to other staff")
    if (target !== actor.userId && !(await getStaffRole(target))) throw badRequest("Assignee must be a staff member")

    return sequelize.transaction(async (transaction) => {
        const found = await SupportCase.findByPk(caseId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!found) throw notFound("Case")
        if (!OPEN.includes(found.status)) throw conflict(`Case is already ${found.status}`)
        if (found.assignedTo && found.assignedTo !== actor.userId && actor.role !== "Super Admin") {
            throw conflict("Case is already assigned to another staff member")
        }
        await found.update({ assignedTo: target, status: "in_review" }, { transaction })
        return found
    })
}

/**
 * Close a case. Admin staff resolve the cases assigned to them; a Super Admin can resolve any case,
 * and is the only one who can take money-affecting action on the booking.
 */
export const resolveCase = async (
    caseId: string,
    actor: AuthUser,
    input: { outcome: "resolved" | "rejected"; resolution: string; bookingAction: BookingAction },
) => {
    if (input.bookingAction === "cancel_and_refund" && actor.role !== "Super Admin") {
        throw forbidden("Only a Super Admin can cancel and refund a booking")
    }

    const result = await sequelize.transaction(async (transaction) => {
        const found = await SupportCase.findByPk(caseId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!found) throw notFound("Case")
        if (!OPEN.includes(found.status)) throw conflict(`Case is already ${found.status}`) // no double-resolution
        if (actor.role !== "Super Admin" && found.assignedTo !== actor.userId) throw forbidden("Assign the case to yourself before resolving it")
        if (input.bookingAction === "cancel_and_refund") {
            if (!found.bookingId) throw badRequest("This case has no booking to cancel")
            // Idempotent: cancelling an already-cancelled booking is a no-op. Publishes booking.cancelled,
            // which the payments module turns into a refund job when money was taken.
            await cancelBooking(found.bookingId, actor, transaction)
        }
        await found.update(
            {
                status: input.outcome,
                resolution: input.resolution,
                bookingAction: input.bookingAction,
                resolvedBy: actor.userId,
                resolvedAt: new Date(),
                assignedTo: found.assignedTo ?? actor.userId,
            },
            { transaction },
        )
        return found
    })

    publish("case.resolved", { caseId, raisedBy: result.raisedBy, type: result.type, outcome: input.outcome, resolution: input.resolution })
    return result
}
