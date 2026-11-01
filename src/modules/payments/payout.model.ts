import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export class VenuePayoutAccount extends Model<InferAttributes<VenuePayoutAccount>, InferCreationAttributes<VenuePayoutAccount>> {
    declare payoutAccountId: CreationOptional<string>
    declare ownerId: string
    declare stripeAccountId: string
    declare detailsSubmitted: CreationOptional<boolean>
    declare chargesEnabled: CreationOptional<boolean>
    declare transfersEnabled: CreationOptional<boolean>
    declare payoutsEnabled: CreationOptional<boolean>
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

VenuePayoutAccount.init(
    {
        payoutAccountId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        ownerId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        stripeAccountId: { type: DataTypes.STRING(100), allowNull: false, unique: true },
        detailsSubmitted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        chargesEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        transfersEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        payoutsEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "venue_payout_accounts",
        indexes: [{ unique: true, fields: ["ownerId"] }],
    },
)

export type SettlementStatus = "routed" | "partially_refunded" | "refunded"

export class VenueSettlement extends Model<InferAttributes<VenueSettlement>, InferCreationAttributes<VenueSettlement>> {
    declare settlementId: CreationOptional<string>
    declare paymentId: string
    declare bookingId: string
    declare venueId: string
    declare ownerId: string
    declare grossAmount: string
    declare platformFeeAmount: string
    declare venueAmount: string
    declare refundedAmount: CreationOptional<string>
    declare currency: string
    declare status: SettlementStatus
    declare stripePaymentIntentId: string
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

VenueSettlement.init(
    {
        settlementId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        paymentId: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "payments", key: "paymentId" } },
        bookingId: { type: DataTypes.UUID, allowNull: false, references: { model: "bookings", key: "bookingId" } },
        venueId: { type: DataTypes.UUID, allowNull: false, references: { model: "venues", key: "venueId" } },
        ownerId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        grossAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        platformFeeAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        venueAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        refundedAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        currency: { type: DataTypes.STRING(3), allowNull: false },
        status: { type: DataTypes.ENUM("routed", "partially_refunded", "refunded"), allowNull: false },
        stripePaymentIntentId: { type: DataTypes.STRING(100), allowNull: false },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "venue_settlements",
        indexes: [{ fields: ["ownerId", "createdAt"] }, { fields: ["venueId", "createdAt"] }],
    },
)
