import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export type PrivacyRequestType = "export" | "deletion"
export type PrivacyRequestStatus = "open" | "in_review" | "completed" | "rejected"

export class PrivacyRequest extends Model<InferAttributes<PrivacyRequest>, InferCreationAttributes<PrivacyRequest>> {
    declare requestId: CreationOptional<string>
    declare userId: string
    declare requestType: PrivacyRequestType
    declare status: CreationOptional<PrivacyRequestStatus>
    declare note: string | null
    declare resolvedBy: string | null
    declare resolvedAt: Date | null
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

PrivacyRequest.init(
    {
        requestId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        userId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        requestType: { type: DataTypes.ENUM("export", "deletion"), allowNull: false },
        status: { type: DataTypes.ENUM("open", "in_review", "completed", "rejected"), allowNull: false, defaultValue: "open" },
        note: { type: DataTypes.TEXT, allowNull: true },
        resolvedBy: { type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "userId" } },
        resolvedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "privacy_requests",
        indexes: [
            { fields: ["userId", "createdAt"] },
            { fields: ["status", "createdAt"] },
            { unique: true, fields: ["userId", "requestType"], where: { status: ["open", "in_review"] } },
        ],
    },
)
