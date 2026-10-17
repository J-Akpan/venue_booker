import { Request, Response } from "express"
import { audit } from "../audit"
import * as payments from "./payment.service"

export const checkout = async (req: Request, res: Response) => {
    const result = await payments.startCheckout(req.user!.userId, req.body.bookingId)
    await audit(req, { action: "payment.checkout", entity: "payment", entityId: result.paymentId, metadata: { bookingId: req.body.bookingId } })
    res.status(201).json(result)
}

export const forBooking = async (req: Request, res: Response) => {
    res.json({ data: await payments.getPaymentsForBooking(req.user!.userId, String(req.params.bookingId)) })
}

/** Mounted with express.raw() (see app.ts): signature verification needs the exact bytes Stripe sent. */
export const webhook = async (req: Request, res: Response) => {
    const event = payments.parseWebhook(req.body as Buffer, req.header("stripe-signature"))
    await payments.handleWebhookEvent(event)
    await audit(null, { action: "payment.webhook", entity: "stripe_event", entityId: event.id, metadata: { type: event.type } })
    res.json({ received: true })
}
