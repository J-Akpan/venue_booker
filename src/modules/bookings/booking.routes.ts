import { Router } from "express"
import { authenticate, requireRole } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import * as c from "./booking.controller"
import * as v from "./booking.validation"

const router = Router()

// Public date picker data; must stay fresh and includes active payment holds.
router.get("/calendar/:venueId.ics", validate(v.venueIdParamSchema, "params"), validate(v.calendarFeedSchema, "query"), c.calendarFeed)
router.get("/availability", validate(v.availabilityQuerySchema, "query"), c.availability)
router.get("/quote", validate(v.quoteBookingSchema, "query"), c.quote)

router.use(authenticate)

router.post("/", validate(v.createBookingSchema), c.create)
router.get("/", validate(v.listBookingsSchema, "query"), c.mine)
router.get("/venue/:venueId", requireRole("Venue Owner"), validate(v.venueIdParamSchema, "params"), validate(v.listBookingsSchema, "query"), c.forVenue)
router.get("/venue/:venueId/analytics", requireRole("Venue Owner"), validate(v.venueIdParamSchema, "params"), validate(v.venueAnalyticsQuerySchema, "query"), c.venueAnalytics)
router.post("/:bookingId/accept", requireRole("Venue Owner"), validate(v.bookingIdSchema, "params"), c.accept)
router.post("/:bookingId/decline", requireRole("Venue Owner"), validate(v.bookingIdSchema, "params"), validate(v.declineBookingSchema), c.decline)
router.get("/:bookingId", validate(v.bookingIdSchema, "params"), c.get)
router.post("/:bookingId/cancel", validate(v.bookingIdSchema, "params"), c.cancel)

export default router
