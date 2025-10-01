import { Sequelize, DataTypes, Model, Optional } from "sequelize"
import db_connect from "../config/db_connect";


// Define the attributes for the User model
interface BookingAttributes {
    bookingId: string;
    userId: string;
    venueId: string;
    bookingDate: string;
    bookingEndDate: string;
    startTime: string;
    endTime: string;
    totalPrice: string;
}
// Some attributes are optional in `User.build` and `User.create` calls
interface BookingCreationAttributes extends Optional<BookingAttributes, 'bookingId'> { }

// Define the User model class
class Booking extends Model<BookingAttributes, BookingCreationAttributes> implements BookingAttributes {
    public bookingId!: string;
    public userId!: string;
    public venueId!: string;
    public bookingDate!: string;
    public bookingEndDate!: string;
    public startTime!: string;
    public endTime!: string;
    public totalPrice !: string;

    // timestamps!
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    // You can also add instance methods here if needed
}

Booking.init(
    {
        bookingId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            unique: true
        },
        userId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            allowNull: false

        },
        venueId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            allowNull: false
        },
        bookingDate: {
            type: DataTypes.DATEONLY,
            allowNull: false

        },
        bookingEndDate: {
            type: DataTypes.DATEONLY,
            allowNull: false

        },
        startTime: {
            type: DataTypes.TIME,
            allowNull: false
        },
        endTime: {
            type: DataTypes.TIME,
            allowNull: false
        },
        totalPrice: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
    },
    {
        sequelize: db_connect, // passing the `sequelize` instance is required
        tableName: 'bookings', // specify the table name
    }
)

// // Database associations
// Venue.hasMany(Booking, { foreignKey: 'venueId' }); // Assuming userId is the foreign key in venue
// Booking.belongsTo(Venue, { foreignKey: 'venueId' }); // Correct association


export default Booking