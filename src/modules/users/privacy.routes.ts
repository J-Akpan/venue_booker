import Joi from "joi"
import { Router } from "express"
import { authenticate, requireRole } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import { paginationSchema } from "../../shared/pagination"
import * as c from "./privacy.controller"

const router = Router()
router.use(authenticate, requireRole("Admin"))
router.get("/", validate(Joi.object({ ...paginationSchema, status: Joi.string().valid("open", "in_review", "completed", "rejected") }), "query"), c.list)
router.post("/:requestId/resolve", validate(Joi.object({ requestId: Joi.string().uuid().required() }), "params"), validate(Joi.object({ decision: Joi.string().valid("review", "complete", "reject").required(), note: Joi.string().max(2000).allow("") })), c.resolve)

export default router
