import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export type BookingStatus = "requested" | "pending" | "confirmed" | "declined" | "cancelled" | "expired"

export interface BookingPriceBreakdown {
    venueRental: number
    cleaningFee: number
    amountDueNow: number
    refundableDepositDueToVenue: number
    overtimePricePerHour: number
    currency: string
    addOns: Array<{ addOnId: string; name: string; chargeUnit: string; unitPrice: number; quantity: number; lineTotal: number }>
}

export class Booking extends Model<InferAttributes<Booking>, InferCreationAttributes<Booking>> {
    declare bookingId: CreationOptional<string>
    declare userId: string
    declare venueId: string
    declare startsAt: Date
    declare endsAt: Date
    declare totalPrice: string
    declare currency: string
    declare eventType: string | null
    declare attendeeCount: number | null
    declare priceBreakdown: CreationOptional<BookingPriceBreakdown>
    declare cancellationPolicySnapshot: string | null
    declare cancellationRulesSnapshot: CreationOptional<Array<{ noticeHours: number; refundPercent: number }>>
    declare cancellationRefundPercent: CreationOptional<number>
    declare ownerRespondedAt: Date | null
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
        eventType: { type: DataTypes.STRING(80), allowNull: true },
        attendeeCount: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1 } },
        priceBreakdown: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        cancellationPolicySnapshot: { type: DataTypes.TEXT, allowNull: true },
        cancellationRulesSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        cancellationRefundPercent: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, validate: { min: 0, max: 100 } },
        ownerRespondedAt: { type: DataTypes.DATE, allowNull: true },
        status: { type: DataTypes.ENUM("requested", "pending", "confirmed", "declined", "cancelled", "expired"), allowNull: false, defaultValue: "requested" },
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
