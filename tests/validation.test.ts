import { describe, expect, it } from "vitest"
import { signupSchema, resetPasswordSchema } from "../src/modules/users/user.validation"
import { createBookingSchema } from "../src/modules/bookings/booking.validation"

describe("signupSchema", () => {
    const ok = { username: "alice1", email: "a@b.co", password: "Passw0rd!x" }
    it("accepts a valid payload and defaults the role", () => {
        const { value, error } = signupSchema.validate(ok)
        expect(error).toBeUndefined()
        expect(value.role).toBe("User")
    })
    it("does not allow self-registering as Admin", () => {
        expect(signupSchema.validate({ ...ok, role: "Admin" }).error).toBeDefined()
    })
    it("rejects weak passwords", () => {
        expect(signupSchema.validate({ ...ok, password: "password" }).error).toBeDefined()
    })
})

describe("createBookingSchema", () => {
    it("strips a client-supplied totalPrice", () => {
        const { value } = createBookingSchema.validate(
            { venueId: "3f2b8c1e-6a1d-4c55-9a52-0d6f1b8f3a11", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T12:00:00Z", totalPrice: 1 },
            { stripUnknown: true },
        )
        expect(value.totalPrice).toBeUndefined()
    })
})

describe("resetPasswordSchema", () => {
    it("requires a 6-digit numeric code and matching confirmation", () => {
        const base = { email: "a@b.co", newPassword: "Passw0rd!x", confirmPassword: "Passw0rd!x" }
        expect(resetPasswordSchema.validate({ ...base, otp: "123456" }).error).toBeUndefined()
        expect(resetPasswordSchema.validate({ ...base, otp: "12ab56" }).error).toBeDefined()
        expect(resetPasswordSchema.validate({ ...base, otp: "123456", confirmPassword: "different1!" }).error).toBeDefined()
    })
})
