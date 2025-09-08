import {Sequelize,DataTypes, Model, Optional} from "sequelize"
import db_connect from "../config/db_connect";
import Booking from "./Booking";

// Define the attributes for the User model
interface VenueAttributes {
    venueId: string;
    names: string;
    description: string;
    location: string;
    capacity: string;
    pricePerHour: string;
    userId: string;
    contact: string;
    pictures:string;
}
// Some attributes are optional in `User.build` and `User.create` calls
interface VenueCreationAttributes extends Optional<VenueAttributes, 'venueId' |'pictures' > { }

// Define the User model class
class Venue extends Model<VenueAttributes, VenueCreationAttributes> implements VenueAttributes {
    public venueId!: string;
    public names!: string;
    public description!: string;
    public location!: string;
    public capacity!: string;
    public pricePerHour!: string;
    public userId!: string;
    public contact!: string;
    public pictures !: string;
    
    // timestamps!
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    // You can also add instance methods here if needed
}

Venue.init(
    {
    venueId:{ 
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            unique: true
        },
        names:{
            type: DataTypes.STRING,
            allowNull : false

        },
        description:{
            type: DataTypes.STRING,
            allowNull : false
        },
        location:{
            type: DataTypes.STRING,
            allowNull : false

        },
        capacity:{
            type: DataTypes.STRING,
            allowNull : false

        },
        pricePerHour:{
            type: DataTypes.STRING,
            allowNull : false
        },
        userId:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            allowNull : false
        },
        contact:{
            type: DataTypes.STRING,
            allowNull : false
        },
        pictures:{
            type: DataTypes.STRING,
            allowNull : true
        },
    },
    {
        sequelize: db_connect, // passing the `sequelize` instance is required
        tableName: 'venues', // specify the table name
    }
)

// Database associations
Venue.hasMany(Booking, { foreignKey: 'venueId' }); // Assuming userId is the foreign key in venue
Booking.belongsTo(Venue, { foreignKey: 'venueId' }); // Correct association


export default Venue