import {DataTypes} from "sequelize"
import db_connect from "../config/db_connect";

const Booking = db_connect.define(
    'Booking',
    {
        bookingId:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            unique: true,
        },
        userId:{
            type: DataTypes.UUID,
            allowNull: false,
        },
        venueId:{
            type: DataTypes.UUID,
            allowNull: false,
        },
        bookingDate:{
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        bookingEndDate:{
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        startTime:{
            type: DataTypes.TIME,
            allowNull: false,
        },
        endTime:{
            type: DataTypes.TIME,
            allowNull: false,
        },
        totalPrice:{
            type: DataTypes.FLOAT,
            allowNull: false,
        }
    }

)

export default Booking