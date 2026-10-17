import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

/** Append-only record of who did what. Never updated or deleted by the application. */
export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
    declare auditId: CreationOptional<string>
    declare actorId: string | null
    declare action: string
    declare entity: string
    declare entityId: string | null
    declare metadata: Record<string, unknown> | null
    declare requestId: string | null
    declare ip: string | null
    declare createdAt: CreationOptional<Date>
}

AuditLog.init(
    {
        auditId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        actorId: { type: DataTypes.UUID, allowNull: true },
        action: { type: DataTypes.STRING(64), allowNull: false },
        entity: { type: DataTypes.STRING(32), allowNull: false },
        entityId: { type: DataTypes.STRING(64), allowNull: true },
        metadata: { type: DataTypes.JSONB, allowNull: true },
        requestId: { type: DataTypes.STRING(64), allowNull: true },
        ip: { type: DataTypes.STRING(64), allowNull: true },
        createdAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "audit_logs",
        updatedAt: false,
        indexes: [{ fields: ["actorId", "createdAt"] }, { fields: ["entity", "entityId"] }],
    },
)
