import express from 'express';
import db_connect from './config/db_connect';
import userRoutes from './routes/usersRoute';
import venueRoutes from './routes/venueRoutes';
import bookingRoutes from './routes/bookingRoutes';


const app: express.Application = express();

const port: number = Number(process.env.PORT) || 3000;

//middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// route config
app.use('/users', userRoutes)
app.use('/venues', venueRoutes)
app.use('/bookings', bookingRoutes)


app.listen(port, async () =>{
    console.log(`Server running on http://localhost:${port}`);
    await db_connect.sync({
        force: false,
        // logging: false
        })
})