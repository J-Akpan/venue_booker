import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { env } from "../../config/env"
import { forbidden, unauthorized } from "../errors"
import { User } from "../../modules/users/user.model"

export type Role = "User" | "Venue Owner" | "Admin" | "Super Admin"

/** Platform staff: Admin (support staff) and Super Admin. */
export const isStaff = (role: Role | undefined) => role === "Admin" || role === "Super Admin"

export interface AuthUser {
    userId: string
    role: Role
}

declare global {
    namespace Express {
        interface Request {
            id: string
            user?: AuthUser
        }
    }
}

export const signAccessToken = (user: AuthUser) =>
    jwt.sign({ role: user.role }, env.jwt.secret, {
        subject: user.userId,
        issuer: env.jwt.issuer,
        algorithm: "HS256",
        expiresIn: env.jwt.accessTtl as jwt.SignOptions["expiresIn"],
    })

/** AuthN: verify the bearer token and attach the caller to the request. */
export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ")
    if (scheme?.toLowerCase() !== "bearer" || !token) throw unauthorized()
    let subject: string
    try {
        // Pin the algorithm: never let the token choose how it is verified.
        const verified = jwt.verify(token, env.jwt.secret, { algorithms: ["HS256"], issuer: env.jwt.issuer })
        if (typeof verified === "string" || !verified.sub) throw new Error("bad payload")
        subject = verified.sub
    } catch {
        throw unauthorized("Token is invalid or expired")
    }
    const user = await User.findByPk(subject, { attributes: ["userId", "role", "privacyDeletedAt"], useMaster: true })
    if (!user || user.privacyDeletedAt) throw unauthorized("Token is invalid or expired")
    // Use the database role so role changes and completed deletions take effect immediately.
    req.user = { userId: user.userId, role: user.role }
    next()
}

/**
 * AuthZ (RBAC): allow only the listed roles. Super Admin always passes. Admin passes everything
 * except routes reserved for Super Admin alone.
 */
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.role
    if (!role) throw unauthorized()
    if (role === "Super Admin") return next()
    if (role === "Admin" && roles.some((r) => r !== "Super Admin")) return next()
    if (!roles.includes(role)) throw forbidden()
    next()
}
