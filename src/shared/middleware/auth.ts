import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { env } from "../../config/env"
import { forbidden, unauthorized } from "../errors"

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
export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ")
    if (scheme?.toLowerCase() !== "bearer" || !token) throw unauthorized()
    try {
        // Pin the algorithm: never let the token choose how it is verified.
        const payload = jwt.verify(token, env.jwt.secret, { algorithms: ["HS256"], issuer: env.jwt.issuer })
        if (typeof payload === "string" || !payload.sub) throw new Error("bad payload")
        req.user = { userId: payload.sub, role: payload.role as Role }
        next()
    } catch {
        throw unauthorized("Token is invalid or expired")
    }
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
