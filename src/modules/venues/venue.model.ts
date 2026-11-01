import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export interface VenueAddOn {
    addOnId: string
    name: string
    description: string | null
    price: number
    chargeUnit: "flat" | "per_person" | "per_hour"
}

export class Venue extends Model<InferAttributes<Venue>, InferCreationAttributes<Venue>> {
    declare venueId: CreationOptional<string>
    declare ownerId: string
    declare name: string
    declare description: string
    declare location: string
    declare capacity: number
    declare pricePerHour: string // DECIMAL is returned as a string by pg to avoid float rounding
    declare currency: CreationOptional<string>
    declare cleaningFee: CreationOptional<string>
    declare refundableDeposit: CreationOptional<string>
    declare overtimePricePerHour: CreationOptional<string>
    declare contact: string
    declare pictures: CreationOptional<string[]>
    declare eventTypes: CreationOptional<string[]>
    declare amenities: CreationOptional<string[]>
    declare addOns: CreationOptional<VenueAddOn[]>
    declare cancellationPolicy: CreationOptional<string | null>
    declare cancellationRules: CreationOptional<Array<{ noticeHours: number; refundPercent: number }>>
    declare isVerified: CreationOptional<boolean>
    declare verifiedAt: CreationOptional<Date | null>
    declare availabilityConfirmedAt: CreationOptional<Date | null>
    declare calendarTokenHash: CreationOptional<string | null>
    declare calendarTokenCreatedAt: CreationOptional<Date | null>
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
    declare readonly deletedAt: CreationOptional<Date | null>
}

Venue.init(
    {
        venueId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        ownerId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: false },
        location: { type: DataTypes.STRING(160), allowNull: false },
        capacity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
        pricePerHour: { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0 } },
        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "NGN" },
        cleaningFee: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, validate: { min: 0 } },
        refundableDeposit: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, validate: { min: 0 } },
        overtimePricePerHour: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, validate: { min: 0 } },
        contact: { type: DataTypes.STRING(64), allowNull: false },
        pictures: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
        eventTypes: { type: DataTypes.ARRAY(DataTypes.STRING(60)), allowNull: false, defaultValue: [] },
        amenities: { type: DataTypes.ARRAY(DataTypes.STRING(60)), allowNull: false, defaultValue: [] },
        addOns: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        cancellationPolicy: { type: DataTypes.TEXT, allowNull: true },
        cancellationRules: { type: DataTypes.JSONB, allowNull: false, defaultValue: [{ noticeHours: 0, refundPercent: 100 }] },
        isVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        verifiedAt: { type: DataTypes.DATE, allowNull: true },
        availabilityConfirmedAt: { type: DataTypes.DATE, allowNull: true },
        calendarTokenHash: { type: DataTypes.STRING(64), allowNull: true },
        calendarTokenCreatedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
        deletedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "venues",
        paranoid: true, // soft delete: bookings and payments keep pointing at a real row
        indexes: [
            { fields: ["ownerId"] },
            { fields: ["location"] },
            { fields: ["capacity"] },
            // One venue name per owner, ignoring soft-deleted rows.
            { unique: true, fields: ["ownerId", "name"], where: { deletedAt: null } },
        ],
    },
)
