import { Sequelize } from "sequelize";
import dotenv from "dotenv";
dotenv.config();

const DB_NAME = process.env.DB_NAME as string;
const USERNAME = process.env.DB_USERNAME as string;
const PASSWORD = process.env.DB_PASSWORD as string;
const HOST = process.env.HOST as string;
const DIALECT = process.env.DIALECT as any;

const db_connect = new Sequelize(DB_NAME, USERNAME, PASSWORD, {
    host: HOST,
    dialect: DIALECT, 
    logging: false,
});


const connection = async () => {
    try {
        await db_connect.authenticate();
        console.log('Connection to database successfully.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }

}
connection()


export default db_connect;