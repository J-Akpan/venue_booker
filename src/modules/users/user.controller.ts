import { Request, Response } from "express"
import { audit } from "../audit"
import { pageMeta, PageQuery } from "../../shared/pagination"
import * as users from "./user.service"

export const signUp = async (req: Request, res: Response) => {
    const user = await users.signUp(req.body)
    await audit(req, { action: "user.signup", entity: "user", entityId: user.userId }, user.userId)
    res.status(201).json({ user })
}

export const login = async (req: Request, res: Response) => {
    const result = await users.login(req.body)
    await audit(req, { action: "user.login", entity: "user", entityId: result.user.userId }, result.user.userId)
    res.json(result)
}

export const refresh = async (req: Request, res: Response) => {
    res.json(await users.refresh(req.body.refreshToken))
}

export const logout = async (req: Request, res: Response) => {
    await users.logout(req.body.refreshToken)
    res.status(204).end()
}

export const me = async (req: Request, res: Response) => {
    res.json({ user: await users.getUser(req.user!.userId) })
}

export const updateProfile = async (req: Request, res: Response) => {
    res.json({ user: await users.updateProfile(req.user!.userId, req.body) })
}

export const changePassword = async (req: Request, res: Response) => {
    await users.changePassword(req.user!.userId, req.body.oldPassword, req.body.newPassword)
    await audit(req, { action: "user.password_change", entity: "user", entityId: req.user!.userId })
    res.json({ message: "Password updated. Please sign in again on your other devices." })
}

export const forgotPassword = async (req: Request, res: Response) => {
    await users.requestPasswordReset(req.body.email)
    res.json({ message: "If that email is registered, a reset code has been sent." })
}

export const resetPassword = async (req: Request, res: Response) => {
    await users.resetPassword(req.body.email, req.body.otp, req.body.newPassword)
    await audit(req, { action: "user.password_reset", entity: "user" })
    res.json({ message: "Password reset successful" })
}

export const listUsers = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total } = await users.listUsers(page)
    res.json({ data: rows, meta: pageMeta(page, total) })
}
