import { Router } from "express"
import { authenticate, requireRole } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import * as c from "./booking.controller"
import * as v from "./booking.validation"

const router = Router()
router.use(authenticate)

router.post("/", validate(v.createBookingSchema), c.create)
router.get("/", validate(v.listBookingsSchema, "query"), c.mine)
router.get("/venue/:venueId", requireRole("Venue Owner"), validate(v.venueIdParamSchema, "params"), validate(v.listBookingsSchema, "query"), c.forVenue)
router.get("/:bookingId", validate(v.bookingIdSchema, "params"), c.get)
router.post("/:bookingId/cancel", validate(v.bookingIdSchema, "params"), c.cancel)

export default router
