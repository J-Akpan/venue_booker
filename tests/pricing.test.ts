import { describe, expect, it } from "vitest"
import { assertValidSlot, calculateTotal } from "../src/modules/bookings/booking.pricing"

const at = (iso: string) => new Date(iso)

describe("calculateTotal", () => {
    it("charges per hour", () => {
        expect(calculateTotal(at("2030-01-01T10:00:00Z"), at("2030-01-01T13:00:00Z"), 100)).toBe(300)
    })
    it("prorates half hours", () => {
        expect(calculateTotal(at("2030-01-01T10:00:00Z"), at("2030-01-01T10:30:00Z"), 99.99)).toBe(50)
    })
    it("avoids floating point drift", () => {
        expect(calculateTotal(at("2030-01-01T10:00:00Z"), at("2030-01-01T11:00:00Z"), 0.1 + 0.2)).toBe(0.3)
    })
})

describe("assertValidSlot", () => {
    const now = at("2030-01-01T00:00:00Z")
    it("accepts a normal future slot", () => {
        expect(() => assertValidSlot(at("2030-01-02T10:00:00Z"), at("2030-01-02T12:00:00Z"), now)).not.toThrow()
    })
    it("rejects end before start", () => {
        expect(() => assertValidSlot(at("2030-01-02T12:00:00Z"), at("2030-01-02T10:00:00Z"), now)).toThrow()
    })
    it("rejects slots in the past", () => {
        expect(() => assertValidSlot(at("2029-12-31T10:00:00Z"), at("2029-12-31T12:00:00Z"), now)).toThrow()
    })
    it("rejects durations that are not a multiple of 30 minutes", () => {
        expect(() => assertValidSlot(at("2030-01-02T10:00:00Z"), at("2030-01-02T10:45:00Z"), now)).toThrow()
    })
    it("rejects very long bookings", () => {
        expect(() => assertValidSlot(at("2030-01-02T10:00:00Z"), at("2030-02-20T10:00:00Z"), now)).toThrow()
    })
})
