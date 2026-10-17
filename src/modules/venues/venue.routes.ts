import { Router } from "express"
import { authenticate, requireRole } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import { listUsersSchema as pageSchema } from "../users/user.validation"
import * as c from "./venue.controller"
import * as v from "./venue.validation"

const router = Router()

// public catalogue
router.get("/", validate(v.listVenuesSchema, "query"), c.list)

// owner dashboard (declared before /:venueId so "mine" isn't treated as an id)
router.get("/mine", authenticate, requireRole("Venue Owner"), validate(pageSchema, "query"), c.mine)

router.get("/:venueId", validate(v.venueIdSchema, "params"), c.get)
router.post("/", authenticate, requireRole("Venue Owner"), validate(v.createVenueSchema), c.create)
router.patch("/:venueId", authenticate, requireRole("Venue Owner"), validate(v.venueIdSchema, "params"), validate(v.updateVenueSchema), c.update)
router.delete("/:venueId", authenticate, requireRole("Venue Owner"), validate(v.venueIdSchema, "params"), c.remove)

export default router
