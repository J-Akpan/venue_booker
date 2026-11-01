import "./bootstrap"
import { sequelize } from "./config/database"
import { connectDatabase, initSchema } from "./bootstrap"

const main = async () => {
    await connectDatabase()
    try {
        await initSchema()
    } finally {
        await sequelize.close()
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
