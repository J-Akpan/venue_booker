import { Request, Response } from "express"
import { audit } from "../audit"
import { pageMeta, PageQuery } from "../../shared/pagination"
import * as payments from "./payment.service"

export const checkout = async (req: Request, res: Response) => {
    const result = await payments.startCheckout(req.user!.userId, req.body.bookingId)
    await audit(req, { action: "payment.checkout", entity: "payment", entityId: result.paymentId, metadata: { bookingId: req.body.bookingId } })
    res.set("Cache-Control", "no-store").status(201).json(result)
}

export const forBooking = async (req: Request, res: Response) => {
    res.json({ data: await payments.getPaymentsForBooking(req.user!.userId, String(req.params.bookingId)) })
}

export const connectOnboarding = async (req: Request, res: Response) => {
    const result = await payments.createConnectOnboardingLink(req.user!.userId)
    await audit(req, { action: "payments.connect_onboarding", entity: "payout_account", metadata: { status: result.status } })
    res.set("Cache-Control", "no-store").json(result)
}

export const connectStatus = async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store").json(await payments.getConnectStatus(req.user!.userId))
}

export const settlements = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const result = await payments.getOwnerSettlements(req.user!.userId, page, req.query.venueId as string | undefined)
    res.set("Cache-Control", "no-store").json({ data: result.rows, meta: pageMeta(page, result.total) })
}

/** Mounted with express.raw() (see app.ts): signature verification needs the exact bytes Stripe sent. */
export const webhook = async (req: Request, res: Response) => {
    const event = payments.parseWebhook(req.body as Buffer, req.header("stripe-signature"))
    await payments.handleWebhookEvent(event)
    await audit(null, { action: "payment.webhook", entity: "stripe_event", entityId: event.id, metadata: { type: event.type } })
    res.json({ received: true })
}
