import { Request, Response } from "express"
import { audit } from "../audit"
import { pageMeta, PageQuery } from "../../shared/pagination"
import * as cases from "./case.service"

export const create = async (req: Request, res: Response) => {
    const created = await cases.createCase(req.user!, req.body)
    await audit(req, { action: `${created.type}.create`, entity: "case", entityId: created.caseId, metadata: { bookingId: created.bookingId } })
    res.status(201).location(`/api/v1/support/cases/${created.caseId}`).json({ case: created })
}

export const mine = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total } = await cases.listMyCases(req.user!.userId, page)
    res.json({ data: rows, meta: pageMeta(page, total) })
}

export const get = async (req: Request, res: Response) => {
    res.json({ case: await cases.getCase(String(req.params.caseId), req.user!) })
}

// ---- staff ----

export const list = async (req: Request, res: Response) => {
    const filters = req.query as unknown as Parameters<typeof cases.listCases>[0]
    const { rows, total } = await cases.listCases(filters)
    res.json({ data: rows, meta: pageMeta(filters, total) })
}

export const assign = async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId)
    const updated = await cases.assignCase(caseId, req.user!, req.body.assigneeId)
    await audit(req, { action: "case.assign", entity: "case", entityId: caseId, metadata: { assignedTo: updated.assignedTo } })
    res.json({ case: updated })
}

export const resolve = async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId)
    const updated = await cases.resolveCase(caseId, req.user!, req.body)
    await audit(req, { action: "case.resolve", entity: "case", entityId: caseId, metadata: { outcome: updated.status, bookingAction: updated.bookingAction } })
    res.json({ case: updated })
}
