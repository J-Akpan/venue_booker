import { Router } from "express"
import { authenticate, requireRole } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import * as c from "./user.admin.controller"
import * as v from "./user.validation"

// Everything here is reserved for the Super Admin.
const router = Router()
router.use(authenticate, requireRole("Super Admin"))

router.get("/staff", validate(v.listUsersSchema, "query"), c.listStaff)
router.post("/staff", validate(v.createStaffSchema), c.createStaff)
router.delete("/staff/:userId", validate(v.userIdParamSchema, "params"), c.removeStaff)
router.put("/users/:userId/role", validate(v.userIdParamSchema, "params"), validate(v.assignRoleSchema), c.assignRole)

export default router
