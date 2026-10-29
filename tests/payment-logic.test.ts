import { describe, expect, it } from "vitest"
import { shouldRefundPaidPayment } from "../src/modules/payments/payment.logic"

describe("payment compensation", () => {
    it("refunds a newly completed payment when another payment already confirmed the booking", () => {
        expect(shouldRefundPaidPayment("already_confirmed", true, "payment-1", "payment-2")).toBe(true)
    })

    it("does not refund a replay of the same completed payment", () => {
        expect(shouldRefundPaidPayment("already_confirmed", false, "payment-1", "payment-1")).toBe(false)
    })

    it("refunds a payment when the slot was lost", () => {
        expect(shouldRefundPaidPayment("slot_lost", false, null, "payment-1")).toBe(true)
    })

    it("keeps refunding an extra payment on webhook retries after the enqueue attempt crashed", () => {
        expect(shouldRefundPaidPayment("already_confirmed", false, "payment-1", "payment-2")).toBe(true)
    })
})
