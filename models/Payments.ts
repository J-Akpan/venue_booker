import { DataTypes, Model, Optional } from "sequelize";
import db_connect from "../config/db_connect";
import Booking from "./Booking"; // Import the Booking model for association

// Define the attributes for the Payment model
interface PaymentAttributes {
    paymentId: string;
    bookingId: string; // Foreign key linking to the specific booking
    transactionId: string; // Reference ID from the payment gateway (e.g., Stripe ID)
    amount: number; // Stored as a decimal for currency amount (e.g., 10,000.00)
    currency: string; // e.g., 'USD', 'NGN'
    paymentMethod: 'Card' | 'Transfer' | 'Cash' | 'Wallet';
    status: 'Pending' | 'Completed' | 'Failed' | 'Refunded';
    paymentDate: Date;
    receiptUrl?: string; // Optional URL to a receipt or invoice
}

// Some attributes are optional in `Payment.build` and `Payment.create` calls
interface PaymentCreationAttributes extends Optional<PaymentAttributes,
    'paymentId' | 'status' | 'paymentDate' | 'receiptUrl'> { }

// Define the Payment model class
class Payment extends Model<PaymentAttributes, PaymentCreationAttributes> implements PaymentAttributes {
    // Use 'declare' for clean TypeScript integration with Sequelize
    declare paymentId: string;
    declare bookingId: string;
    declare transactionId: string;
    declare amount: number;
    declare currency: string;
    declare paymentMethod: 'Card' | 'Transfer' | 'Cash' | 'Wallet';
    declare status: 'Pending' | 'Completed' | 'Failed' | 'Refunded';
    declare paymentDate: Date;
    declare receiptUrl?: string;

    // Timestamps
    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Payment.init(
    {
        paymentId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            unique: true,
        },
        bookingId: {
            type: DataTypes.UUID,
            allowNull: false,
            // References the 'id' (or UUID) column in the Booking model/table
            references: {
                model: Booking,
                key: 'bookingId', // Assuming the primary key in Booking is 'bookingId'
            }
        },
        transactionId: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true, // Transaction IDs should be unique
        },
        amount: {
            // Standard financial precision (10 total digits, 2 after decimal)
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
        },
        currency: {
            type: DataTypes.STRING(3), // ISO 4217 standard (e.g., 'USD', 'EUR')
            allowNull: false,
        },
        paymentMethod: {
            type: DataTypes.ENUM('Card', 'Transfer', 'Cash', 'Wallet'),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('Pending', 'Completed', 'Failed', 'Refunded'),
            defaultValue: 'Pending',
            allowNull: false,
        },
        paymentDate: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            allowNull: false,
        },
        receiptUrl: {
            type: DataTypes.STRING,
            allowNull: true,
        }
    },
    {
        sequelize: db_connect,
        tableName: 'payments',
    }
);

// Association: A Payment belongs to one Booking
Booking.hasOne(Payment, { foreignKey: 'bookingId' });
Payment.belongsTo(Booking, { foreignKey: 'bookingId' });


export default Payment;
