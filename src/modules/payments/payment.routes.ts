import Joi from "joi"
import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import { sensitiveLimiter } from "../../shared/middleware/rateLimit"
import * as c from "./payment.controller"

const router = Router()

router.post("/checkout", authenticate, sensitiveLimiter, validate(Joi.object({ bookingId: Joi.string().uuid().required() })), c.checkout)
router.get("/booking/:bookingId", authenticate, validate(Joi.object({ bookingId: Joi.string().uuid().required() }), "params"), c.forBooking)

export default router
export { webhook as stripeWebhook } from "./payment.controller"
