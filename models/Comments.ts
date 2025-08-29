import {DataTypes, Sequelize} from "sequelize"
import db_connect from "../config/db_connect";

const Comments = db_connect.define(
    'Comment',
    {
        commentId:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            unique: true,
        },
        userId:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
        },
        venueId:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
        },
        
    }
)