import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    refreshFindOne: vi.fn(),
    refreshUpdate: vi.fn(),
    userFindOne: vi.fn(),
    userFindByPk: vi.fn(),
}))

vi.mock("../src/config/database", () => ({ sequelize: { transaction: mocks.transaction } }))
vi.mock("../src/modules/users/user.model", () => ({
    RefreshToken: { findOne: mocks.refreshFindOne, update: mocks.refreshUpdate, create: vi.fn() },
    User: { scope: vi.fn(() => ({ findOne: mocks.userFindOne })), findByPk: mocks.userFindByPk },
}))

import { refresh, resetPassword } from "../src/modules/users/user.service"
import { env } from "../src/config/env"
import { AppError } from "../src/shared/errors"
import { createHmac } from "node:crypto"

describe("user session and password reset protections", () => {
    let committed: boolean
    const transaction = { LOCK: { UPDATE: "UPDATE" } }

    beforeEach(() => {
        vi.clearAllMocks()
        committed = false
        mocks.transaction.mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) => {
            const result = await callback(transaction)
            committed = true
            return result
        })
    })

    it("commits refresh-family revocation before rejecting a reused token", async () => {
        mocks.refreshFindOne.mockResolvedValue({
            userId: "user-1",
            revokedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
        })
        mocks.refreshUpdate.mockResolvedValue([1])

        await expect(refresh("already-rotated-token")).rejects.toMatchObject({ status: 401 })

        expect(mocks.refreshUpdate).toHaveBeenCalledWith(
            { revokedAt: expect.any(Date) },
            expect.objectContaining({ where: { userId: "user-1", revokedAt: null }, transaction }),
        )
        expect(committed).toBe(true)
    })

    it("serializes reset-code attempts and stops counting after the configured limit", async () => {
        const user = {
            userId: "user-2",
            otpHash: createHmac("sha256", env.jwt.secret).update("user-2:000000").digest("hex"),
            otpExpiry: new Date(Date.now() + 60_000),
            otpAttempts: 0,
            increment: vi.fn(async () => {
                user.otpAttempts += 1
            }),
            update: vi.fn(),
        }
        mocks.userFindOne.mockResolvedValue(user)
        mocks.refreshUpdate.mockResolvedValue([0])

        for (let i = 0; i < 5; i++) {
            await expect(resetPassword("user@example.com", "111111", "NewPassw0rd!")).rejects.toBeInstanceOf(AppError)
        }
        await expect(resetPassword("user@example.com", "111111", "NewPassw0rd!")).rejects.toBeInstanceOf(AppError)

        expect(user.increment).toHaveBeenCalledTimes(5)
        expect(user.increment).toHaveBeenCalledWith("otpAttempts", { transaction })
        expect(mocks.userFindOne).toHaveBeenCalledTimes(6)
        expect(mocks.userFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ transaction, lock: "UPDATE", useMaster: true }),
        )
    })
})
