import { Router } from "express"
import { authenticate, requireRole } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import { sensitiveLimiter } from "../../shared/middleware/rateLimit"
import * as c from "./case.controller"
import * as v from "./case.validation"

/** Bookers and venue owners: raise and follow their own complaints/disputes. Mounted at /support. */
export const supportRoutes = Router()
supportRoutes.use(authenticate)
supportRoutes.post("/cases", sensitiveLimiter, validate(v.createCaseSchema), c.create)
supportRoutes.get("/cases", validate(v.listMyCasesSchema, "query"), c.mine)
supportRoutes.get("/cases/:caseId", validate(v.caseIdSchema, "params"), c.get)

/** Staff queue (Admin and Super Admin). Mounted at /admin/cases. */
export const caseAdminRoutes = Router()
caseAdminRoutes.use(authenticate, requireRole("Admin"))
caseAdminRoutes.get("/", validate(v.listCasesSchema, "query"), c.list)
caseAdminRoutes.get("/:caseId", validate(v.caseIdSchema, "params"), c.get)
caseAdminRoutes.post("/:caseId/assign", validate(v.caseIdSchema, "params"), validate(v.assignCaseSchema), c.assign)
caseAdminRoutes.post("/:caseId/resolve", validate(v.caseIdSchema, "params"), validate(v.resolveCaseSchema), c.resolve)
