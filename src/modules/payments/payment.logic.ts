type BookingConfirmation = "confirmed" | "already_confirmed" | "slot_lost"

/** Refund a lost slot, or a newly completed charge when another payment already confirmed it. */
export const shouldRefundPaidPayment = (
    outcome: BookingConfirmation,
    newlyCompleted: boolean,
    confirmedPaymentId: string | null,
    paymentId: string,
) =>
    outcome === "slot_lost" ||
    (outcome === "already_confirmed" &&
        (confirmedPaymentId ? confirmedPaymentId !== paymentId : newlyCompleted))
