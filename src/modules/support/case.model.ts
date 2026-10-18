import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export type CaseType = "complaint" | "dispute"
export type CaseStatus = "open" | "in_review" | "resolved" | "rejected"
export type BookingAction = "none" | "cancel_and_refund"

/** A complaint (anything) or dispute (about a specific booking) raised by a booker or venue owner. */
export class SupportCase extends Model<InferAttributes<SupportCase>, InferCreationAttributes<SupportCase>> {
    declare caseId: CreationOptional<string>
    declare type: CaseType
    declare status: CreationOptional<CaseStatus>
    declare raisedBy: string
    declare bookingId: string | null
    declare venueId: string | null
    declare subject: string
    declare description: string
    declare assignedTo: string | null
    declare resolution: string | null
    declare bookingAction: CreationOptional<BookingAction>
    declare resolvedBy: string | null
    declare resolvedAt: Date | null
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

SupportCase.init(
    {
        caseId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        type: { type: DataTypes.ENUM("complaint", "dispute"), allowNull: false },
        status: { type: DataTypes.ENUM("open", "in_review", "resolved", "rejected"), allowNull: false, defaultValue: "open" },
        raisedBy: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        bookingId: { type: DataTypes.UUID, allowNull: true, references: { model: "bookings", key: "bookingId" } },
        venueId: { type: DataTypes.UUID, allowNull: true, references: { model: "venues", key: "venueId" } },
        subject: { type: DataTypes.STRING(160), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: false },
        assignedTo: { type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "userId" } },
        resolution: { type: DataTypes.TEXT, allowNull: true },
        bookingAction: { type: DataTypes.ENUM("none", "cancel_and_refund"), allowNull: false, defaultValue: "none" },
        resolvedBy: { type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "userId" } },
        resolvedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "support_cases",
        indexes: [
            { fields: ["raisedBy", "createdAt"] },
            { fields: ["status", "type", "createdAt"] }, // staff queue
            { fields: ["assignedTo", "status"] },
            { fields: ["bookingId"] },
        ],
    },
)
