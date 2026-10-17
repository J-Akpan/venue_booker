import { Router } from "express"
import { authenticate, requireRole } from "../../shared/middleware/auth"
import { validate } from "../../shared/middleware/validate"
import { authLimiter, sensitiveLimiter } from "../../shared/middleware/rateLimit"
import * as c from "./user.controller"
import * as v from "./user.validation"

const router = Router()

// public
router.post("/signup", authLimiter, validate(v.signupSchema), c.signUp)
router.post("/login", authLimiter, validate(v.loginSchema), c.login)
router.post("/refresh", authLimiter, validate(v.refreshSchema), c.refresh)
router.post("/logout", validate(v.refreshSchema), c.logout)
router.post("/forgot-password", sensitiveLimiter, validate(v.forgotPasswordSchema), c.forgotPassword)
router.post("/reset-password", authLimiter, validate(v.resetPasswordSchema), c.resetPassword)

// authenticated
router.get("/me", authenticate, c.me)
router.patch("/me", authenticate, validate(v.profileSchema), c.updateProfile)
router.put("/me/password", authenticate, authLimiter, validate(v.changePasswordSchema), c.changePassword)

// admin only
router.get("/", authenticate, requireRole("Admin"), validate(v.listUsersSchema, "query"), c.listUsers)

export default router
