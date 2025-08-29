import { DataTypes, Sequelize } from "sequelize"
import db_connect from "../config/db_connect";

const User = db_connect.define(
    'User',
    {
        // Model attributes are defined here
        userId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            unique: true,
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false
        },
        password:{
            type: DataTypes.STRING,
            allowNull: false
        },
        role:{
            type: DataTypes.ENUM('venue owner', 'user'),
            defaultValue: 'user'
        },

    },
);

export default User