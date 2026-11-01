import Joi from "joi"
import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import { sensitiveLimiter } from "../../shared/middleware/rateLimit"
import { requireRole } from "../../shared/middleware/auth"
import { paginationSchema } from "../../shared/pagination"
import * as c from "./payment.controller"

const router = Router()

router.post("/checkout", authenticate, sensitiveLimiter, validate(Joi.object({ bookingId: Joi.string().uuid().required() })), c.checkout)
router.get("/booking/:bookingId", authenticate, validate(Joi.object({ bookingId: Joi.string().uuid().required() }), "params"), c.forBooking)
router.post("/connect/onboarding", authenticate, requireRole("Venue Owner"), sensitiveLimiter, c.connectOnboarding)
router.get("/connect/status", authenticate, requireRole("Venue Owner"), c.connectStatus)
router.get("/connect/settlements", authenticate, requireRole("Venue Owner"), validate(Joi.object({ ...paginationSchema, venueId: Joi.string().uuid() }), "query"), c.settlements)

export default router
export { webhook as stripeWebhook } from "./payment.controller"
