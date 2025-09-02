import { DataTypes, Sequelize, Model, Optional } from "sequelize"
import db_connect from "../config/db_connect";
import Venue from "./Venue";
import Booking from "./Booking";


// Define the attributes for the User model
interface UserAttributes {
    userId: string;
    username: string;
    email: string;
    password: string;
    role: 'venue owner' | 'user';
    firstname: string;
    lastname: string;
    contact: string;
    address: string;
    gender: 'Male' | 'Female' | 'Other';
}

// Some attributes are optional in `User.build` and `User.create` calls
interface UserCreationAttributes extends Optional<UserAttributes,
    'userId' | 'role' | 'firstname' | 'lastname' | 'contact' | 'address' | 'gender'> { }

// Define the User model class
class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
    public userId!: string;
    public username!: string;
    public email!: string;
    public password!: string;
    public role!: 'venue owner' | 'user';
    public firstname!: string;
    public lastname!: string;
    public contact!: string;
    public address !: string;
    public gender!: 'Male' | 'Female' | 'Other';

    // timestamps!
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    // You can also add instance methods here if needed
}
User.init(
    {
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
        password: {
            type: DataTypes.STRING,
            allowNull: false
        },
        role: {
            type: DataTypes.ENUM('venue owner', 'user'),
            defaultValue: 'user'
        },
        firstname: {
            type: DataTypes.STRING,
            allowNull: true
        },
        lastname: {
            type: DataTypes.STRING,
            allowNull: true
        },
        contact: {
            type: DataTypes.STRING,
            allowNull: true
        },
        address: {
            type: DataTypes.STRING,
            allowNull: true
        },
        gender: {
            type: DataTypes.ENUM('Male', 'Female', 'Other'),
            allowNull: true
        },
    },

    {
        sequelize: db_connect, // passing the `sequelize` instance is required
        tableName: 'users', // specify the table name
    }
);

// Database associations
User.hasMany(Venue, { foreignKey: 'userId' }); // Assuming userId is the foreign key in venue
Venue.belongsTo(User, { foreignKey: 'userId' }); // Correct association

User.hasMany(Booking, { foreignKey: 'userId' }); // Assuming userId is the foreign key in booking
Booking.belongsTo(User, { foreignKey: 'userId' }); // Correct association



export default User