import { Request, Response } from "express"
import { audit } from "../audit"
import * as privacy from "./privacy.service"
import { PageQuery, pageMeta } from "../../shared/pagination"
import type { PrivacyRequestStatus } from "./privacy-request.model"

export const list = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total } = await privacy.listPrivacyRequests(page, req.query.status as PrivacyRequestStatus | undefined)
    res.json({ data: rows, meta: pageMeta(page, total) })
}

export const resolve = async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId)
    const result = await privacy.resolvePrivacyRequest(requestId, req.user!, req.body.decision, req.body.note)
    await audit(req, { action: req.body.decision === "review" ? "privacy.request_review" : "privacy.request_resolve", entity: "privacy_request", entityId: requestId, metadata: { decision: req.body.decision } })
    res.json({ request: result })
}
