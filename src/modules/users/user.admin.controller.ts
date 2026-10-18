import { Request, Response } from "express"
import { audit } from "../audit"
import { pageMeta, PageQuery } from "../../shared/pagination"
import * as users from "./user.service"

export const createStaff = async (req: Request, res: Response) => {
    const user = await users.createStaff(req.body)
    await audit(req, { action: "admin.staff_create", entity: "user", entityId: user.userId })
    res.status(201).location(`/api/v1/admin/users/${user.userId}`).json({ user })
}

export const listStaff = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total } = await users.listStaff(page)
    res.json({ data: rows, meta: pageMeta(page, total) })
}

export const assignRole = async (req: Request, res: Response) => {
    const targetId = String(req.params.userId)
    const { user, previousRole } = await users.assignRole(req.user!.userId, targetId, req.body.role)
    await audit(req, { action: "admin.role_assign", entity: "user", entityId: targetId, metadata: { from: previousRole, to: user.role } })
    res.json({ user })
}

export const removeStaff = async (req: Request, res: Response) => {
    const targetId = String(req.params.userId)
    const { user, previousRole } = await users.removeStaff(req.user!.userId, targetId)
    await audit(req, { action: "admin.staff_remove", entity: "user", entityId: targetId, metadata: { from: previousRole } })
    res.json({ user })
}
