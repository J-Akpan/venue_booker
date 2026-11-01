import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"

export class Review extends Model<InferAttributes<Review>, InferCreationAttributes<Review>> {
    declare reviewId: CreationOptional<string>
    declare bookingId: string
    declare venueId: string
    declare authorId: string
    declare rating: number
    declare comment: string | null
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

Review.init(
    {
        reviewId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        bookingId: { type: DataTypes.UUID, allowNull: false, references: { model: "bookings", key: "bookingId" } },
        venueId: { type: DataTypes.UUID, allowNull: false, references: { model: "venues", key: "venueId" } },
        authorId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" } },
        rating: { type: DataTypes.SMALLINT, allowNull: false, validate: { min: 1, max: 5 } },
        comment: { type: DataTypes.TEXT, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "reviews",
        indexes: [
            { unique: true, fields: ["bookingId"] }, // one review per completed booking
            { fields: ["venueId", "createdAt"] },
        ],
    },
)
