import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import { sensitiveLimiter } from "../../shared/middleware/rateLimit"
import * as c from "./review.controller"
import * as v from "./review.validation"

const router = Router()

router.get("/venues/:venueId", validate(v.venueReviewParamsSchema, "params"), validate(v.venueReviewsSchema, "query"), c.forVenue)
router.post("/", authenticate, sensitiveLimiter, validate(v.createReviewSchema), c.create)

export default router
