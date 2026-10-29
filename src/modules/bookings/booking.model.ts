import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired"

export class Booking extends Model<InferAttributes<Booking>, InferCreationAttributes<Booking>> {
    declare bookingId: CreationOptional<string>
    declare userId: string
    declare venueId: string
    declare startsAt: Date
    declare endsAt: Date
    declare totalPrice: string
    declare currency: string
    declare status: CreationOptional<BookingStatus>
    declare expiresAt: Date | null // end of the unpaid hold on the slot
    declare confirmedPaymentId: CreationOptional<string | null>
    declare idempotencyKey: string | null
    declare cancelledAt: Date | null
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

Booking.init(
    {
        bookingId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        userId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        venueId: { type: DataTypes.UUID, allowNull: false, references: { model: "venues", key: "venueId" } },
        startsAt: { type: DataTypes.DATE, allowNull: false },
        endsAt: { type: DataTypes.DATE, allowNull: false },
        totalPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        currency: { type: DataTypes.STRING(3), allowNull: false },
        status: { type: DataTypes.ENUM("pending", "confirmed", "cancelled", "expired"), allowNull: false, defaultValue: "pending" },
        expiresAt: { type: DataTypes.DATE, allowNull: true },
        confirmedPaymentId: { type: DataTypes.UUID, allowNull: true, defaultValue: null },
        idempotencyKey: { type: DataTypes.STRING(64), allowNull: true },
        cancelledAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "bookings",
        indexes: [
            { fields: ["userId", "createdAt"] },
            { fields: ["venueId", "startsAt"] },
            { fields: ["status", "expiresAt"] }, // serves the hold-expiry sweeper
            // A retried POST with the same key can never create a second booking (NULLs never collide in Postgres).
            { unique: true, fields: ["userId", "idempotencyKey"] },
        ],
    },
)
// The no-double-booking EXCLUDE constraint is applied in config/database.ts (applyDatabaseConstraints).
