import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export type PaymentStatus = "Pending" | "Completed" | "Failed" | "Refunded"

export class Payment extends Model<InferAttributes<Payment>, InferCreationAttributes<Payment>> {
    declare paymentId: CreationOptional<string>
    declare bookingId: string
    declare userId: string
    declare stripeSessionId: string | null
    declare stripePaymentIntentId: string | null
    declare checkoutUrl: string | null
    declare amount: string
    declare currency: string
    declare status: CreationOptional<PaymentStatus>
    declare paidAt: Date | null
    declare refundedAt: Date | null
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

Payment.init(
    {
        paymentId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        bookingId: { type: DataTypes.UUID, allowNull: false, references: { model: "bookings", key: "bookingId" } },
        userId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        stripeSessionId: { type: DataTypes.STRING, allowNull: true },
        stripePaymentIntentId: { type: DataTypes.STRING, allowNull: true },
        checkoutUrl: { type: DataTypes.TEXT, allowNull: true },
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        currency: { type: DataTypes.STRING(3), allowNull: false },
        status: { type: DataTypes.ENUM("Pending", "Completed", "Failed", "Refunded"), allowNull: false, defaultValue: "Pending" },
        paidAt: { type: DataTypes.DATE, allowNull: true },
        refundedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "payments",
        indexes: [
            { fields: ["bookingId"] },
            { fields: ["userId"] },
            { unique: true, fields: ["stripeSessionId"] },
        ],
    },
)
