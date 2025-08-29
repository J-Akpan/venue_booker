import { DataTypes, Sequelize } from "sequelize"
import db_connect from "../config/db_connect";
import Venue from "./Venue";
import Booking from "./Booking";

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


// Database associations
User.hasMany(Venue, { foreignKey: 'userId' }); // Assuming userId is the foreign key in venue
Venue.belongsTo(User, { foreignKey: 'userId' }); // Correct association

User.hasMany (Booking, { foreignKey: 'userId' }); // Assuming userId is the foreign key in booking
Booking.belongsTo(User, { foreignKey: 'userId' }); // Correct association

// User.hasOne(, { foreignKey: 'userId' }); // Assuming userId is the foreign key in Venue
// Venue.belongsTo(User, { foreignKey: 'userId' }); // Correct association



export default User