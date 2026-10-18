// Create (or promote) the Super Admin. There is deliberately no HTTP endpoint for this.
//   SUPER_ADMIN_USERNAME=root SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='Str0ng!pass' npm run create-super-admin
// Idempotent: if the email already exists that account is promoted and keeps its password.
import bcrypt from "bcryptjs"
import { sequelize } from "../src/config/database"
import { connectDatabase, initSchema } from "../src/bootstrap"
import { User } from "../src/modules/users"

const { SUPER_ADMIN_USERNAME: username, SUPER_ADMIN_EMAIL: rawEmail, SUPER_ADMIN_PASSWORD: password } = process.env

;(async () => {
    if (!username || !rawEmail || !password) throw new Error("Set SUPER_ADMIN_USERNAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD")
    if (password.length < 12) throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters")
    const email = rawEmail.trim().toLowerCase()

    await connectDatabase()
    await initSchema() // makes sure the tables (and the Super Admin role value) exist
    const existing = await User.findOne({ where: { email } })
    if (existing) {
        await existing.update({ role: "Super Admin" })
        console.log(`Promoted existing user ${existing.username} to Super Admin`)
    } else {
        await User.create({
            username,
            email,
            password: await bcrypt.hash(password, 12),
            role: "Super Admin",
            firstname: null,
            lastname: null,
            contact: null,
            address: null,
            gender: null,
            otpHash: null,
            otpExpiry: null,
        })
        console.log(`Created Super Admin ${username}`)
    }
    await sequelize.close()
})().catch((err) => {
    console.error(err.message ?? err)
    process.exit(1)
})
