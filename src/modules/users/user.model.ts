import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize"
import { sequelize } from "../../config/database"
import type { Role } from "../../shared/middleware/auth"

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare userId: CreationOptional<string>
    declare username: string
    declare email: string
    declare password: string
    declare role: CreationOptional<Role>
    declare firstname: string | null
    declare lastname: string | null
    declare contact: string | null
    declare address: string | null
    declare gender: "Male" | "Female" | "Other" | null
    declare otpHash: string | null
    declare otpExpiry: Date | null
    declare otpAttempts: CreationOptional<number>
    declare readonly createdAt: CreationOptional<Date>
    declare readonly updatedAt: CreationOptional<Date>
}

User.init(
    {
        userId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        username: { type: DataTypes.STRING(30), allowNull: false },
        email: {
            type: DataTypes.STRING(254),
            allowNull: false,
            set(value: string) {
                this.setDataValue("email", value.trim().toLowerCase())
            },
        },
        password: { type: DataTypes.STRING, allowNull: false },
        role: { type: DataTypes.ENUM("Venue Owner", "User", "Admin", "Super Admin"), allowNull: false, defaultValue: "User" },
        firstname: { type: DataTypes.STRING(80), allowNull: true },
        lastname: { type: DataTypes.STRING(80), allowNull: true },
        contact: { type: DataTypes.STRING(32), allowNull: true },
        address: { type: DataTypes.STRING(255), allowNull: true },
        gender: { type: DataTypes.ENUM("Male", "Female", "Other"), allowNull: true },
        otpHash: { type: DataTypes.STRING, allowNull: true },
        otpExpiry: { type: DataTypes.DATE, allowNull: true },
        otpAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "users",
        indexes: [{ unique: true, fields: ["email"] }, { unique: true, fields: ["username"] }],
        // Secrets are excluded from every query unless a caller explicitly opts in with `User.scope("withSecrets")`.
        defaultScope: { attributes: { exclude: ["password", "otpHash", "otpExpiry", "otpAttempts"] } },
        scopes: { withSecrets: { attributes: { include: ["password", "otpHash", "otpExpiry", "otpAttempts"] } } },
    },
)

export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
    declare tokenId: CreationOptional<string>
    declare userId: string
    declare tokenHash: string
    declare expiresAt: Date
    declare revokedAt: Date | null
    declare readonly createdAt: CreationOptional<Date>
}

RefreshToken.init(
    {
        tokenId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        userId: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "userId" }, onDelete: "CASCADE" },
        tokenHash: { type: DataTypes.STRING(64), allowNull: false },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        revokedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "refresh_tokens",
        updatedAt: false,
        indexes: [{ unique: true, fields: ["tokenHash"] }, { fields: ["userId"] }],
    },
)
