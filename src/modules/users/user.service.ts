import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import bcrypt from "bcryptjs"
import { Op } from "sequelize"
import { env } from "../../config/env"
import { sequelize } from "../../config/database"
import { badRequest, forbidden, notFound, unauthorized } from "../../shared/errors"
import { signAccessToken } from "../../shared/middleware/auth"
import { publish } from "../../shared/events"
import { PageQuery, toOffset } from "../../shared/pagination"
import { RefreshToken, User } from "./user.model"

const BCRYPT_COST = 12
const OTP_TTL_MS = 10 * 60_000
const OTP_MAX_ATTEMPTS = 5
// Used to burn the same CPU time when the account doesn't exist, so login timing doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST)

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const hmac = (value: string) => createHmac("sha256", env.jwt.secret).update(value).digest("hex")

export const toPublicUser = (u: User) => ({
    userId: u.userId,
    username: u.username,
    email: u.email,
    role: u.role,
    firstname: u.firstname,
    lastname: u.lastname,
    contact: u.contact,
    address: u.address,
    gender: u.gender,
    createdAt: u.createdAt,
})

// ---- tokens ---------------------------------------------------------------------------------

const issueTokens = async (user: Pick<User, "userId" | "role">, family?: { transaction: any }) => {
    const refreshToken = randomBytes(48).toString("base64url")
    await RefreshToken.create(
        {
            userId: user.userId,
            tokenHash: sha256(refreshToken),
            expiresAt: new Date(Date.now() + env.jwt.refreshTtlDays * 86_400_000),
            revokedAt: null,
        },
        family,
    )
    return { accessToken: signAccessToken({ userId: user.userId, role: user.role }), refreshToken }
}

const revokeAllTokens = (userId: string, transaction?: any) =>
    RefreshToken.update({ revokedAt: new Date() }, { where: { userId, revokedAt: null }, transaction })

// ---- registration / login -------------------------------------------------------------------

export const signUp = async (input: { username: string; email: string; password: string; role: "User" | "Venue Owner" }) => {
    const email = input.email.trim().toLowerCase()
    const existing = await User.findOne({ where: { [Op.or]: [{ email }, { username: input.username }] }, useMaster: true })
    if (existing) throw badRequest("Username or email is already registered")

    const user = await User.create({
        username: input.username,
        email,
        password: await bcrypt.hash(input.password, BCRYPT_COST),
        role: input.role,
        firstname: null,
        lastname: null,
        contact: null,
        address: null,
        gender: null,
        otpHash: null,
        otpExpiry: null,
    })
    publish("user.registered", { userId: user.userId, email: user.email, username: user.username })
    return toPublicUser(user)
}

export const login = async (input: { username?: string; email?: string; password: string }) => {
    const where = input.email ? { email: input.email.trim().toLowerCase() } : { username: input.username! }
    const user = await User.scope("withSecrets").findOne({ where, useMaster: true })
    const valid = await bcrypt.compare(input.password, user?.password ?? DUMMY_HASH)
    if (!user || !valid) throw unauthorized("Invalid credentials")

    return { user: toPublicUser(user), ...(await issueTokens(user)) }
}

/** Rotate the refresh token. Re-use of an already-rotated token means it leaked: revoke the whole session set. */
export const refresh = async (refreshToken: string) => {
    const tokens = await sequelize.transaction(async (transaction) => {
        const stored = await RefreshToken.findOne({ where: { tokenHash: sha256(refreshToken) }, transaction, lock: transaction.LOCK.UPDATE })
        if (!stored || stored.expiresAt < new Date()) throw unauthorized("Refresh token is invalid or expired")
        if (stored.revokedAt) {
            await revokeAllTokens(stored.userId, transaction)
            // Return from the managed transaction so family revocation commits. Throwing here
            // would roll the update back along with the transaction.
            return null
        }
        const user = await User.findByPk(stored.userId, { transaction })
        if (!user) throw unauthorized()
        await stored.update({ revokedAt: new Date() }, { transaction })
        return issueTokens(user, { transaction })
    })
    if (!tokens) throw unauthorized("Refresh token was already used")
    return tokens
}

export const logout = async (refreshToken: string) => {
    await RefreshToken.update({ revokedAt: new Date() }, { where: { tokenHash: sha256(refreshToken), revokedAt: null } })
}

// ---- profile --------------------------------------------------------------------------------

export const getUser = async (userId: string) => {
    const user = await User.findByPk(userId)
    if (!user) throw notFound("User")
    return toPublicUser(user)
}

export const updateProfile = async (
    userId: string,
    changes: Partial<Pick<User, "firstname" | "lastname" | "contact" | "address" | "gender">>,
) => {
    const user = await User.findByPk(userId, { useMaster: true })
    if (!user) throw notFound("User")
    await user.update(changes)
    return toPublicUser(user)
}

export const listUsers = async (page: PageQuery) => {
    const { rows, count } = await User.findAndCountAll({ ...toOffset(page), order: [["createdAt", "DESC"]] })
    return { rows: rows.map(toPublicUser), total: count }
}

// ---- passwords ------------------------------------------------------------------------------

export const changePassword = async (userId: string, oldPassword: string, newPassword: string) => {
    const user = await User.scope("withSecrets").findByPk(userId, { useMaster: true })
    if (!user) throw notFound("User")
    if (!(await bcrypt.compare(oldPassword, user.password))) throw badRequest("Old password is incorrect")

    await sequelize.transaction(async (transaction) => {
        await user.update({ password: await bcrypt.hash(newPassword, BCRYPT_COST) }, { transaction })
        await revokeAllTokens(userId, transaction) // sign out every other session
    })
}

/** Always succeeds from the caller's point of view, so the endpoint can't be used to discover which emails exist. */
export const requestPasswordReset = async (email: string) => {
    const user = await User.findOne({ where: { email: email.trim().toLowerCase() }, useMaster: true })
    if (!user) return

    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0")
    await user.update({ otpHash: hmac(`${user.userId}:${otp}`), otpExpiry: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 })
    publish("user.passwordResetRequested", { email: user.email, otp })
}

export const resetPassword = async (email: string, otp: string, newPassword: string) => {
    const invalid = badRequest("Invalid or expired code")
    const accepted = await sequelize.transaction(async (transaction) => {
        const user = await User.scope("withSecrets").findOne({
            where: { email: email.trim().toLowerCase() },
            transaction,
            lock: transaction.LOCK.UPDATE,
            useMaster: true,
        })
        if (!user || !user.otpHash || !user.otpExpiry || user.otpExpiry < new Date() || user.otpAttempts >= OTP_MAX_ATTEMPTS) return false

        const expected = Buffer.from(user.otpHash)
        const actual = Buffer.from(hmac(`${user.userId}:${otp}`))
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            await user.increment("otpAttempts", { transaction })
            return false
        }

        await user.update(
            { password: await bcrypt.hash(newPassword, BCRYPT_COST), otpHash: null, otpExpiry: null, otpAttempts: 0 },
            { transaction },
        ) // clear the code while holding the row lock, so it cannot be used twice concurrently
        await revokeAllTokens(user.userId, transaction)
        return true
    })
    if (!accepted) throw invalid
}

// ---- used by other modules (via ./index) ----------------------------------------------------

export const getContact = async (userId: string) => {
    const user = await User.findByPk(userId)
    return user ? { email: user.email, name: user.firstname || user.username } : null
}

// ---- super admin: staff & role management ---------------------------------------------------

/** Create a platform staff account (role Admin). Only reachable through Super Admin routes. */
export const createStaff = async (input: { username: string; email: string; password: string; firstname?: string; lastname?: string }) => {
    const email = input.email.trim().toLowerCase()
    const existing = await User.findOne({ where: { [Op.or]: [{ email }, { username: input.username }] }, useMaster: true })
    if (existing) throw badRequest("Username or email is already registered")

    const user = await User.create({
        username: input.username,
        email,
        password: await bcrypt.hash(input.password, BCRYPT_COST),
        role: "Admin",
        firstname: input.firstname ?? null,
        lastname: input.lastname ?? null,
        contact: null,
        address: null,
        gender: null,
        otpHash: null,
        otpExpiry: null,
    })
    publish("user.registered", { userId: user.userId, email: user.email, username: user.username })
    return toPublicUser(user)
}

export const listStaff = async (page: PageQuery) => {
    const { rows, count } = await User.findAndCountAll({
        where: { role: { [Op.in]: ["Admin", "Super Admin"] } },
        order: [["createdAt", "DESC"]],
        ...toOffset(page),
        useMaster: true,
    })
    return { rows: rows.map(toPublicUser), total: count }
}

/**
 * Change a user's role. Guard rails: no self-changes (can't lock yourself out or self-escalate),
 * Super Admins can't be modified here, and Super Admin can't be granted through the API at all
 * (use scripts/create-super-admin.ts).
 */
export const assignRole = async (actorId: string, targetId: string, role: "User" | "Venue Owner" | "Admin") => {
    if (actorId === targetId) throw badRequest("You can't change your own role")
    return sequelize.transaction(async (transaction) => {
        const target = await User.findByPk(targetId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!target) throw notFound("User")
        if (target.role === "Super Admin") throw forbidden("A Super Admin's role can't be changed here")
        const previousRole = target.role
        if (previousRole !== role) {
            await target.update({ role }, { transaction })
            await revokeAllTokens(targetId, transaction) // old tokens still carry the old role: force a fresh sign-in
        }
        return { user: toPublicUser(target), previousRole }
    })
}

/** Role of a staff member, or null if the user does not exist or is not staff. Used when assigning cases. */
export const getStaffRole = async (userId: string) => {
    const user = await User.findByPk(userId)
    return user && (user.role === "Admin" || user.role === "Super Admin") ? user.role : null
}

/** Remove staff access: demote to a normal user and sign them out everywhere. */
export const removeStaff = (actorId: string, targetId: string) => assignRole(actorId, targetId, "User")
