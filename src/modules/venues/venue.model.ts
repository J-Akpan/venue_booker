import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export class Venue extends Model<InferAttributes<Venue>, InferCreationAttributes<Venue>> {
    declare venueId: CreationOptional<string>
    declare ownerId: string
    declare name: string
    declare description: string
    declare location: string
    declare capacity: number
    declare pricePerHour: string // DECIMAL is returned as a string by pg to avoid float rounding
    declare currency: CreationOptional<string>
    declare contact: string
    declare pictures: CreationOptional<string[]>
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
        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
        contact: { type: DataTypes.STRING(64), allowNull: false },
        pictures: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
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
