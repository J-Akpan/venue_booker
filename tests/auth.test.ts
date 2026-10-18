import { describe, expect, it, vi } from "vitest"
import jwt from "jsonwebtoken"
import { authenticate, requireRole, signAccessToken } from "../src/shared/middleware/auth"
import { AppError } from "../src/shared/errors"

const run = (fn: () => void) => {
    try {
        fn()
        return null
    } catch (e) {
        return e as AppError
    }
}
const reqWith = (authorization?: string) => ({ headers: { authorization } }) as any

describe("authenticate", () => {
    it("rejects a missing token", () => {
        expect(run(() => authenticate(reqWith(), {} as any, vi.fn()))?.status).toBe(401)
    })
    it("accepts a valid token and attaches the user", () => {
        const token = signAccessToken({ userId: "u1", role: "User" })
        const req = reqWith(`Bearer ${token}`)
        const next = vi.fn()
        authenticate(req, {} as any, next)
        expect(next).toHaveBeenCalled()
        expect(req.user).toEqual({ userId: "u1", role: "User" })
    })
    it("rejects a token signed with another secret", () => {
        const forged = jwt.sign({ role: "Admin" }, "x".repeat(40), { subject: "u1", issuer: "venue-booker" })
        expect(run(() => authenticate(reqWith(`Bearer ${forged}`), {} as any, vi.fn()))?.status).toBe(401)
    })
    it("rejects alg=none tokens", () => {
        const none = jwt.sign({ role: "Admin" }, "", { algorithm: "none", subject: "u1", issuer: "venue-booker" } as any)
        expect(run(() => authenticate(reqWith(`Bearer ${none}`), {} as any, vi.fn()))?.status).toBe(401)
    })
    it("rejects an expired token", () => {
        const old = jwt.sign({ role: "User" }, process.env.JWT_SECRET!, { subject: "u1", issuer: "venue-booker", expiresIn: -10 })
        expect(run(() => authenticate(reqWith(`Bearer ${old}`), {} as any, vi.fn()))?.status).toBe(401)
    })
})

describe("requireRole", () => {
    it("blocks users without the role", () => {
        expect(run(() => requireRole("Venue Owner")({ user: { userId: "u", role: "User" } } as any, {} as any, vi.fn()))?.status).toBe(403)
    })
    it("allows the role", () => {
        const next = vi.fn()
        requireRole("Venue Owner")({ user: { userId: "u", role: "Venue Owner" } } as any, {} as any, next)
        expect(next).toHaveBeenCalled()
    })
    it("lets Admin through everywhere", () => {
        const next = vi.fn()
        requireRole("Venue Owner")({ user: { userId: "u", role: "Admin" } } as any, {} as any, next)
        expect(next).toHaveBeenCalled()
    })
})

describe("requireRole: staff tiers", () => {
    const call = (role: string, ...allowed: any[]) => {
        const next = vi.fn()
        const err = run(() => requireRole(...allowed)({ user: { userId: "u", role } } as any, {} as any, next))
        return { err, called: next.mock.calls.length > 0 }
    }
    it("Admin is blocked from Super Admin-only routes", () => {
        expect(call("Admin", "Super Admin").err?.status).toBe(403)
    })
    it("Super Admin passes everything", () => {
        expect(call("Super Admin", "Super Admin").called).toBe(true)
        expect(call("Super Admin", "Admin").called).toBe(true)
    })
    it("Admin passes Admin routes", () => {
        expect(call("Admin", "Admin").called).toBe(true)
    })
})
