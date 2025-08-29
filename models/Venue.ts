import {Sequelize,DataTypes} from "sequelize"
import db_connect from "../config/db_connect";
import Booking from "./Booking";

const Venue = db_connect.define(
    'Venue',
    {
        venueId:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            unique: true,
        },
        name:{
            type: DataTypes.STRING,
            allowNull: false,
        },
        description:{
            type: DataTypes.TEXT,
            allowNull: false,
        },
        location:{
            type: DataTypes.STRING,
            allowNull: false,
        },
        capacity:{
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        pricePerHour:{
            type: DataTypes.FLOAT,
            allowNull: false,   
        },
        userId:{
            type: DataTypes.UUID,
            allowNull: false,
        }
    }
)

// Database associations
Venue.hasMany(Booking, { foreignKey: 'venueId' }); // Assuming userId is the foreign key in venue
Booking.belongsTo(Venue, { foreignKey: 'venueId' }); // Correct association


export default Venue