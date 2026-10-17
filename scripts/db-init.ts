// One-off schema bootstrap: `npm run db:init`. Idempotent.
import { sequelize } from "../src/config/database"
import { connectDatabase, initSchema } from "../src/bootstrap"

;(async () => {
    await connectDatabase()
    await initSchema()
    await sequelize.close()
})().catch((err) => {
    console.error(err)
    process.exit(1)
})
