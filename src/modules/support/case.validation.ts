import Joi from "joi"
import { paginationSchema } from "../../shared/pagination"

export const createCaseSchema = Joi.object({
    type: Joi.string().valid("complaint", "dispute").required(),
    subject: Joi.string().trim().min(3).max(160).required(),
    description: Joi.string().trim().min(10).max(5000).required(),
    bookingId: Joi.string().uuid(), // required for disputes
    venueId: Joi.string().uuid(),
})

export const caseIdSchema = Joi.object({ caseId: Joi.string().uuid().required() })

export const listMyCasesSchema = Joi.object({ ...paginationSchema })

export const listCasesSchema = Joi.object({
    ...paginationSchema,
    status: Joi.string().valid("open", "in_review", "resolved", "rejected"),
    type: Joi.string().valid("complaint", "dispute"),
    assignedTo: Joi.string().uuid(),
    unassigned: Joi.boolean(),
})

export const assignCaseSchema = Joi.object({
    // Omit to assign to yourself. Only a Super Admin may assign to someone else.
    assigneeId: Joi.string().uuid(),
})

export const resolveCaseSchema = Joi.object({
    outcome: Joi.string().valid("resolved", "rejected").required(),
    resolution: Joi.string().trim().min(5).max(5000).required(),
    // Money-affecting; Super Admin only. Cancels the booking and refunds the payment if one was taken.
    bookingAction: Joi.string().valid("none", "cancel_and_refund").default("none"),
})
