import Joi from "joi"
import { paginationSchema } from "../../shared/pagination"

const password = Joi.string()
    .min(8)
    .max(72) // bcrypt ignores everything past 72 bytes
    .pattern(/^(?=.*[0-9])(?=.*[A-Za-z])(?=.*[!@#$%^&*(),.?":{}|<>_\-+=])/)
    .messages({ "string.pattern.base": "password must contain a letter, a number and a special character" })

export const signupSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    email: Joi.string().email().max(254).required(),
    password: password.required(),
    // Admin can't be self-assigned; promote accounts out of band.
    role: Joi.string().valid("User", "Venue Owner").default("User"),
})

export const loginSchema = Joi.object({
    username: Joi.string().max(254),
    email: Joi.string().email().max(254),
    password: Joi.string().max(72).required(),
}).xor("username", "email")

export const refreshSchema = Joi.object({ refreshToken: Joi.string().max(200).required() })

export const profileSchema = Joi.object({
    firstname: Joi.string().max(80),
    lastname: Joi.string().max(80),
    contact: Joi.string().max(32),
    address: Joi.string().max(255),
    gender: Joi.string().valid("Male", "Female", "Other"),
}).min(1)

export const changePasswordSchema = Joi.object({
    oldPassword: Joi.string().max(72).required(),
    newPassword: password.required(),
    confirmPassword: Joi.any().valid(Joi.ref("newPassword")).required().messages({ "any.only": "confirmPassword must match newPassword" }),
})

export const forgotPasswordSchema = Joi.object({ email: Joi.string().email().required() })

export const resetPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).pattern(/^\d+$/).required(),
    newPassword: password.required(),
    confirmPassword: Joi.any().valid(Joi.ref("newPassword")).required().messages({ "any.only": "confirmPassword must match newPassword" }),
})

export const listUsersSchema = Joi.object({ ...paginationSchema })

export const createStaffSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    email: Joi.string().email().max(254).required(),
    password: password.required(),
    firstname: Joi.string().max(80),
    lastname: Joi.string().max(80),
})

export const assignRoleSchema = Joi.object({
    // "Super Admin" is deliberately not assignable through the API.
    role: Joi.string().valid("User", "Venue Owner", "Admin").required(),
})

export const userIdParamSchema = Joi.object({ userId: Joi.string().uuid().required() })
