import express from 'express';
import db_connect from './config/db_connect';
import userRoutes from './routes/usersRoute';


const app: express.Application = express();

const port: number = Number(process.env.PORT) || 3000;


// route config
app.use('/users', userRoutes)




app.listen(port, async () =>{
    console.log(`Server running on http://localhost:${port}`);
    await db_connect.sync({
        force: false,
        logging: false
        })
})