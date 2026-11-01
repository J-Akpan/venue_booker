import { sequelize } from "../config/database"
import { logger } from "./logger"
import { applyDatabaseConstraints } from "../config/database"

interface Migration {
    id: string
    up: () => Promise<void>
}

// Add a new immutable entry for every schema change after this baseline.
// The baseline is deliberately additive: sequelize.sync creates missing tables, while reviewed
// SQL adds columns/constraints to existing installations without altering or dropping data.
const migrations: Migration[] = [
    {
        id: "20261101_0001_schema_baseline",
        up: async () => {
            await sequelize.sync()
            await applyDatabaseConstraints()
        },
    },
    {
        id: "20261101_0002_marketplace_privacy_and_provider_features",
        up: async () => {
            // Create newly registered tables and apply idempotent additive columns/constraints.
            await sequelize.sync()
            await applyDatabaseConstraints()
        },
    },
    {
        id: "20261101_0003_analytics_and_refund_recovery_indexes",
        up: async () => {
            await sequelize.sync()
            await applyDatabaseConstraints()
        },
    },
]

const MIGRATION_LOCK_ID = 7_426_011

const withMigrationLock = async (run: () => Promise<void>) => {
    const lockConn: any = await sequelize.connectionManager.getConnection({ type: "write" })
    try {
        await lockConn.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID])
        await run()
    } finally {
        await lockConn.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {})
        sequelize.connectionManager.releaseConnection(lockConn)
    }
}

export const runMigrations = async () => withMigrationLock(async () => {
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id VARCHAR(120) PRIMARY KEY,
            "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `)
    const [rows] = await sequelize.query(`SELECT id FROM schema_migrations`)
    const applied = new Set((rows as Array<{ id: string }>).map((row) => row.id))

    for (const migration of migrations) {
        if (applied.has(migration.id)) continue
        logger.info({ migration: migration.id }, "applying database migration")
        await migration.up()
        await sequelize.query(`INSERT INTO schema_migrations (id) VALUES (:id)`, { replacements: { id: migration.id } })
        logger.info({ migration: migration.id }, "database migration applied")
    }
})

export const assertMigrationsCurrent = async () => {
    const [rows] = await sequelize.query(`SELECT id FROM schema_migrations`)
    const applied = new Set((rows as Array<{ id: string }>).map((row) => row.id))
    const pending = migrations.find((migration) => !applied.has(migration.id))
    if (pending) throw new Error(`Database migration ${pending.id} is pending; run npm run db:migrate before starting production.`)
}
